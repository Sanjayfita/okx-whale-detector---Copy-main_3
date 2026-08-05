import type { MarketBias } from './signal';
import type { SupportedInstType } from './instrument';

export type CorrelatedAlertProvenance = 'LIVE' | 'REPLAY' | 'SIMULATION';

export interface CorrelatedAlertEvaluationContext {
  instId: string;
  instType: SupportedInstType;
  okxBias: MarketBias;
  externalBias: MarketBias;
  /** UTC epoch milliseconds used to create the correlated market signal. */
  sourceSignalTimestamp: number;
  /** UTC epoch milliseconds supplied by the triggering OKX book update. */
  sourceMarketTimestamp: number;
  /** UTC epoch milliseconds for the captured bid/ask/midpoint reference. */
  referenceTimestamp: number;
  referenceMidpoint: number;
  referenceBestBid: number;
  referenceBestAsk: number;
  referenceSpread: number;
  referenceSpreadPercent: number;
  sourceSignalIds?: readonly string[];
}

export interface CorrelatedAlertRecordContext {
  provenance: CorrelatedAlertProvenance;
  evaluationContext: CorrelatedAlertEvaluationContext;
}
