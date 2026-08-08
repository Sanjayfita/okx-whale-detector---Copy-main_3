import {
  tradingStrategyConfig,
  type TradingStrategyConfig,
  validateTradingStrategyConfig,
} from '../config/tradingStrategyConfig';
import type { TimeframeLoadState } from './PlatformContracts';
import { PaperAccountLedger } from '../paper/PaperAccountLedger';
import { TradingRiskManager } from '../risk/TradingRiskManager';
import {
  createDefaultStrategyRegistry,
  type StrategyRegistry,
} from '../strategies/StrategyRegistry';
import type {
  DashboardCandle,
  DashboardLogEntry,
  DashboardSettings,
  DashboardStrategyStatus,
  PlatformLogLevel,
  PlatformMode,
  TradingPlatformSnapshot,
} from './PlatformContracts';

export interface PlatformStateStoreOptions {
  readonly startingEquity?: number;
  readonly mode?: PlatformMode;
  readonly maximumCandlesPerInstrument?: number;
  readonly maximumLogs?: number;
  readonly strategyRegistry?: StrategyRegistry;
  readonly riskManager?: TradingRiskManager;
  readonly now?: () => number;
}

type SnapshotSubscriber = (snapshot: TradingPlatformSnapshot) => void;

const defaultSettings = (mode: PlatformMode): DashboardSettings => ({
  mode,
  activeStrategyId: 'ema-trend-crossover-v1',
  timeframe: '1m',
  fastEmaLength: tradingStrategyConfig.fastEmaLength,
  slowEmaLength: tradingStrategyConfig.slowEmaLength,
  rsiPeriod: tradingStrategyConfig.rsiPeriod,
  atrPeriod: tradingStrategyConfig.atrPeriod,
  atrMultiplier: tradingStrategyConfig.atrMultiplier,
  minimumAtrPercent: tradingStrategyConfig.minimumAtrPercent,
  maximumAtrPercent: tradingStrategyConfig.maximumAtrPercent,
  riskPerTradePercent: tradingStrategyConfig.riskPerTradePercent,
  stopLossPercent: tradingStrategyConfig.stopLossPercent,
  takeProfitPercent: tradingStrategyConfig.takeProfitPercent,
  trailingStopEnabled: tradingStrategyConfig.trailingStopEnabled,
  trailingStopPercent: tradingStrategyConfig.trailingStopPercent,
  autoSave: true,
});

const toStrategyConfig = (settings: DashboardSettings): TradingStrategyConfig => ({
  fastEmaLength: settings.fastEmaLength,
  slowEmaLength: settings.slowEmaLength,
  rsiPeriod: settings.rsiPeriod,
  atrPeriod: settings.atrPeriod,
  atrMultiplier: settings.atrMultiplier,
  minimumAtrPercent: settings.minimumAtrPercent,
  maximumAtrPercent: settings.maximumAtrPercent,
  riskPerTradePercent: settings.riskPerTradePercent,
  stopLossPercent: settings.stopLossPercent,
  takeProfitPercent: settings.takeProfitPercent,
  trailingStopEnabled: settings.trailingStopEnabled,
  trailingStopPercent: settings.trailingStopPercent,
});

export class PlatformStateStore {
  public readonly account: PaperAccountLedger;
  public readonly riskManager: TradingRiskManager;
  public readonly strategies: StrategyRegistry;

  private settings: DashboardSettings;
  private readonly candles = new Map<string, DashboardCandle[]>();
  private readonly status = new Map<string, DashboardStrategyStatus>();
  private readonly logs: DashboardLogEntry[] = [];
  private readonly subscribers = new Set<SnapshotSubscriber>();
  private logSequence = 0;
  private readonly maximumCandlesPerInstrument: number;
  private readonly maximumLogs: number;
  private readonly now: () => number;
  private timeframeState: TimeframeLoadState = 'READY';
  private timeframeMessage = 'Using 1m confirmed OKX candles';

