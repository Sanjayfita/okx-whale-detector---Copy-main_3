import {
  tradingStrategyConfig,
  type TradingStrategyConfig,
} from '../config/tradingStrategyConfig';
import type { DerivativeMarketSnapshot } from '../derivatives/DerivativeMarketSnapshot';
import {
  evaluateDerivativesFlowStrategy,
  type DerivativesFlowStrategyPolicy,
} from './DerivativesFlowStrategy';
import {
  evaluateEmaTrendStrategy,
  type EmaTrendCandle,
  type EmaTrendOpenPosition,
} from './EmaTrendStrategy';

export type LaboratoryDirection = 'LONG' | 'SHORT' | 'FLAT';

export interface StrategyObservation {
  readonly snapshot: DerivativeMarketSnapshot;
  readonly episodeId: string;
  /** Confirmed candle history is required by the primary EMA strategy. */
  readonly candles?: readonly EmaTrendCandle[];
  /** Current paper/research equity is used for the strategy's fixed 1% risk sizing. */
  readonly accountEquity?: number;
  /** An existing position prevents duplicate entries and enables deterministic exits. */
  readonly openPosition?: EmaTrendOpenPosition | null;
}

export interface LaboratoryDecision {
  readonly strategyId: string;
  readonly strategyVersion: number;
  readonly instrumentId: string;
  readonly observedAt: number;
  readonly episodeId: string;
  readonly status: 'SIGNAL' | 'NO_SIGNAL' | 'REJECTED';
  readonly direction: LaboratoryDirection;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly parameters: Readonly<Record<string, number | string | boolean>>;
  readonly liveExecutionAllowed: false;
}

export interface ResearchStrategy {
  readonly strategyId: string;
  readonly strategyVersion: number;
  readonly label: string;
  evaluate(observation: StrategyObservation): LaboratoryDecision;
}

export interface StrategyLaboratoryResult {
  readonly instrumentId: string;
  readonly observedAt: number;
  readonly episodeId: string;
  readonly decisions: readonly LaboratoryDecision[];
  readonly liveExecutionAllowed: false;
}

const requireScore = (score: number): number => {
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error('strategy score must be between 0 and 1');
  }
  return score;
};

const decision = (
  input: Omit<LaboratoryDecision, 'liveExecutionAllowed'>,
): LaboratoryDecision => ({
  ...input,
  score: requireScore(input.score),
  liveExecutionAllowed: false,
});

/**
 * Primary trading-strategy adapter.
 *
 * Whale evidence is deliberately not consulted here. The strategy operates only
 * on confirmed candle history, current equity, and position state.
 */
