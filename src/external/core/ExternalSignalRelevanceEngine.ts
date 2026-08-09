import type {
  EffectiveExternalSignal,
  ExternalSignalCategory,
  ExternalWhaleSignal,
} from '../types/ExternalWhaleSignal';

export interface ExternalSignalRelevanceConfig {
  categoryMaximumAgeMs: Readonly<Record<ExternalSignalCategory, number>>;
}

export interface ExternalSignalRelevanceOverrides {
  categoryMaximumAgeMs?: Partial<Record<ExternalSignalCategory, number>>;
}

const DEFAULT_MAXIMUM_AGE_MS: Readonly<Record<ExternalSignalCategory, number>> =
  {
    EXCHANGE_INFLOW: 6 * 60 * 60 * 1_000,
    EXCHANGE_OUTFLOW: 6 * 60 * 60 * 1_000,
    WALLET_TRANSFER: 3 * 60 * 60 * 1_000,
    STABLECOIN_MINT: 12 * 60 * 60 * 1_000,
    STABLECOIN_BURN: 12 * 60 * 60 * 1_000,
    PREDICTION_TRADE: 24 * 60 * 60 * 1_000,
    PREDICTION_POSITION: 24 * 60 * 60 * 1_000,
  };

export class ExternalSignalRelevanceEngine {
  private readonly config: ExternalSignalRelevanceConfig;

  public constructor(config: ExternalSignalRelevanceOverrides = {}) {
    this.config = {
      categoryMaximumAgeMs: {
        ...DEFAULT_MAXIMUM_AGE_MS,
        ...config.categoryMaximumAgeMs,
      },
    };

    for (const maximumAgeMs of Object.values(
      this.config.categoryMaximumAgeMs,
    )) {
      if (!Number.isFinite(maximumAgeMs) || maximumAgeMs <= 0) {
        throw new Error(
          'External signal maximum ages must be greater than zero',
        );
      }
    }
  }

  public evaluate(
    signal: ExternalWhaleSignal,
    marketSymbol: string,
    now = Date.now(),
  ): EffectiveExternalSignal {
    const relevance = this.calculateRelevance(signal, marketSymbol);
    const maximumAgeMs = this.config.categoryMaximumAgeMs[signal.category];
    const ageMs = Math.max(0, now - signal.occurredAt);
    const freshness = Math.max(0, 1 - ageMs / maximumAgeMs);

    return {
      signal,
      relevance,
      freshness,
      effectiveConfidence: signal.confidence * relevance * freshness,
    };
  }

  private calculateRelevance(
    signal: ExternalWhaleSignal,
    marketSymbol: string,
  ): number {
    const normalizedSymbol = marketSymbol.toUpperCase();

    if (signal.symbol?.toUpperCase() === normalizedSymbol) {
      return 1;
    }

    const marketAsset = normalizedSymbol.split('-')[0];
    const signalAsset = signal.asset?.toUpperCase();

    if (signalAsset && signalAsset === marketAsset) {
      return 0.9;
    }

    if (
      (signal.category === 'STABLECOIN_MINT' ||
        signal.category === 'STABLECOIN_BURN') &&
      (signalAsset === 'USDT' || signalAsset === 'USDC') &&
      normalizedSymbol.includes('USDT')
    ) {
      return 0.35;
    }

    return 0;
  }
}
