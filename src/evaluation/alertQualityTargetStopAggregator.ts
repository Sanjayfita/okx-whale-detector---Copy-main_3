import type { PriceSource } from './alignmentTypes';
import type { TargetStopStatistics } from './alertQualityReport';
import { createTargetStopStatistics } from './alertQualityStatistics';
import { canonicalJsonStringify } from './canonicalJson';
import type {
  AlertTargetStopOutcomeRecord,
  DirectionalTargetStopResult,
  TargetStopCell,
  TargetStopResult,
} from './targetStopOutcome';

export const ALERT_QUALITY_TARGET_STOP_REPORT_SCHEMA_VERSION = 1 as const;
export const ALERT_QUALITY_TARGET_STOP_GENERATOR_VERSION =
  'alert-quality-target-stop-generator-v1' as const;

export type AlertQualityTargetStopGroupDimension =
  | 'INSTRUMENT_ID'
  | 'INSTRUMENT_TYPE'
  | 'HORIZON_MS'
  | 'SOURCE'
  | 'EVENT_TYPE'
  | 'RELATIONSHIP'
  | 'SEVERITY'
  | 'OKX_BIAS'
  | 'EXTERNAL_BIAS';

export type AlertQualityTargetStopFamily =
  | 'OKX'
  | 'EXTERNAL'
  | 'EXECUTABLE_OKX'
  | 'EXECUTABLE_EXTERNAL'
  | 'CANDLE_OKX'
  | 'CANDLE_EXTERNAL';

export interface AlertQualityTargetStopGroup {
  groupKey: string;
  dimension: 'OVERALL' | AlertQualityTargetStopGroupDimension;
  value: string | number | null;
  evaluatorVersion: string;
  policyFingerprint: string;
  family: AlertQualityTargetStopFamily;
  statistics: TargetStopStatistics;
}

export interface AlertQualityTargetStopReport {
  schemaVersion: typeof ALERT_QUALITY_TARGET_STOP_REPORT_SCHEMA_VERSION;
  generatorVersion: typeof ALERT_QUALITY_TARGET_STOP_GENERATOR_VERSION;
  reportRunId: string;
  generatedAt: number;
  inputRecordCount: number;
  uniqueCellCount: number;
  exactDuplicateCellCount: number;
  groupingDimensions: readonly AlertQualityTargetStopGroupDimension[];
  evaluatorVersions: readonly string[];
  policyFingerprints: readonly string[];
  groups: readonly AlertQualityTargetStopGroup[];
}

export interface AggregateTargetStopQualityInput {
  records: readonly AlertTargetStopOutcomeRecord[];
  reportRunId: string;
  generatedAt: number;
  groupingDimensions?: readonly AlertQualityTargetStopGroupDimension[];
}

interface IndexedCell {
  record: AlertTargetStopOutcomeRecord;
  cell: TargetStopCell;
}

const DIMENSION_ORDER = Object.freeze([
  'INSTRUMENT_ID',
  'INSTRUMENT_TYPE',
  'HORIZON_MS',
  'SOURCE',
  'EVENT_TYPE',
  'RELATIONSHIP',
  'SEVERITY',
  'OKX_BIAS',
  'EXTERNAL_BIAS',
] as const satisfies readonly AlertQualityTargetStopGroupDimension[]);

const FAMILY_ORDER = Object.freeze([
  'OKX',
  'EXTERNAL',
  'EXECUTABLE_OKX',
  'EXECUTABLE_EXTERNAL',
  'CANDLE_OKX',
  'CANDLE_EXTERNAL',
] as const satisfies readonly AlertQualityTargetStopFamily[]);

const assertMetadata = (input: AggregateTargetStopQualityInput): void => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(input.reportRunId)) {
    throw new Error('reportRunId must be a valid durable identifier');
  }
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) {
    throw new Error('generatedAt must be a non-negative safe integer');
  }
};