export const createEmaTrendStrategyAdapter = (
  config: TradingStrategyConfig = tradingStrategyConfig,
): ResearchStrategy => ({
  strategyId: 'ema-trend-crossover-v1',
  strategyVersion: 1,
  label: 'EMA 20/50 crossover with RSI and ATR filters',
  evaluate(observation) {
    if (observation.candles === undefined || observation.accountEquity === undefined) {
      return decision({
        strategyId: 'ema-trend-crossover-v1',
        strategyVersion: 1,
        instrumentId: observation.snapshot.instrumentId,
        observedAt: observation.snapshot.observedAt,
        episodeId: observation.episodeId,
        status: 'NO_SIGNAL',
        direction: 'FLAT',
        score: 0,
        reasons: ['EMA_CANDLES_OR_EQUITY_MISSING'],
        parameters: {
          fastEmaLength: config.fastEmaLength,
          slowEmaLength: config.slowEmaLength,
          rsiPeriod: config.rsiPeriod,
          atrPeriod: config.atrPeriod,
          atrMultiplier: config.atrMultiplier,
          minimumAtrPercent: config.minimumAtrPercent,
          maximumAtrPercent: config.maximumAtrPercent,
          stopLossPercent: config.stopLossPercent,
          takeProfitPercent: config.takeProfitPercent,
          trailingStopEnabled: config.trailingStopEnabled,
          trailingStopPercent: config.trailingStopPercent,
        },
      });
    }

    const result = evaluateEmaTrendStrategy({
      instrumentId: observation.snapshot.instrumentId,
      candles: observation.candles,
      accountEquity: observation.accountEquity,
      openPosition: observation.openPosition,
      config,
    });
    const entrySignal =
      result.action === 'ENTER_LONG' || result.action === 'ENTER_SHORT';

    return decision({
      strategyId: 'ema-trend-crossover-v1',
      strategyVersion: 1,
      instrumentId: observation.snapshot.instrumentId,
      observedAt: result.observedAt ?? observation.snapshot.observedAt,
      episodeId: observation.episodeId,
      status: entrySignal ? 'SIGNAL' : 'NO_SIGNAL',
      direction: entrySignal ? (result.direction ?? 'FLAT') : 'FLAT',
      score: entrySignal ? 1 : 0,
      reasons: result.reasons,
      parameters: {
        fastEmaLength: config.fastEmaLength,
        slowEmaLength: config.slowEmaLength,
        rsiPeriod: config.rsiPeriod,
        atrPeriod: config.atrPeriod,
        atrMultiplier: config.atrMultiplier,
        minimumAtrPercent: config.minimumAtrPercent,
        maximumAtrPercent: config.maximumAtrPercent,
        stopLossPercent: config.stopLossPercent,
        takeProfitPercent: config.takeProfitPercent,
        trailingStopEnabled: config.trailingStopEnabled,
        trailingStopPercent: config.trailingStopPercent,
      },
    });
  },
});

/**
 * Historical research baseline only. Do not use this adapter as the primary
 * trading-entry strategy.
 */
export const createOriginalWhaleStrategyAdapter = (
  input: {
    readonly minimumAuthenticity?: number;
    readonly minimumDirectionalBias?: number;
  } = {},
): ResearchStrategy => {
  const minimumAuthenticity = input.minimumAuthenticity ?? 0.65;
  const minimumDirectionalBias = input.minimumDirectionalBias ?? 0.2;
  return {
    strategyId: 'original-whale-baseline',
    strategyVersion: 1,
    label: 'Historical whale-only research baseline',
    evaluate(observation) {
      const snapshot = observation.snapshot;
      if (
        snapshot.whaleAuthenticity === null ||
        snapshot.whaleDirectionalBias === null
      ) {
        return decision({
          strategyId: 'original-whale-baseline',
          strategyVersion: 1,
          instrumentId: snapshot.instrumentId,
          observedAt: snapshot.observedAt,
          episodeId: observation.episodeId,
          status: 'NO_SIGNAL',
          direction: 'FLAT',
          score: 0,
          reasons: ['WHALE_EVIDENCE_MISSING'],
          parameters: { minimumAuthenticity, minimumDirectionalBias },
        });
      }
      if (snapshot.whaleAuthenticity < minimumAuthenticity) {
        return decision({
          strategyId: 'original-whale-baseline',
          strategyVersion: 1,
          instrumentId: snapshot.instrumentId,
          observedAt: snapshot.observedAt,
          episodeId: observation.episodeId,
          status: 'REJECTED',
          direction: 'FLAT',
          score: snapshot.whaleAuthenticity,
          reasons: ['WHALE_AUTHENTICITY_TOO_LOW'],
          parameters: { minimumAuthenticity, minimumDirectionalBias },
        });
      }
      const absoluteBias = Math.abs(snapshot.whaleDirectionalBias);
      if (absoluteBias < minimumDirectionalBias) {
        return decision({
          strategyId: 'original-whale-baseline',
          strategyVersion: 1,
          instrumentId: snapshot.instrumentId,
          observedAt: snapshot.observedAt,
          episodeId: observation.episodeId,
          status: 'NO_SIGNAL',
          direction: 'FLAT',
          score: absoluteBias,
          reasons: ['WHALE_DIRECTIONAL_BIAS_TOO_WEAK'],
          parameters: { minimumAuthenticity, minimumDirectionalBias },
        });
      }
      return decision({
        strategyId: 'original-whale-baseline',
        strategyVersion: 1,
        instrumentId: snapshot.instrumentId,
        observedAt: snapshot.observedAt,
        episodeId: observation.episodeId,
        status: 'SIGNAL',
        direction: snapshot.whaleDirectionalBias > 0 ? 'LONG' : 'SHORT',
        score: Math.min(1, snapshot.whaleAuthenticity * absoluteBias),
        reasons: ['WHALE_WALL_DIRECTIONAL_BASELINE'],
        parameters: { minimumAuthenticity, minimumDirectionalBias },
      });
    },
  };
};

