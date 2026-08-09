import type { PriceSource } from './alignmentTypes';
import type {
  AlertTerminalReturnRecord,
  TerminalReturnCell,
} from './terminalReturn';
import { canonicalJsonStringify } from './canonicalJson';
import type { CoverageStatistics, ReturnStatistics } from './alertQualityReport';
import {
  createCoverageStatistics,
  summarizeReturnValues,
} from './alertQualityStatistics';

export const ALERT_QUALITY_TERMINAL_RETURN_REPORT_SCHEMA_VERSION = 1 as const;
export const ALERT_QUALITY_TERMINAL_RETURN_GENERATOR_VERSION =
  'alert-quality-terminal-return-generator-v1' as const;

export type AlertQualityTerminalReturnGroupDimension =
  | 'INSTRUMENT_ID'
  | 'INSTRUMENT_TYPE'
  | 'HORIZON_MS'
  | 'SOURCE'
  | 'EVENT_TYPE'
  | 'RELATIONSHIP'
  | 'SEVERITY'
  | 'OKX_BIAS'
  | 'EXTERNAL_BIAS';

export interface AlertQualityTerminalReturnMetrics {
  rawReturnPercent: ReturnStatistics;
  okxDirectionalReturnPercent: ReturnStatistics;
  externalDirectionalReturnPercent: ReturnStatistics;
  okxExecutableDirectionalReturnPercent: ReturnStatistics;
  externalExecutableDirectionalReturnPercent: ReturnStatistics;
}

export interface AlertQualityTerminalReturnGroup {
  groupKey: string;
  dimension: 'OVERALL' | AlertQualityTerminalReturnGroupDimension;
  value: string | number | null;
  evaluatorVersion: string;
  policyFingerprint: string;
  coverage: CoverageStatistics;
  returns: AlertQualityTerminalReturnMetrics;
}

export interface AlertQualityTerminalReturnReport {
  schemaVersion: typeof ALERT_QUALITY_TERMINAL_RETURN_REPORT_SCHEMA_VERSION;
  generatorVersion: typeof ALERT_QUALITY_TERMINAL_RETURN_GENERATOR_VERSION;
  reportRunId: string;
  generatedAt: number;
  inputRecordCount: number;
  uniqueCellCount: number;
  exactDuplicateCellCount: number;
  groupingDimensions: readonly AlertQualityTerminalReturnGroupDimension[];
  evaluatorVersions: readonly string[];
  policyFingerprints: readonly string[];
  groups: readonly AlertQualityTerminalReturnGroup[];
}

export interface AggregateTerminalReturnQualityInput {
  records: readonly AlertTerminalReturnRecord[];
  reportRunId: string;
  generatedAt: number;
  groupingDimensions?: readonly AlertQualityTerminalReturnGroupDimension[];
}

interface IndexedCell {
  record: AlertTerminalReturnRecord;
  cell: TerminalReturnCell;
}

const GROUP_DIMENSION_ORDER = Object.freeze([
  'INSTRUMENT_ID',
  'INSTRUMENT_TYPE',
  'HORIZON_MS',
  'SOURCE',
  'EVENT_TYPE',
  'RELATIONSHIP',
  'SEVERITY',
  'OKX_BIAS',
  'EXTERNAL_BIAS',
] as const satisfies readonly AlertQualityTerminalReturnGroupDimension[]);

const assertMetadata = (input: AggregateTerminalReturnQualityInput): void => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(input.reportRunId)) {
    throw new Error('reportRunId must be a valid durable identifier');
  }
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) {
    throw new Error('generatedAt must be a non-negative safe integer');
  }
};

const orderDimensions = (
  dimensions: readonly AlertQualityTerminalReturnGroupDimension[],
): AlertQualityTerminalReturnGroupDimension[] => {
  const requested = new Set(dimensions);
  if (requested.size !== dimensions.length) {
    throw new Error('groupingDimensions must be unique');
  }
  if (dimensions.some((dimension) => !GROUP_DIMENSION_ORDER.includes(dimension))) {
    throw new Error('Unsupported alert-quality grouping dimension');
  }
  return GROUP_DIMENSION_ORDER.filter((dimension) => requested.has(dimension));
};

