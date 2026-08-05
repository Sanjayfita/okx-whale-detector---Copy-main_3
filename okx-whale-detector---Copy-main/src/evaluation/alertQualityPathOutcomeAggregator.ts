import type { PriceSource } from './alignmentTypes';
import type {
  AlertPathOutcomeRecord,
  PathExcursionOutcome,
  PathOutcomeCell,
} from './pathOutcome';
import { canonicalJsonStringify } from './canonicalJson';
import type { CoverageStatistics, NumericStatistics } from './alertQualityReport';
import {
  createCoverageStatistics,
  summarizeNumericValues,
} from './alertQualityStatistics';

export const ALERT_QUALITY_PATH_OUTCOME_REPORT_SCHEMA_VERSION = 1 as const;
export const ALERT_QUALITY_PATH_OUTCOME_GENERATOR_VERSION =
  'alert-quality-path-outcome-generator-v1' as const;

export type AlertQualityPathOutcomeGroupDimension =
  | 'INSTRUMENT_ID'
  | 'INSTRUMENT_TYPE'
  | 'HORIZON_MS'
  | 'SOURCE'
  | 'EVENT_TYPE'
  | 'RELATIONSHIP'
  | 'SEVERITY'
  | 'OKX_BIAS'
  | 'EXTERNAL_BIAS';

export interface ExcursionStatistics {
  favorableExcursionPercent: NumericStatistics;
  adverseExcursionPercent: NumericStatistics;
  timeToFavorableMs: NumericStatistics;
  timeToAdverseMs: NumericStatistics;
}

export interface CandleBoundStatistics {
  favorableBoundPercent: NumericStatistics;
  adverseBoundPercent: NumericStatistics;
}

export interface AlertQualityPathOutcomeMetrics {
  raw: ExcursionStatistics;
  okxDirectional: ExcursionStatistics;
  externalDirectional: ExcursionStatistics;
  executableOkx: ExcursionStatistics;
  executableExternal: ExcursionStatistics;
  candleOkx: CandleBoundStatistics;
  candleExternal: CandleBoundStatistics;
}

export interface AlertQualityPathOutcomeGroup {
  groupKey: string;
  dimension: 'OVERALL' | AlertQualityPathOutcomeGroupDimension;
  value: string | number | null;
  evaluatorVersion: string;
  policyFingerprint: string;
  coverage: CoverageStatistics;
  metrics: AlertQualityPathOutcomeMetrics;
}

export interface AlertQualityPathOutcomeReport {
  schemaVersion: typeof ALERT_QUALITY_PATH_OUTCOME_REPORT_SCHEMA_VERSION;
  generatorVersion: typeof ALERT_QUALITY_PATH_OUTCOME_GENERATOR_VERSION;
  reportRunId: string;
  generatedAt: number;
  inputRecordCount: number;
  uniqueCellCount: number;
  exactDuplicateCellCount: number;
  groupingDimensions: readonly AlertQualityPathOutcomeGroupDimension[];
  evaluatorVersions: readonly string[];
  policyFingerprints: readonly string[];
  groups: readonly AlertQualityPathOutcomeGroup[];
}

export interface AggregatePathOutcomeQualityInput {
  records: readonly AlertPathOutcomeRecord[];
  reportRunId: string;
  generatedAt: number;
  groupingDimensions?: readonly AlertQualityPathOutcomeGroupDimension[];
}

interface IndexedCell {
  record: AlertPathOutcomeRecord;
  cell: PathOutcomeCell;
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
] as const satisfies readonly AlertQualityPathOutcomeGroupDimension[]);

const assertMetadata = (input: AggregatePathOutcomeQualityInput): void => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(input.reportRunId)) {
    throw new Error('reportRunId must be a valid durable identifier');
  }
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) {
    throw new Error('generatedAt must be a non-negative safe integer');
  }
};

const orderDimensions = (
  dimensions: readonly AlertQualityPathOutcomeGroupDimension[],
): AlertQualityPathOutcomeGroupDimension[] => {
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
    pathOutcomeId: record.pathOutcomeId,
    horizonMs: cell.horizonMs,
    source: cell.source,
  });

