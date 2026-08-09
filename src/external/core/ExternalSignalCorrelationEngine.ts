import type { MarketBias, MarketSignal } from '../../types/signal';
import type {
  EffectiveExternalSignal,
  ExternalSignalDirection,
} from '../types/ExternalWhaleSignal';

export interface ExternalSignalCorrelationConfig {
  okxWeight: number;
  externalWeight: number;
  minimumEffectiveConfidence: number;
  agreementBonus: number;
  contradictionPenalty: number;
  maximumConfidence: number;
}

export interface CorrelatedSignalContribution {
  signalId: string;
  underlyingEventId: string;
  provider: string;
  category: string;
  direction: ExternalSignalDirection;
  effectiveConfidence: number;
  signedScore: number;
  description: string;
}

export interface CorrelatedMarketSignal {
  symbol: string;
  bias: MarketBias;
  /** Certainty in the resulting directional bias. */
  confidence: number;
  /** Operational significance of the relationship between the two sources. */
  alertImportance: number;
  okxBias: MarketBias;
  okxConfidence: number;
  externalBias: MarketBias;
  externalConfidence: number;
  agreement:
    'AGREEMENT' | 'CONTRADICTION' | 'EXTERNAL_ONLY' | 'OKX_ONLY' | 'NEUTRAL';
  bullishExternalScore: number;
  bearishExternalScore: number;
  neutralExternalSignals: number;
  consideredSignals: number;
  ignoredSignals: number;
  contributions: CorrelatedSignalContribution[];
  reason: string;
  timestamp: number;
}

export const DEFAULT_EXTERNAL_SIGNAL_CORRELATION_CONFIG: ExternalSignalCorrelationConfig =
  {
    okxWeight: 0.7,
    externalWeight: 0.3,
    minimumEffectiveConfidence: 5,
    agreementBonus: 8,
    contradictionPenalty: 15,
    maximumConfidence: 100,
  };

const directionToScore = (direction: ExternalSignalDirection): number => {
  if (direction === 'BULLISH') {
    return 1;
  }

  if (direction === 'BEARISH') {
    return -1;
  }

  return 0;
};

const scoreToBias = (score: number): MarketBias => {
  if (score > 0) {
    return 'BULLISH';
  }

  if (score < 0) {
    return 'BEARISH';
  }

  return 'NEUTRAL';
};

export class ExternalSignalCorrelationEngine {
  private readonly config: ExternalSignalCorrelationConfig;

  public constructor(config: Partial<ExternalSignalCorrelationConfig> = {}) {
    this.config = {
      ...DEFAULT_EXTERNAL_SIGNAL_CORRELATION_CONFIG,
      ...config,
    };
    this.validateConfig();
  }

  public correlate(
    symbol: string,
    okxSignal: MarketSignal,
    externalSignals: readonly EffectiveExternalSignal[],
    now = Date.now(),
  ): CorrelatedMarketSignal {
    const contributions: CorrelatedSignalContribution[] = [];
    let bullishExternalScore = 0;
    let bearishExternalScore = 0;
    let neutralExternalSignals = 0;
    let ignoredSignals = 0;

    for (const effective of externalSignals) {
      if (
        effective.effectiveConfidence <
          this.config.minimumEffectiveConfidence ||
        effective.relevance <= 0 ||
        effective.freshness <= 0
      ) {
        ignoredSignals += 1;
        continue;
      }

      const directionalMultiplier = directionToScore(
        effective.signal.direction,
      );
      const signedScore = effective.effectiveConfidence * directionalMultiplier;

      if (signedScore > 0) {
        bullishExternalScore += signedScore;
      } else if (signedScore < 0) {
        bearishExternalScore += Math.abs(signedScore);
      } else {
        neutralExternalSignals += 1;
      }

      contributions.push({
        signalId: effective.signal.id,
        underlyingEventId: effective.signal.underlyingEventId,
        provider: effective.signal.provider,
        category: effective.signal.category,
        direction: effective.signal.direction,
        effectiveConfidence: effective.effectiveConfidence,
        signedScore,
        description: effective.signal.description,
      });
    }

    const externalNetScore = bullishExternalScore - bearishExternalScore;
    const externalTotalDirectionalScore =
      bullishExternalScore + bearishExternalScore;
    const externalBias = scoreToBias(externalNetScore);
    const externalConfidence =
      externalTotalDirectionalScore === 0
        ? 0
        : Math.min(
            this.config.maximumConfidence,
            (Math.abs(externalNetScore) / externalTotalDirectionalScore) *
              Math.min(
                externalTotalDirectionalScore,
                this.config.maximumConfidence,
              ),
          );

    const okxSignedScore =
      okxSignal.bias === 'BULLISH'
        ? okxSignal.confidence
        : okxSignal.bias === 'BEARISH'
          ? -okxSignal.confidence
          : 0;
    const externalSignedScore =
      externalBias === 'BULLISH'
        ? externalConfidence
        : externalBias === 'BEARISH'
          ? -externalConfidence
          : 0;

    let combinedScore =
      okxSignedScore * this.config.okxWeight +
      externalSignedScore * this.config.externalWeight;
    const agreement = this.classifyAgreement(okxSignal.bias, externalBias);

    if (agreement === 'AGREEMENT') {
      combinedScore += Math.sign(combinedScore) * this.config.agreementBonus;
    } else if (agreement === 'CONTRADICTION') {
      const penalty = Math.min(
        this.config.contradictionPenalty,
        Math.abs(combinedScore),
      );
      combinedScore -= Math.sign(combinedScore) * penalty;
    }

    const bias = scoreToBias(combinedScore);
    const confidence = Math.min(
      this.config.maximumConfidence,
      Math.max(0, Math.abs(combinedScore)),
    );
    const alertImportance = this.calculateAlertImportance(
      agreement,
      confidence,
      okxSignal.confidence,
      externalConfidence,
    );

    return {
      symbol,
      bias,
      confidence,
      alertImportance,
      okxBias: okxSignal.bias,
      okxConfidence: okxSignal.confidence,
      externalBias,
      externalConfidence,
      agreement,
      bullishExternalScore,
      bearishExternalScore,
      neutralExternalSignals,
      consideredSignals: contributions.length,
      ignoredSignals,
      contributions,
      reason: this.buildReason(
        okxSignal,
        externalBias,
        externalConfidence,
        agreement,
        contributions.length,
      ),
      timestamp: now,
    };
  }

