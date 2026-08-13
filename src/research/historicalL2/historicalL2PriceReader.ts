import type { LiveMarketPriceObservation } from '../../market/MarketEngine';
import type { LivePriceSnapshot } from '../liveEvidenceCollector';

export class HistoricalL2PriceReader {
  private readonly latest = new Map<string, LivePriceSnapshot>();

  public observe = (observation: LiveMarketPriceObservation): void => {
    const existing = this.latest.get(observation.instrumentId);
    if (existing !== undefined && existing.observedAt > observation.observedAt) {
      throw new Error('Historical midpoint observations must be chronological per instrument');
    }
    this.latest.set(observation.instrumentId, Object.freeze({
      instrumentId: observation.instrumentId,
      observedAt: observation.observedAt,
      sourceMarketTimestamp: observation.sourceMarketTimestamp,
      sourceMarketAgeMs: observation.observedAt - observation.sourceMarketTimestamp,
      sourceMarketDataSource: 'OKX_HISTORICAL_L2_MIDPOINT',
      price: observation.price,
    }));
  };

  public readPrice = async (instrumentId: string, dueAt: number): Promise<LivePriceSnapshot> => {
    const latest = this.latest.get(instrumentId);
    if (latest === undefined) throw new Error(`No historical L2 midpoint is available for ${instrumentId}`);
    if (latest.observedAt < dueAt) throw new Error('Historical L2 midpoint predates the requested due time');
    return latest;
  };
}