const cellMaterial = ({ record, cell }: IndexedCell): string =>
  canonicalJsonStringify({
    evaluatorVersion: record.evaluatorVersion,
    policyFingerprint: record.policy.fingerprint,
    sourceEvaluationId: record.sourceEvaluationId,
    sourceTerminalReturnId: record.sourceTerminalReturnId,
    instrument: record.instrument,
    alertContext: record.alertContext,
    cell,
  });

const groupValue = (
  indexed: IndexedCell,
  dimension: AlertQualityPathOutcomeGroupDimension,
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
  dimension: 'OVERALL' | AlertQualityPathOutcomeGroupDimension;
  value: string | number | null;
  evaluatorVersion: string;
  policyFingerprint: string;
}): string => canonicalJsonStringify(input);

const finite = (name: string, value: number): number => {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
  return value;
};

const emptyExcursionValues = () => ({
  favorable: [] as number[],
  adverse: [] as number[],
  timeToFavorable: [] as number[],
  timeToAdverse: [] as number[],
});

const pushExcursion = (
  target: ReturnType<typeof emptyExcursionValues>,
  value: PathExcursionOutcome | null,
  name: string,
): void => {
  if (!value) return;
  target.favorable.push(finite(`${name}.favorableExcursionPercent`, value.favorableExcursionPercent));
  target.adverse.push(finite(`${name}.adverseExcursionPercent`, value.adverseExcursionPercent));
  target.timeToFavorable.push(finite(`${name}.timeToFavorableMs`, value.timeToFavorableMs));
  target.timeToAdverse.push(finite(`${name}.timeToAdverseMs`, value.timeToAdverseMs));
};

const summarizeExcursion = (
  values: ReturnType<typeof emptyExcursionValues>,
): ExcursionStatistics => ({
  favorableExcursionPercent: summarizeNumericValues(values.favorable),
  adverseExcursionPercent: summarizeNumericValues(values.adverse),
  timeToFavorableMs: summarizeNumericValues(values.timeToFavorable),
  timeToAdverseMs: summarizeNumericValues(values.timeToAdverse),
});

const summarizeGroup = (
  cells: readonly IndexedCell[],
  descriptor: Omit<AlertQualityPathOutcomeGroup, 'groupKey' | 'coverage' | 'metrics'>,
): AlertQualityPathOutcomeGroup => {
  let eligibleCellCount = 0;
  let ineligibleCellCount = 0;
  let ambiguousCellCount = 0;
  let missingCellCount = 0;
  let partialCellCount = 0;
  let invalidCellCount = 0;
  const raw = emptyExcursionValues();
  const okxDirectional = emptyExcursionValues();
  const externalDirectional = emptyExcursionValues();
  const executableOkx = emptyExcursionValues();
  const executableExternal = emptyExcursionValues();
  const candleOkxFavorable: number[] = [];
  const candleOkxAdverse: number[] = [];
  const candleExternalFavorable: number[] = [];
  const candleExternalAdverse: number[] = [];

  for (const { cell } of cells) {
    if (cell.eligibility === 'ELIGIBLE') eligibleCellCount += 1;
    if (cell.eligibility === 'INELIGIBLE') ineligibleCellCount += 1;
    if (cell.eligibility === 'AMBIGUOUS') ambiguousCellCount += 1;
    if (cell.alignmentCompleteness === 'MISSING') missingCellCount += 1;
    if (cell.alignmentCompleteness === 'PARTIAL') partialCellCount += 1;
    if (cell.alignmentCompleteness === 'INVALID') invalidCellCount += 1;

    pushExcursion(raw, cell.raw, 'raw');
    pushExcursion(okxDirectional, cell.okxDirectional, 'okxDirectional');
    pushExcursion(externalDirectional, cell.externalDirectional, 'externalDirectional');
    pushExcursion(executableOkx, cell.executableOkx, 'executableOkx');
    pushExcursion(executableExternal, cell.executableExternal, 'executableExternal');

    const okx = cell.candleBounds?.okx;
    if (okx) {
      candleOkxFavorable.push(finite('candleBounds.okx.favorableBoundPercent', okx.favorableBoundPercent));
      candleOkxAdverse.push(finite('candleBounds.okx.adverseBoundPercent', okx.adverseBoundPercent));
    }
    const external = cell.candleBounds?.external;
    if (external) {
      candleExternalFavorable.push(
        finite('candleBounds.external.favorableBoundPercent', external.favorableBoundPercent),
      );
      candleExternalAdverse.push(
        finite('candleBounds.external.adverseBoundPercent', external.adverseBoundPercent),
      );
    }
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
    metrics: {
      raw: summarizeExcursion(raw),
      okxDirectional: summarizeExcursion(okxDirectional),
      externalDirectional: summarizeExcursion(externalDirectional),
      executableOkx: summarizeExcursion(executableOkx),
      executableExternal: summarizeExcursion(executableExternal),
      candleOkx: {
        favorableBoundPercent: summarizeNumericValues(candleOkxFavorable),
        adverseBoundPercent: summarizeNumericValues(candleOkxAdverse),
      },
      candleExternal: {
        favorableBoundPercent: summarizeNumericValues(candleExternalFavorable),
        adverseBoundPercent: summarizeNumericValues(candleExternalAdverse),
      },
    },
  };
};