  public constructor(options: PlatformStateStoreOptions = {}) {
    this.account = new PaperAccountLedger(options.startingEquity ?? 10_000);
    this.riskManager = options.riskManager ?? new TradingRiskManager();
    this.strategies = options.strategyRegistry ?? createDefaultStrategyRegistry();
    this.settings = defaultSettings(options.mode ?? 'PAPER');
    this.maximumCandlesPerInstrument = options.maximumCandlesPerInstrument ?? 500;
    this.maximumLogs = options.maximumLogs ?? 1_000;
    this.now = options.now ?? Date.now;

    if (
      !Number.isSafeInteger(this.maximumCandlesPerInstrument) ||
      this.maximumCandlesPerInstrument <= 0
    ) {
      throw new Error('maximumCandlesPerInstrument must be a positive safe integer');
    }
    if (!Number.isSafeInteger(this.maximumLogs) || this.maximumLogs <= 0) {
      throw new Error('maximumLogs must be a positive safe integer');
    }
  }

  public getStrategyConfig(): TradingStrategyConfig {
    return toStrategyConfig(this.settings);
  }

  public getSettings(): DashboardSettings {
    return { ...this.settings };
  }

  public updateSettings(patch: Partial<DashboardSettings>): DashboardSettings {
    const next: DashboardSettings = { ...this.settings, ...patch };
    validateTradingStrategyConfig(toStrategyConfig(next));
    if (next.activeStrategyId !== this.settings.activeStrategyId) {
      this.strategies.select(next.activeStrategyId);
    }
    this.settings = next;
    this.log('INFO', 'Platform settings updated', {
      activeStrategyId: next.activeStrategyId,
      mode: next.mode,
      timeframe: next.timeframe,
      riskPerTradePercent: next.riskPerTradePercent,
    });
    this.publish();
    return this.getSettings();
  }

  public setTimeframeState(state: TimeframeLoadState, message: string): void {
    this.timeframeState = state;
    this.timeframeMessage = message;
    this.publish();
  }

  public clearStrategyMarketState(): void {
    this.candles.clear();
    this.status.clear();
    this.publish();
  }

  public setKillSwitch(active: boolean): void {
    this.riskManager.setKillSwitch(active);
    this.log(
      active ? 'WARNING' : 'INFO',
      active ? 'Kill switch activated' : 'Kill switch cleared',
    );
    this.publish();
  }

  public appendCandle(candle: DashboardCandle): void {
    if (candle.timeframe !== this.settings.timeframe) return;
    const history = this.candles.get(candle.instrumentId) ?? [];
    const existingIndex = history.findIndex(
      (candidate) => candidate.timestamp === candle.timestamp,
    );
    if (existingIndex >= 0) history[existingIndex] = candle;
    else {
      history.push(candle);
      history.sort((left, right) => left.timestamp - right.timestamp);
    }
    if (history.length > this.maximumCandlesPerInstrument) {
      history.splice(0, history.length - this.maximumCandlesPerInstrument);
    }
    this.candles.set(candle.instrumentId, history);
    this.publish();
  }

  public setStrategyStatus(status: DashboardStrategyStatus): void {
    this.status.set(status.strategyId, status);
    this.publish();
  }

  public log(
    level: PlatformLogLevel,
    message: string,
    context: Readonly<Record<string, string | number | boolean | null>> = {},
  ): DashboardLogEntry {
    const entry: DashboardLogEntry = {
      id: `log-${this.now()}-${this.logSequence++}`,
      timestamp: this.now(),
      level,
      message,
      context,
    };
    this.logs.push(entry);
    if (this.logs.length > this.maximumLogs) {
      this.logs.splice(0, this.logs.length - this.maximumLogs);
    }
    return entry;
  }

  public getLogs(level?: PlatformLogLevel): readonly DashboardLogEntry[] {
    return level === undefined
      ? this.logs.slice()
      : this.logs.filter((entry) => entry.level === level);
  }