/** Research-only comparator retained for historical Phase 5/6 reproducibility. */
export const createDerivativesFlowStrategyAdapter = (
  policy?: DerivativesFlowStrategyPolicy,
): ResearchStrategy => ({
  strategyId: 'derivatives-flow-v1',
  strategyVersion: 1,
  label: 'Historical derivatives-flow research comparator',
  evaluate(observation) {
    const result = evaluateDerivativesFlowStrategy({
      snapshot: observation.snapshot,
      policy,
    });
    return decision({
      strategyId: 'derivatives-flow-v1',
      strategyVersion: 1,
      instrumentId: result.instrumentId,
      observedAt: result.observedAt,
      episodeId: observation.episodeId,
      status:
        result.status === 'QUALIFIED_FOR_RESEARCH' ? 'SIGNAL' : 'REJECTED',
      direction: result.direction ?? 'FLAT',
      score: result.weightedScore,
      reasons:
        result.rejectionReasons.length === 0
          ? result.confirmations
              .filter((confirmation) => confirmation.passed)
              .map((confirmation) => confirmation.name)
          : result.rejectionReasons,
      parameters:
        policy === undefined ? { policy: 'DEFAULT' } : { policy: 'CUSTOM' },
    });
  },
});

export const createTrendFollowingCandidate = (
  input: {
    readonly minimumTrendEfficiency?: number;
    readonly minimumTrendAlignment?: number;
    readonly maximumSpreadBps?: number;
  } = {},
): ResearchStrategy => {
  const minimumTrendEfficiency = input.minimumTrendEfficiency ?? 0.4;
  const minimumTrendAlignment = input.minimumTrendAlignment ?? 0.35;
  const maximumSpreadBps = input.maximumSpreadBps ?? 8;
  return {
    strategyId: 'trend-following-v1',
    strategyVersion: 1,
    label: 'Historical simple derivatives trend comparator',
    evaluate(observation) {
      const snapshot = observation.snapshot;
      const midpoint = (snapshot.bestBid + snapshot.bestAsk) / 2;
      const spreadBps =
        ((snapshot.bestAsk - snapshot.bestBid) / midpoint) * 10_000;
      const direction = snapshot.trendAlignment > 0 ? 'LONG' : 'SHORT';
      const passed =
        snapshot.trendEfficiency >= minimumTrendEfficiency &&
        Math.abs(snapshot.trendAlignment) >= minimumTrendAlignment &&
        spreadBps <= maximumSpreadBps &&
        snapshot.marketStructure !== 'RANGE';
      return decision({
        strategyId: 'trend-following-v1',
        strategyVersion: 1,
        instrumentId: snapshot.instrumentId,
        observedAt: snapshot.observedAt,
        episodeId: observation.episodeId,
        status: passed ? 'SIGNAL' : 'NO_SIGNAL',
        direction: passed ? direction : 'FLAT',
        score: passed
          ? Math.min(
              1,
              (snapshot.trendEfficiency + Math.abs(snapshot.trendAlignment)) / 2,
            )
          : 0,
        reasons: passed
          ? ['TREND_AND_STRUCTURE_ALIGNED']
          : ['TREND_FILTER_NOT_MET'],
        parameters: {
          minimumTrendEfficiency,
          minimumTrendAlignment,
          maximumSpreadBps,
        },
      });
    },
  };
};