export const aggregatePathOutcomeQuality = (
  input: AggregatePathOutcomeQualityInput,
): AlertQualityPathOutcomeReport => {
  assertMetadata(input);
  const dimensions = orderDimensions(input.groupingDimensions ?? []);
  const uniqueCells = new Map<string, { material: string; indexed: IndexedCell }>();
  let exactDuplicateCellCount = 0;

  for (const record of input.records) {
    for (const cell of record.paths) {
      const indexed = { record, cell };
      const identity = cellIdentity(indexed);
      const material = cellMaterial(indexed);
      const existing = uniqueCells.get(identity);
      if (existing) {
        if (existing.material !== material) {
          throw new Error(`Conflicting duplicate path-outcome cell: ${identity}`);
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
      policyFingerprint: indexed.record.policy.fingerprint,
    });
    const partition = partitions.get(partitionKey) ?? [];
    partition.push(indexed);
    partitions.set(partitionKey, partition);
  }

  const groups: AlertQualityPathOutcomeGroup[] = [];
  for (const partition of partitions.values()) {
    const first = partition[0]!;
    const compatibility = {
      evaluatorVersion: first.record.evaluatorVersion,
      policyFingerprint: first.record.policy.fingerprint,
    };
    groups.push(summarizeGroup(partition, { dimension: 'OVERALL', value: null, ...compatibility }));

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
        groups.push(summarizeGroup(bucket.cells, { dimension, value: bucket.value, ...compatibility }));
      }
    }
  }

  groups.sort((left, right) => left.groupKey.localeCompare(right.groupKey));
  return {
    schemaVersion: ALERT_QUALITY_PATH_OUTCOME_REPORT_SCHEMA_VERSION,
    generatorVersion: ALERT_QUALITY_PATH_OUTCOME_GENERATOR_VERSION,
    reportRunId: input.reportRunId,
    generatedAt: input.generatedAt,
    inputRecordCount: input.records.length,
    uniqueCellCount: uniqueCells.size,
    exactDuplicateCellCount,
    groupingDimensions: Object.freeze(dimensions),
    evaluatorVersions: Object.freeze(
      [...new Set(input.records.map((record) => record.evaluatorVersion))].sort(),
    ),
    policyFingerprints: Object.freeze(
      [...new Set(input.records.map((record) => record.policy.fingerprint))].sort(),
    ),
    groups: Object.freeze(groups),
  };
};

export const pathOutcomeCellKey = (input: {
  pathOutcomeId: string;
  horizonMs: number;
  source: PriceSource;
}): string => canonicalJsonStringify(input);
