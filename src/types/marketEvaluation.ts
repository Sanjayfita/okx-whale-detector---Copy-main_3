import type { CorrelatedMarketSignal } from '../external/core/ExternalSignalCorrelationEngine';
import type { MarketSignal } from './signal';

export interface MarketEvaluation {
  marketSignal: MarketSignal;
  correlatedSignal?: CorrelatedMarketSignal;
}
