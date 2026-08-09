import type {
  AggregateAlertOutcomeStatistics,
  AlertOutcomeHorizonStatistics,
} from './aggregateAlertOutcomeStatistics';

export const COST_ADJUSTED_PAPER_EVALUATION_SCHEMA_VERSION = 1 as const;

export interface PaperTradingCostAssumptions {
  roundTripFeePercent: number;
  slippagePercent: number;
  executionDelayPenaltyPercent: number;
}

export interface CostAdjustedHorizonEvaluation {
  horizonMinutes: AlertOutcomeHorizonStatistics['horizonMinutes'];
  sampleSize: number;
  grossAverageReturnPercent: number;
  totalCostPercent: number;
  netAverageReturnPercent: number;
  profitableAfterCosts: boolean;
}

export interface CostAdjustedPaperEvaluation {
  schemaVersion: typeof COST_ADJUSTED_PAPER_EVALUATION_SCHEMA_VERSION;
  evaluationId: string;
  assumptions: Readonly<PaperTradingCostAssumptions>;
  horizonEvaluations: readonly CostAdjustedHorizonEvaluation[];
  profitableHorizons: number;
  unprofitableHorizons: number;
  complete: true;
  paperOnly: true;
  orderExecutionAuthorized: false;
  liveOrderExecutionAllowed: false;
}

const requireFiniteNonNegative = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
  return value;
};

export const evaluateCostAdjustedPaperPerformance = (input: {
  statistics: AggregateAlertOutcomeStatistics;
  assumptions: PaperTradingCostAssumptions;
}): CostAdjustedPaperEvaluation => {
  const { statistics } = input;
  if (!statistics.complete || statistics.horizonStatistics.length === 0) {
    throw new Error('Complete aggregate statistics are required');
  }

  const assumptions = Object.freeze({
    roundTripFeePercent: requireFiniteNonNegative(
      input.assumptions.roundTripFeePercent,
      'roundTripFeePercent',
    ),
    slippagePercent: requireFiniteNonNegative(
      input.assumptions.slippagePercent,
      'slippagePercent',
    ),
    executionDelayPenaltyPercent: requireFiniteNonNegative(
      input.assumptions.executionDelayPenaltyPercent,
      'executionDelayPenaltyPercent',
    ),
  });

  const totalCostPercent =
    assumptions.roundTripFeePercent +
    assumptions.slippagePercent +
    assumptions.executionDelayPenaltyPercent;

  const horizonEvaluations = statistics.horizonStatistics.map(
    (horizon): CostAdjustedHorizonEvaluation => {
      const netAverageReturnPercent =
        horizon.averageDirectionAdjustedReturnPercent - totalCostPercent;
      return Object.freeze({
        horizonMinutes: horizon.horizonMinutes,
        sampleSize: horizon.sampleSize,
        grossAverageReturnPercent:
          horizon.averageDirectionAdjustedReturnPercent,
        totalCostPercent,
        netAverageReturnPercent,
        profitableAfterCosts: netAverageReturnPercent > 0,
      });
    },
  );

  const profitableHorizons = horizonEvaluations.filter(
    (result) => result.profitableAfterCosts,
  ).length;

  return Object.freeze({
    schemaVersion: COST_ADJUSTED_PAPER_EVALUATION_SCHEMA_VERSION,
    evaluationId: statistics.evaluationId,
    assumptions,
    horizonEvaluations: Object.freeze(horizonEvaluations),
    profitableHorizons,
    unprofitableHorizons: horizonEvaluations.length - profitableHorizons,
    complete: true,
    paperOnly: true,
    orderExecutionAuthorized: false,
    liveOrderExecutionAllowed: false,
  });
};
