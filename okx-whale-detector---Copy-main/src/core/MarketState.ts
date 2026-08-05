import { appConfig, type AppConfig } from '../config/appConfig';
import { validateAppConfig } from '../config/validateAppConfig';
import type { MarketInstrumentConfig } from '../types/instrument';

import { OrderBookManager } from './OrderBookManager';
import { WhaleTracker } from './WhaleTracker';
import { WhaleEventDetector } from './WhaleEventDetector';
import { WallDetector } from './WallDetector';
import { MarketAnalyzer } from './MarketAnalyzer';
import { CandleHistory } from './CandleHistory';
import { WhaleRefillDetector } from './WhaleRefillDetector';
import { WhaleScoreEngine } from './WhaleScoreEngine';
import { WhaleBehaviorEngine } from './WhaleBehaviorEngine';
import { BehaviorTransitionTracker } from './BehaviorTransitionTracker';
import { TradeFlowTracker } from './TradeFlowTracker';

const DEFAULT_INSTRUMENT: MarketInstrumentConfig = {
  instId: 'UNKNOWN-USDT',
  instType: 'SPOT',
  quoteCurrency: 'USDT',
  baseUnitsPerSize: 1,
};

export class MarketState {
  public readonly instrument: MarketInstrumentConfig;
  public readonly orderBookManager: OrderBookManager;
  public readonly whaleTracker: WhaleTracker;
  public readonly whaleScoreEngine: WhaleScoreEngine;
  public readonly whaleEventDetector: WhaleEventDetector;
  public readonly wallDetector: WallDetector;
  public readonly marketAnalyzer: MarketAnalyzer;
  public readonly candleHistory: CandleHistory;
  public readonly whaleRefillDetector: WhaleRefillDetector;
  public readonly whaleBehaviorEngine: WhaleBehaviorEngine;
  public readonly tradeFlowTracker: TradeFlowTracker;
  public readonly behaviorTransitionTracker = new BehaviorTransitionTracker();

  public constructor(
    config: AppConfig = appConfig,
    instrument: MarketInstrumentConfig = DEFAULT_INSTRUMENT,
    clock: () => number = Date.now,
  ) {
    validateAppConfig(config);

    this.instrument = instrument;
    this.orderBookManager = new OrderBookManager(
      instrument,
      config.history.orderBookLevelLimit,
    );
    this.whaleTracker = new WhaleTracker(config.tracker);
    this.whaleScoreEngine = new WhaleScoreEngine(config.scoring);

    this.whaleEventDetector = new WhaleEventDetector({
      removalGraceMs: config.events.removalGraceMs,
      minimumChangePercent: config.events.minimumChangePercent,
      minimumChangeNotional: config.events.minimumChangeNotional,
    });

    this.wallDetector = new WallDetector({
      minNotionalQuote: config.whale.minimumNotionalQuote,
      persistentAfterMs: config.whale.persistentAfterMs,
      strongAfterMs: config.whale.strongAfterMs,
      priceTolerancePercent: config.whale.movementPriceTolerancePercent,
      removalGracePeriodMs: config.events.removalGraceMs,
    });

    this.marketAnalyzer = new MarketAnalyzer(config.market);
    this.candleHistory = new CandleHistory(config.history.candleLimit);
    this.whaleRefillDetector = new WhaleRefillDetector(config.refill);
    this.whaleBehaviorEngine = new WhaleBehaviorEngine(config.behavior);
    this.tradeFlowTracker = new TradeFlowTracker(instrument.baseUnitsPerSize, {
      clock,
    });
  }

  public resetOrderBookDerivedState(): void {
    this.whaleTracker.reset();
    this.whaleScoreEngine.reset();
    this.whaleEventDetector.reset();
    this.wallDetector.reset();
    this.whaleRefillDetector.reset();
    this.whaleBehaviorEngine.reset();
    this.behaviorTransitionTracker.reset();
  }
}
