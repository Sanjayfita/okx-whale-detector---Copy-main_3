export type MarketStructureState =
  | 'BULLISH_BREAK'
  | 'BULLISH_SWEEP_RECLAIM'
  | 'BEARISH_BREAK'
  | 'BEARISH_SWEEP_RECLAIM'
  | 'RANGE';

/**
 * Point-in-time, derivatives-native inputs required by the proposed strategy.
 * Positive signed values are bullish; negative signed values are bearish.
 */
export interface DerivativeMarketSnapshot {
  readonly instrumentId: string;
  readonly observedAt: number;
  readonly markPrice: number;
  readonly indexPrice: number;
  readonly bestBid: number;
  readonly bestAsk: number;
  readonly atrPercent: number;
  readonly trendEfficiency: number;
  readonly trendAlignment: number;
  readonly volumeRatio: number;
  readonly priceChangePercent: number;
  readonly openInterestChangePercent: number;
  readonly aggressiveDeltaNormalized: number;
  readonly cvdSlopeNormalized: number;
  readonly orderBookImbalance: number;
  readonly liquidationImbalance: number;
  readonly fundingRatePercent: number;
  readonly vwapDeviationAtr: number;
  readonly marketStructure: MarketStructureState;
  readonly whaleDirectionalBias: number | null;
  readonly whaleAuthenticity: number | null;
}

const requireFinite = (value: number, name: string): void => {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
};

const requirePositive = (value: number, name: string): void => {
  requireFinite(value, name);
  if (value <= 0) {
    throw new Error(`${name} must be greater than 0`);
  }
};

const requireUnitInterval = (value: number, name: string): void => {
  requireFinite(value, name);
  if (value < 0 || value > 1) {
    throw new Error(`${name} must be between 0 and 1`);
  }
};

const requireSignedUnitInterval = (value: number, name: string): void => {
  requireFinite(value, name);
  if (value < -1 || value > 1) {
    throw new Error(`${name} must be between -1 and 1`);
  }
};

export const validateDerivativeMarketSnapshot = (
  snapshot: DerivativeMarketSnapshot,
): void => {
  if (snapshot.instrumentId.trim().length === 0) {
    throw new Error('instrumentId must not be empty');
  }
  if (!Number.isSafeInteger(snapshot.observedAt) || snapshot.observedAt < 0) {
    throw new Error('observedAt must be a non-negative safe integer');
  }

  requirePositive(snapshot.markPrice, 'markPrice');
  requirePositive(snapshot.indexPrice, 'indexPrice');
  requirePositive(snapshot.bestBid, 'bestBid');
  requirePositive(snapshot.bestAsk, 'bestAsk');
  if (snapshot.bestAsk <= snapshot.bestBid) {
    throw new Error('bestAsk must be greater than bestBid');
  }

  requirePositive(snapshot.atrPercent, 'atrPercent');
  requireUnitInterval(snapshot.trendEfficiency, 'trendEfficiency');
  requireSignedUnitInterval(snapshot.trendAlignment, 'trendAlignment');
  requireFinite(snapshot.volumeRatio, 'volumeRatio');
  if (snapshot.volumeRatio < 0) {
    throw new Error('volumeRatio must be non-negative');
  }

  requireFinite(snapshot.priceChangePercent, 'priceChangePercent');
  requireFinite(
    snapshot.openInterestChangePercent,
    'openInterestChangePercent',
  );
  requireSignedUnitInterval(
    snapshot.aggressiveDeltaNormalized,
    'aggressiveDeltaNormalized',
  );
  requireSignedUnitInterval(
    snapshot.cvdSlopeNormalized,
    'cvdSlopeNormalized',
  );
  requireSignedUnitInterval(
    snapshot.orderBookImbalance,
    'orderBookImbalance',
  );
  requireSignedUnitInterval(
    snapshot.liquidationImbalance,
    'liquidationImbalance',
  );
  requireFinite(snapshot.fundingRatePercent, 'fundingRatePercent');
  requireFinite(snapshot.vwapDeviationAtr, 'vwapDeviationAtr');

  if (
    snapshot.whaleDirectionalBias === null !==
    (snapshot.whaleAuthenticity === null)
  ) {
    throw new Error(
      'whaleDirectionalBias and whaleAuthenticity must both be present or null',
    );
  }
  if (snapshot.whaleDirectionalBias !== null) {
    requireSignedUnitInterval(
      snapshot.whaleDirectionalBias,
      'whaleDirectionalBias',
    );
  }
  if (snapshot.whaleAuthenticity !== null) {
    requireUnitInterval(snapshot.whaleAuthenticity, 'whaleAuthenticity');
  }
};

export const calculateSpreadBps = (
  snapshot: Pick<DerivativeMarketSnapshot, 'bestBid' | 'bestAsk'>,
): number => {
  const midpoint = (snapshot.bestBid + snapshot.bestAsk) / 2;
  return ((snapshot.bestAsk - snapshot.bestBid) / midpoint) * 10_000;
};

export const calculateBasisBps = (
  snapshot: Pick<DerivativeMarketSnapshot, 'markPrice' | 'indexPrice'>,
): number =>
  ((snapshot.markPrice - snapshot.indexPrice) / snapshot.indexPrice) * 10_000;