  private classifyAgreement(
    okxBias: MarketBias,
    externalBias: MarketBias,
  ): CorrelatedMarketSignal['agreement'] {
    if (okxBias === 'NEUTRAL' && externalBias === 'NEUTRAL') {
      return 'NEUTRAL';
    }

    if (okxBias === 'NEUTRAL') {
      return 'EXTERNAL_ONLY';
    }

    if (externalBias === 'NEUTRAL') {
      return 'OKX_ONLY';
    }

    return okxBias === externalBias ? 'AGREEMENT' : 'CONTRADICTION';
  }

  private buildReason(
    okxSignal: MarketSignal,
    externalBias: MarketBias,
    externalConfidence: number,
    agreement: CorrelatedMarketSignal['agreement'],
    consideredSignals: number,
  ): string {
    if (consideredSignals === 0) {
      return `No relevant fresh external signals; using OKX ${okxSignal.bias.toLowerCase()} context only.`;
    }

    if (agreement === 'AGREEMENT') {
      return `OKX and external whale signals agree on ${okxSignal.bias.toLowerCase()} direction.`;
    }

    if (agreement === 'CONTRADICTION') {
      return `External ${externalBias.toLowerCase()} evidence conflicts with OKX ${okxSignal.bias.toLowerCase()} context, reducing confidence.`;
    }

    if (agreement === 'EXTERNAL_ONLY') {
      return `OKX is neutral while external whale evidence is ${externalBias.toLowerCase()} at ${externalConfidence.toFixed(1)}% confidence.`;
    }

    if (agreement === 'OKX_ONLY') {
      return `External evidence is directionally neutral; using OKX ${okxSignal.bias.toLowerCase()} context.`;
    }

    return 'Both OKX and external evidence are neutral.';
  }

  private calculateAlertImportance(
    relationship: CorrelatedMarketSignal['agreement'],
    directionalConfidence: number,
    okxConfidence: number,
    externalConfidence: number,
  ): number {
    let importance: number;

    if (relationship === 'AGREEMENT') {
      importance = directionalConfidence;
    } else if (relationship === 'CONTRADICTION') {
      importance = Math.min(okxConfidence, externalConfidence);
    } else if (relationship === 'EXTERNAL_ONLY') {
      importance = externalConfidence;
    } else if (relationship === 'OKX_ONLY') {
      importance = okxConfidence;
    } else {
      importance = 0;
    }

    return Math.min(this.config.maximumConfidence, Math.max(0, importance));
  }

  private validateConfig(): void {
    const {
      okxWeight,
      externalWeight,
      minimumEffectiveConfidence,
      agreementBonus,
      contradictionPenalty,
      maximumConfidence,
    } = this.config;

    if (
      !Number.isFinite(okxWeight) ||
      !Number.isFinite(externalWeight) ||
      okxWeight < 0 ||
      okxWeight > 1 ||
      externalWeight < 0 ||
      externalWeight > 1 ||
      Math.abs(okxWeight + externalWeight - 1) > 1e-9
    ) {
      throw new Error(
        'Correlation weights must be finite values between 0 and 1 that sum to 1',
      );
    }

    if (
      !Number.isFinite(minimumEffectiveConfidence) ||
      !Number.isFinite(agreementBonus) ||
      !Number.isFinite(contradictionPenalty) ||
      !Number.isFinite(maximumConfidence) ||
      minimumEffectiveConfidence < 0 ||
      minimumEffectiveConfidence > 100 ||
      agreementBonus < 0 ||
      agreementBonus > 100 ||
      contradictionPenalty < 0 ||
      contradictionPenalty > 100 ||
      maximumConfidence <= 0 ||
      maximumConfidence > 100
    ) {
      throw new Error(
        'Correlation confidence settings must be finite values within 0 to 100, with maximumConfidence greater than 0',
      );
    }
  }
}
