import type { DerivativeMarketSnapshot } from '../derivatives/DerivativeMarketSnapshot';
import {
  evaluateDerivativesFlowStrategy,
  type DerivativesFlowStrategyPolicy,
} from './DerivativesFlowStrategy';

export type LaboratoryDirection = 'LONG' | 'SHORT' | 'FLAT';

export interface StrategyObservation {
  readonly snapshot: DerivativeMarketSnapshot;
  readonly episodeId: string;
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

const decision = (input: Omit<LaboratoryDecision, 'liveExecutionAllowed'>): LaboratoryDecision => ({
  ...input,
  score: requireScore(input.score),
  liveExecutionAllowed: false,
});

export const createOriginalWhaleStrategyAdapter = (input: {
  readonly minimumAuthenticity?: number;
  readonly minimumDirectionalBias?: number;
} = {}): ResearchStrategy => {
  const minimumAuthenticity = input.minimumAuthenticity ?? 0.65;
  const minimumDirectionalBias = input.minimumDirectionalBias ?? 0.2;
  return {
    strategyId: 'original-whale-baseline',
    strategyVersion: 1,
    label: 'Original whale-only baseline',
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

export const createDerivativesFlowStrategyAdapter = (
  policy?: DerivativesFlowStrategyPolicy,
): ResearchStrategy => ({
  strategyId: 'derivatives-flow-v1',
  strategyVersion: 1,
  label: 'Derivatives flow-confirmed structure',
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
      status: result.status === 'QUALIFIED_FOR_RESEARCH' ? 'SIGNAL' : 'REJECTED',
      direction: result.direction ?? 'FLAT',
      score: result.weightedScore,
      reasons:
        result.rejectionReasons.length === 0
          ? result.confirmations
              .filter((confirmation) => confirmation.passed)
              .map((confirmation) => confirmation.name)
          : result.rejectionReasons,
      parameters: policy === undefined ? { policy: 'DEFAULT' } : { policy: 'CUSTOM' },
    });
  },
});

export const createTrendFollowingCandidate = (input: {
  readonly minimumTrendEfficiency?: number;
  readonly minimumTrendAlignment?: number;
  readonly maximumSpreadBps?: number;
} = {}): ResearchStrategy => {
  const minimumTrendEfficiency = input.minimumTrendEfficiency ?? 0.4;
  const minimumTrendAlignment = input.minimumTrendAlignment ?? 0.35;
  const maximumSpreadBps = input.maximumSpreadBps ?? 8;
  return {
    strategyId: 'trend-following-v1',
    strategyVersion: 1,
    label: 'Simple derivatives trend following',
    evaluate(observation) {
      const snapshot = observation.snapshot;
      const midpoint = (snapshot.bestBid + snapshot.bestAsk) / 2;
      const spreadBps = ((snapshot.bestAsk - snapshot.bestBid) / midpoint) * 10_000;
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
          ? Math.min(1, (snapshot.trendEfficiency + Math.abs(snapshot.trendAlignment)) / 2)
          : 0,
        reasons: passed ? ['TREND_AND_STRUCTURE_ALIGNED'] : ['TREND_FILTER_NOT_MET'],
        parameters: {
          minimumTrendEfficiency,
          minimumTrendAlignment,
          maximumSpreadBps,
        },
      });
    },
  };
};

export const createMeanReversionCandidate = (input: {
  readonly minimumAbsoluteVwapDeviationAtr?: number;
  readonly maximumTrendEfficiency?: number;
  readonly maximumAbsoluteBasisBps?: number;
} = {}): ResearchStrategy => {
  const minimumAbsoluteVwapDeviationAtr =
    input.minimumAbsoluteVwapDeviationAtr ?? 1.5;
  const maximumTrendEfficiency = input.maximumTrendEfficiency ?? 0.3;
  const maximumAbsoluteBasisBps = input.maximumAbsoluteBasisBps ?? 25;
  return {
    strategyId: 'mean-reversion-v1',
    strategyVersion: 1,
    label: 'VWAP mean reversion in range regimes',
    evaluate(observation) {
      const snapshot = observation.snapshot;
      const basisBps =
        ((snapshot.markPrice - snapshot.indexPrice) / snapshot.indexPrice) * 10_000;
      const passed =
        snapshot.marketStructure === 'RANGE' &&
        snapshot.trendEfficiency <= maximumTrendEfficiency &&
        Math.abs(snapshot.vwapDeviationAtr) >= minimumAbsoluteVwapDeviationAtr &&
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
        reasons: passed ? ['RANGE_VWAP_DISLOCATION'] : ['MEAN_REVERSION_FILTER_NOT_MET'],
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
      decisions: this.strategies.map((strategy) => strategy.evaluate(observation)),
      liveExecutionAllowed: false,
    };
  }
}