const cellIdentity = ({ record, cell }: IndexedCell): string =>
  canonicalJsonStringify({
    outcomeId: record.outcomeId,
    horizonMs: cell.horizonMs,
    source: cell.source,
  });

const cellMaterial = ({ record, cell }: IndexedCell): string =>
  canonicalJsonStringify({
    evaluatorVersion: record.evaluatorVersion,
    policyFingerprint: record.returnPolicy.fingerprint,
    sourceEvaluationId: record.sourceEvaluationId,
    instrument: record.instrument,
    alertContext: record.alertContext,
    cell,
  });

const groupValue = (
  indexed: IndexedCell,
  dimension: AlertQualityTerminalReturnGroupDimension,
): string | number | null => {
  const { record, cell } = indexed;
  switch (dimension) {
    case 'INSTRUMENT_ID':
      return record.instrument.instId;
    case 'INSTRUMENT_TYPE':
      return record.instrument.instType;
    case 'HORIZON_MS':
      return cell.horizonMs;
    case 'SOURCE':
      return cell.source;
    case 'EVENT_TYPE':
      return record.alertContext.eventType;
    case 'RELATIONSHIP':
      return record.alertContext.relationship;
    case 'SEVERITY':
      return record.alertContext.severity;
    case 'OKX_BIAS':
      return record.alertContext.okxBias;
    case 'EXTERNAL_BIAS':
      return record.alertContext.externalBias;
  }
};

const groupKey = (input: {
  dimension: 'OVERALL' | AlertQualityTerminalReturnGroupDimension;
  value: string | number | null;
  evaluatorVersion: string;
  policyFingerprint: string;
}): string => canonicalJsonStringify(input);

const finiteMetric = (name: string, value: number | null): number | null => {
  if (value !== null && !Number.isFinite(value)) {
    throw new Error(`${name} must be finite when present`);
  }
  return value;
};

const summarizeGroup = (
  cells: readonly IndexedCell[],
  descriptor: Omit<AlertQualityTerminalReturnGroup, 'groupKey' | 'coverage' | 'returns'>,
): AlertQualityTerminalReturnGroup => {
  let eligibleCellCount = 0;
  let ineligibleCellCount = 0;
  let ambiguousCellCount = 0;
  let missingCellCount = 0;
  let partialCellCount = 0;
  let invalidCellCount = 0;
  const raw: number[] = [];
  const okxDirectional: number[] = [];
  const externalDirectional: number[] = [];
  const okxExecutable: number[] = [];
  const externalExecutable: number[] = [];

  for (const { cell } of cells) {
    if (cell.eligibility === 'ELIGIBLE') eligibleCellCount += 1;
    if (cell.eligibility === 'INELIGIBLE') ineligibleCellCount += 1;
    if (cell.eligibility === 'AMBIGUOUS') ambiguousCellCount += 1;
    if (cell.alignmentCompleteness === 'MISSING') missingCellCount += 1;
    if (cell.alignmentCompleteness === 'PARTIAL') partialCellCount += 1;
    if (cell.alignmentCompleteness === 'INVALID') invalidCellCount += 1;

    const rawValue = finiteMetric('rawReturnPercent', cell.rawReturnPercent);
    const okxValue = finiteMetric(
      'okxDirectionalReturnPercent',
      cell.okxDirectionalReturnPercent,
    );
    const externalValue = finiteMetric(
      'externalDirectionalReturnPercent',
      cell.externalDirectionalReturnPercent,
    );
    const okxExecutableValue = finiteMetric(
      'okxExecutable.directionalReturnPercent',
      cell.okxExecutable?.directionalReturnPercent ?? null,
    );
    const externalExecutableValue = finiteMetric(
      'externalExecutable.directionalReturnPercent',
      cell.externalExecutable?.directionalReturnPercent ?? null,
    );
    if (rawValue !== null) raw.push(rawValue);
    if (okxValue !== null) okxDirectional.push(okxValue);
    if (externalValue !== null) externalDirectional.push(externalValue);
    if (okxExecutableValue !== null) okxExecutable.push(okxExecutableValue);
    if (externalExecutableValue !== null) externalExecutable.push(externalExecutableValue);
  }

  return {
    ...descriptor,
    groupKey: groupKey(descriptor),
    coverage: createCoverageStatistics({
      totalCellCount: cells.length,
      eligibleCellCount,
      ineligibleCellCount,
      ambiguousCellCount,
      missingCellCount,
      partialCellCount,
      invalidCellCount,
    }),
    returns: {
      rawReturnPercent: summarizeReturnValues(raw),
      okxDirectionalReturnPercent: summarizeReturnValues(okxDirectional),
      externalDirectionalReturnPercent: summarizeReturnValues(externalDirectional),
      okxExecutableDirectionalReturnPercent: summarizeReturnValues(okxExecutable),
      externalExecutableDirectionalReturnPercent:
        summarizeReturnValues(externalExecutable),
    },
  };
};