  public subscribe(subscriber: SnapshotSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  public snapshot(timestamp = this.now()): TradingPlatformSnapshot {
    const account = this.account.snapshot(timestamp);
    const riskStatus = this.riskManager.getStatus();
    const positions = account.openPositions.map((position) => {
      const stopDistance = Math.abs(position.entryPrice - position.stopLossPrice);
      const targetDistance = Math.abs(position.takeProfitPrice - position.entryPrice);
      return {
        instrumentId: position.instrumentId,
        direction: position.direction,
        entryPrice: position.entryPrice,
        currentPrice: position.currentPrice,
        quantityBaseUnits: position.quantityBaseUnits,
        stopLossPrice: position.stopLossPrice,
        takeProfitPrice: position.takeProfitPrice,
        trailingStopPrice: position.trailingStopPrice,
        riskPercent: (stopDistance / position.entryPrice) * 100,
        rewardPercent: (targetDistance / position.entryPrice) * 100,
        unrealizedPnl: position.unrealizedPnl,
        openedAt: position.openedAt,
        durationMs: Math.max(0, timestamp - position.openedAt),
      };
    });
    const trades = account.trades.map((trade) => ({
      tradeId: trade.tradeId,
      instrumentId: trade.instrumentId,
      direction: trade.direction,
      result:
        trade.netPnl > 0
          ? ('WIN' as const)
          : trade.netPnl < 0
            ? ('LOSS' as const)
            : ('BREAKEVEN' as const),
      openedAt: trade.openedAt,
      closedAt: trade.closedAt,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      entryReason: trade.entryReason,
      exitReason: trade.exitReason,
      grossPnl: trade.grossPnl,
      fees: trade.fees,
      fundingPnl: trade.fundingPnl,
      netPnl: trade.netPnl,
      rMultiple: trade.rMultiple,
      durationMs: trade.durationMs,
    }));
    const currentPosition = positions[0];
    const startOfDay = new Date(timestamp);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const pnlToday = account.trades
      .filter((trade) => trade.closedAt >= startOfDay.getTime())
      .reduce((sum, trade) => sum + trade.netPnl, 0);
    const startOfDayEquity = Math.max(
      Number.EPSILON,
      account.equity - pnlToday - account.unrealizedPnl,
    );

    return {
      generatedAt: timestamp,
      overview: {
        accountEquity: account.equity,
        pnlToday,
        unrealizedPnl: account.unrealizedPnl,
        winRate: account.analytics.winRate,
        currentPosition:
          currentPosition === undefined
            ? 'FLAT'
            : `${currentPosition.direction} ${currentPosition.instrumentId}`,
        positionSize: currentPosition?.quantityBaseUnits ?? 0,
        dailyReturnPercent: (pnlToday / startOfDayEquity) * 100,
        currentStrategy: this.strategies.getActive().label,
        mode: this.settings.mode,
        timeframe: this.settings.timeframe,
        liveExecutionAllowed: false,
      },
      positions,
      trades,
      equityCurve: account.equityCurve,
      candles: Object.fromEntries(
        [...this.candles.entries()].map(([instrumentId, history]) => [
          instrumentId,
          history.slice(),
        ]),
      ),
      strategyStatus: Object.fromEntries(this.status.entries()),
      logs: this.logs.slice(),
      analytics: account.analytics,
      settings: this.getSettings(),
      strategies: this.strategies.list(),
      timeframe: {
        selected: this.settings.timeframe,
        state: this.timeframeState,
        message: this.timeframeMessage,
      },
      risk: {
        killSwitchActive: riskStatus.killSwitchActive,
        circuitBreakerActive: riskStatus.circuitBreakerActive,
        consecutiveLosses: riskStatus.consecutiveLosses,
        cooldownUntil: riskStatus.cooldownUntil,
        liveExecutionAllowed: false,
      },
      liveExecutionAllowed: false,
    };
  }

  private publish(): void {
    if (this.subscribers.size === 0) return;
    const snapshot = this.snapshot();
    for (const subscriber of this.subscribers) subscriber(snapshot);
  }
}