const orderDimensions = (
  dimensions: readonly AlertQualityTargetStopGroupDimension[],
): AlertQualityTargetStopGroupDimension[] => {
  const requested = new Set(dimensions);
  if (requested.size !== dimensions.length) {
    throw new Error('groupingDimensions must be unique');
  }
  if (dimensions.some((dimension) => !DIMENSION_ORDER.includes(dimension))) {
    throw new Error('Unsupported alert-quality grouping dimension');
  }
  return DIMENSION_ORDER.filter((dimension) => requested.has(dimension));
};

const cellIdentity = ({ record, cell }: IndexedCell): string =>
  canonicalJsonStringify({
    targetStopOutcomeId: record.targetStopOutcomeId,
    horizonMs: cell.horizonMs,
    source: cell.source,
  });

const cellMaterial = ({ record, cell }: IndexedCell): string =>
  canonicalJsonStringify({
    evaluatorVersion: record.evaluatorVersion,
    policyFingerprint: record.policy.fingerprint,
    sourceEvaluationId: record.sourceEvaluationId,
    sourceTerminalReturnId: record.sourceTerminalReturnId,
    sourcePathOutcomeId: record.sourcePathOutcomeId,
    instrument: record.instrument,
    alertContext: record.alertContext,
    cell,
  });

const groupValue = (
  indexed: IndexedCell,
  dimension: AlertQualityTargetStopGroupDimension,
): string | number | null => {
  const { record, cell } = indexed;
  switch (dimension) {
    case 'INSTRUMENT_ID': return record.instrument.instId;
    case 'INSTRUMENT_TYPE': return record.instrument.instType;
    case 'HORIZON_MS': return cell.horizonMs;
    case 'SOURCE': return cell.source;
    case 'EVENT_TYPE': return record.alertContext.eventType;
    case 'RELATIONSHIP': return record.alertContext.relationship;
    case 'SEVERITY': return record.alertContext.severity;
    case 'OKX_BIAS': return record.alertContext.okxBias;
    case 'EXTERNAL_BIAS': return record.alertContext.externalBias;
  }
};

const familyResult = (
  cell: TargetStopCell,
  family: AlertQualityTargetStopFamily,
): DirectionalTargetStopResult | null => {
  switch (family) {
    case 'OKX': return cell.okx;
    case 'EXTERNAL': return cell.external;
    case 'EXECUTABLE_OKX': return cell.executableOkx;
    case 'EXECUTABLE_EXTERNAL': return cell.executableExternal;
    case 'CANDLE_OKX': return cell.candleOkx;
    case 'CANDLE_EXTERNAL': return cell.candleExternal;
  }
};

const countResult = (
  result: TargetStopResult,
  counts: {
    targetFirstCount: number;
    stopFirstCount: number;
    neitherCount: number;
    tieCount: number;
    ambiguousCount: number;
    ineligibleCount: number;
  },
): void => {
  if (result === 'TARGET_FIRST') counts.targetFirstCount += 1;
  else if (result === 'STOP_FIRST') counts.stopFirstCount += 1;
  else if (result === 'NEITHER') counts.neitherCount += 1;
  else if (result === 'TIE') counts.tieCount += 1;
  else if (result === 'AMBIGUOUS') counts.ambiguousCount += 1;
  else counts.ineligibleCount += 1;
};

const summarizeFamily = (
  cells: readonly IndexedCell[],
  family: AlertQualityTargetStopFamily,
): TargetStopStatistics => {
  const counts = {
    eligibleCount: 0,
    ineligibleCount: 0,
    ambiguousCount: 0,
    targetFirstCount: 0,
    stopFirstCount: 0,
    neitherCount: 0,
    tieCount: 0,
    candleAmbiguityCount: 0,
  };

  for (const { cell } of cells) {
    const result = familyResult(cell, family);
    if (!result) {
      counts.ineligibleCount += 1;
      continue;
    }
    if (result.result === 'INELIGIBLE') {
      counts.ineligibleCount += 1;
      continue;
    }
    counts.eligibleCount += 1;
    countResult(result.result, counts);
    if (
      result.result === 'AMBIGUOUS' &&
      result.orderingPrecision === 'COARSE_CANDLE'
    ) {
      counts.candleAmbiguityCount += 1;
    }
  }

  return createTargetStopStatistics(counts);
};