export const aggregateTerminalReturnQuality = (
  input: AggregateTerminalReturnQualityInput,
): AlertQualityTerminalReturnReport => {
  assertMetadata(input);
  const dimensions = orderDimensions(input.groupingDimensions ?? []);
  const uniqueCells = new Map<string, { material: string; indexed: IndexedCell }>();
  let exactDuplicateCellCount = 0;

  for (const record of input.records) {
    for (const cell of record.returns) {
      const indexed = { record, cell };
      const identity = cellIdentity(indexed);
      const material = cellMaterial(indexed);
      const existing = uniqueCells.get(identity);
      if (existing) {
        if (existing.material !== material) {
          throw new Error(`Conflicting duplicate terminal-return cell: ${identity}`);
        }
        exactDuplicateCellCount += 1;
        continue;
      }
      uniqueCells.set(identity, { material, indexed });
    }
  }

  const partitions = new Map<string, IndexedCell[]>();
  for (const { indexed } of uniqueCells.values()) {
    const partitionKey = canonicalJsonStringify({
      evaluatorVersion: indexed.record.evaluatorVersion,
      policyFingerprint: indexed.record.returnPolicy.fingerprint,
    });
    const partition = partitions.get(partitionKey) ?? [];
    partition.push(indexed);
    partitions.set(partitionKey, partition);
  }

  const groups: AlertQualityTerminalReturnGroup[] = [];
  for (const partition of partitions.values()) {
    const first = partition[0]!;
    const compatibility = {
      evaluatorVersion: first.record.evaluatorVersion,
      policyFingerprint: first.record.returnPolicy.fingerprint,
    };
    groups.push(
      summarizeGroup(partition, {
        dimension: 'OVERALL',
        value: null,
        ...compatibility,
      }),
    );

    for (const dimension of dimensions) {
      const buckets = new Map<string, { value: string | number | null; cells: IndexedCell[] }>();
      for (const indexed of partition) {
        const value = groupValue(indexed, dimension);
        const key = canonicalJsonStringify(value);
        const bucket = buckets.get(key) ?? { value, cells: [] };
        bucket.cells.push(indexed);
        buckets.set(key, bucket);
      }
      for (const bucket of buckets.values()) {
        groups.push(
          summarizeGroup(bucket.cells, {
            dimension,
            value: bucket.value,
            ...compatibility,
          }),
        );
      }
    }
  }

  groups.sort((left, right) => left.groupKey.localeCompare(right.groupKey));
  const evaluatorVersions = [...new Set(input.records.map((record) => record.evaluatorVersion))].sort();
  const policyFingerprints = [
    ...new Set(input.records.map((record) => record.returnPolicy.fingerprint)),
  ].sort();

  return {
    schemaVersion: ALERT_QUALITY_TERMINAL_RETURN_REPORT_SCHEMA_VERSION,
    generatorVersion: ALERT_QUALITY_TERMINAL_RETURN_GENERATOR_VERSION,
    reportRunId: input.reportRunId,
    generatedAt: input.generatedAt,
    inputRecordCount: input.records.length,
    uniqueCellCount: uniqueCells.size,
    exactDuplicateCellCount,
    groupingDimensions: Object.freeze(dimensions),
    evaluatorVersions: Object.freeze(evaluatorVersions),
    policyFingerprints: Object.freeze(policyFingerprints),
    groups: Object.freeze(groups),
  };
};

export const terminalReturnCellKey = (input: {
  outcomeId: string;
  horizonMs: number;
  source: PriceSource;
}): string => canonicalJsonStringify(input);
