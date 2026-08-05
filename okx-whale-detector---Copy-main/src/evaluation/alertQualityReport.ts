export const ALERT_QUALITY_REPORT_SCHEMA_VERSION = 1 as const;
export const ALERT_QUALITY_REPORT_GENERATOR_VERSION =
  'alert-quality-report-generator-v1' as const;

export type NullableRate = number | null;

export interface NumericStatistics {
  observationCount: number;
  sum: number;
  mean: number | null;
  minimum: number | null;
  maximum: number | null;
}

export interface ReturnStatistics extends NumericStatistics {
  positiveCount: number;
  negativeCount: number;
  zeroCount: number;
  positiveRate: NullableRate;
}

export interface CoverageStatistics {
  totalCellCount: number;
  eligibleCellCount: number;
  ineligibleCellCount: number;
  ambiguousCellCount: number;
  missingCellCount: number;
  partialCellCount: number;
  invalidCellCount: number;
  eligibleRate: NullableRate;
  ineligibleRate: NullableRate;
  ambiguityRate: NullableRate;
  missingRate: NullableRate;
  partialRate: NullableRate;
  invalidRate: NullableRate;
}

export interface TargetStopStatistics {
  eligibleCount: number;
  ineligibleCount: number;
  ambiguousCount: number;
  targetFirstCount: number;
  stopFirstCount: number;
  neitherCount: number;
  tieCount: number;
  candleAmbiguityCount: number;
  resolvedCount: number;
  targetFirstRateAmongResolved: NullableRate;
  stopFirstRateAmongResolved: NullableRate;
  neitherRateAmongResolved: NullableRate;
  tieRateAmongResolved: NullableRate;
  ambiguityRateAmongEligible: NullableRate;
}