const makeGroup = (
  cells: readonly IndexedCell[],
  descriptor: Omit<AlertQualityTargetStopGroup, 'groupKey' | 'statistics'>,
): AlertQualityTargetStopGroup => ({
  ...descriptor,
  groupKey: canonicalJsonStringify(descriptor),
  statistics: summarizeFamily(cells, descriptor.family),
});

export const aggregateTargetStopQuality = (
  input: AggregateTargetStopQualityInput,
): AlertQualityTargetStopReport => {
  assertMetadata(input);
  const dimensions = orderDimensions(input.groupingDimensions ?? []);
  const uniqueCells = new Map<string, { material: string; indexed: IndexedCell }>();
  let exactDuplicateCellCount = 0;

  for (const record of input.records) {
    for (const cell of record.outcomes) {
      if (!Number.isFinite(cell.targetPercent) || !Number.isFinite(cell.stopPercent)) {
        throw new Error('Target/stop percentages must be finite');
      }
      const indexed = { record, cell };
      const identity = cellIdentity(indexed);
      const material = cellMaterial(indexed);
      const existing = uniqueCells.get(identity);
      if (existing) {
        if (existing.material !== material) {
          throw new Error(`Conflicting duplicate target/stop cell: ${identity}`);
        }
        exactDuplicateCellCount += 1;
        continue;
      }
      uniqueCells.set(identity, { material, indexed });
    }
  }

  const partitions = new Map<string, IndexedCell[]>();
  for (const { indexed } of uniqueCells.values()) {
    const key = canonicalJsonStringify({
      evaluatorVersion: indexed.record.evaluatorVersion,
      policyFingerprint: indexed.record.policy.fingerprint,
    });
    const partition = partitions.get(key) ?? [];
    partition.push(indexed);
    partitions.set(key, partition);
  }

  const groups: AlertQualityTargetStopGroup[] = [];
  for (const partition of partitions.values()) {
    const first = partition[0]!;
    const compatibility = {
      evaluatorVersion: first.record.evaluatorVersion,
      policyFingerprint: first.record.policy.fingerprint,
    };
    for (const family of FAMILY_ORDER) {
      groups.push(makeGroup(partition, {
        dimension: 'OVERALL',
        value: null,
        family,
        ...compatibility,
      }));
    }
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
        for (const family of FAMILY_ORDER) {
          groups.push(makeGroup(bucket.cells, {
            dimension,
            value: bucket.value,
            family,
            ...compatibility,
          }));
        }
      }
    }
  }

  groups.sort((left, right) => left.groupKey.localeCompare(right.groupKey));
  return {
    schemaVersion: ALERT_QUALITY_TARGET_STOP_REPORT_SCHEMA_VERSION,
    generatorVersion: ALERT_QUALITY_TARGET_STOP_GENERATOR_VERSION,
    reportRunId: input.reportRunId,
    generatedAt: input.generatedAt,
    inputRecordCount: input.records.length,
    uniqueCellCount: uniqueCells.size,
    exactDuplicateCellCount,
    groupingDimensions: Object.freeze(dimensions),
    evaluatorVersions: Object.freeze([
      ...new Set(input.records.map((record) => record.evaluatorVersion)),
    ].sort()),
    policyFingerprints: Object.freeze([
      ...new Set(input.records.map((record) => record.policy.fingerprint)),
    ].sort()),
    groups: Object.freeze(groups),
  };
};

export const targetStopCellKey = (input: {
  targetStopOutcomeId: string;
  horizonMs: number;
  source: PriceSource;
}): string => canonicalJsonStringify(input);