export const createMeanReversionCandidate = (
  input: {
    readonly minimumAbsoluteVwapDeviationAtr?: number;
    readonly maximumTrendEfficiency?: number;
    readonly maximumAbsoluteBasisBps?: number;
  } = {},
): ResearchStrategy => {
  const minimumAbsoluteVwapDeviationAtr =
    input.minimumAbsoluteVwapDeviationAtr ?? 1.5;
  const maximumTrendEfficiency = input.maximumTrendEfficiency ?? 0.3;
  const maximumAbsoluteBasisBps = input.maximumAbsoluteBasisBps ?? 25;
  return {
    strategyId: 'mean-reversion-v1',
    strategyVersion: 1,
    label: 'Historical VWAP mean-reversion research comparator',
    evaluate(observation) {
      const snapshot = observation.snapshot;
      const basisBps =
        ((snapshot.markPrice - snapshot.indexPrice) / snapshot.indexPrice) *
        10_000;
      const passed =
        snapshot.marketStructure === 'RANGE' &&
        snapshot.trendEfficiency <= maximumTrendEfficiency &&
        Math.abs(snapshot.vwapDeviationAtr) >=
          minimumAbsoluteVwapDeviationAtr &&
        Math.abs(basisBps) <= maximumAbsoluteBasisBps;
      const direction: LaboratoryDirection =
        snapshot.vwapDeviationAtr > 0 ? 'SHORT' : 'LONG';
      return decision({
        strategyId: 'mean-reversion-v1',
        strategyVersion: 1,
        instrumentId: snapshot.instrumentId,
        observedAt: snapshot.observedAt,
        episodeId: observation.episodeId,
        status: passed ? 'SIGNAL' : 'NO_SIGNAL',
        direction: passed ? direction : 'FLAT',
        score: passed
          ? Math.min(1, Math.abs(snapshot.vwapDeviationAtr) / 3)
          : 0,
        reasons: passed
          ? ['RANGE_VWAP_DISLOCATION']
          : ['MEAN_REVERSION_FILTER_NOT_MET'],
        parameters: {
          minimumAbsoluteVwapDeviationAtr,
          maximumTrendEfficiency,
          maximumAbsoluteBasisBps,
        },
      });
    },
  };
};

export class StrategyLaboratory {
  private readonly strategies: readonly ResearchStrategy[];

  public constructor(strategies: readonly ResearchStrategy[]) {
    const ids = new Set<string>();
    for (const strategy of strategies) {
      if (ids.has(strategy.strategyId)) {
        throw new Error(`Duplicate strategy id ${strategy.strategyId}`);
      }
      ids.add(strategy.strategyId);
    }
    this.strategies = strategies.slice().sort((left, right) =>
      left.strategyId.localeCompare(right.strategyId),
    );
  }

  public evaluate(observation: StrategyObservation): StrategyLaboratoryResult {
    if (observation.episodeId.trim().length === 0) {
      throw new Error('episodeId must not be empty');
    }
    return {
      instrumentId: observation.snapshot.instrumentId,
      observedAt: observation.snapshot.observedAt,
      episodeId: observation.episodeId,
      decisions: this.strategies.map((strategy) =>
        strategy.evaluate(observation),
      ),
      liveExecutionAllowed: false,
    };
  }
}

/**
 * The maintained trading strategy boundary. New paper/shadow integrations should
 * use this factory rather than whale or multi-confirmation research comparators.
 */
export const createPrimaryStrategyLaboratory = (
  config: TradingStrategyConfig = tradingStrategyConfig,
): StrategyLaboratory =>
  new StrategyLaboratory([createEmaTrendStrategyAdapter(config)]);
