import type { PerformanceAnalyticsReport } from '../analytics/PerformanceAnalytics';
import type { StrategyDescriptor } from '../strategies/StrategyRegistry';

export type PlatformMode = 'PAPER' | 'LIVE';
export type PlatformSignal = 'BUY' | 'SELL' | 'WAIT';
export type PlatformLogLevel = 'INFO' | 'WARNING' | 'ERROR' | 'TRADE' | 'API';

export interface DashboardCandle {
  readonly instrumentId: string;
  readonly timestamp: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly confirmed: boolean;
  readonly fastEma: number | null;
  readonly slowEma: number | null;
  readonly rsi: number | null;
  readonly atr: number | null;
}

export interface DashboardPosition {
  readonly instrumentId: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly entryPrice: number;
  readonly currentPrice: number;
  readonly quantityBaseUnits: number;
  readonly stopLossPrice: number;
  readonly takeProfitPrice: number;
  readonly trailingStopPrice: number | null;
  readonly riskPercent: number;
  readonly rewardPercent: number;
  readonly unrealizedPnl: number;
  readonly openedAt: number;
  readonly durationMs: number;
}

export interface DashboardTrade {
  readonly tradeId: string;
  readonly instrumentId: string;
  readonly direction: 'LONG' | 'SHORT';
  readonly result: 'WIN' | 'LOSS' | 'BREAKEVEN';
  readonly openedAt: number;
  readonly closedAt: number;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly entryReason: string;
  readonly exitReason: string;
  readonly grossPnl: number;
  readonly fees: number;
  readonly fundingPnl: number;
  readonly netPnl: number;
  readonly rMultiple: number | null;
  readonly durationMs: number;
}

export interface DashboardStrategyStatus {
  readonly strategyId: string;
  readonly signal: PlatformSignal;
  readonly reasons: readonly string[];
  readonly checks: readonly {
    readonly label: string;
    readonly passed: boolean;
    readonly detail: string;
  }[];
  readonly updatedAt: number | null;
}

export interface DashboardLogEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly level: PlatformLogLevel;
  readonly message: string;
  readonly context: Readonly<Record<string, string | number | boolean | null>>;
}

export interface DashboardSettings {
  readonly mode: PlatformMode;
  readonly activeStrategyId: string;
  readonly fastEmaLength: number;
  readonly slowEmaLength: number;
  readonly rsiPeriod: number;
  readonly atrPeriod: number;
  readonly atrMultiplier: number;
  readonly minimumAtrPercent: number;
  readonly maximumAtrPercent: number;
  readonly riskPerTradePercent: number;
  readonly stopLossPercent: number;
  readonly takeProfitPercent: number;
  readonly trailingStopEnabled: boolean;
  readonly trailingStopPercent: number;
  readonly autoSave: boolean;
}

export interface DashboardOverview {
  readonly accountEquity: number;
  readonly pnlToday: number;
  readonly unrealizedPnl: number;
  readonly winRate: number;
  readonly currentPosition: string;
  readonly positionSize: number;
  readonly dailyReturnPercent: number;
  readonly currentStrategy: string;
  readonly mode: PlatformMode;
  readonly liveExecutionAllowed: false;
}

export interface TradingPlatformSnapshot {
  readonly generatedAt: number;
  readonly overview: DashboardOverview;
  readonly positions: readonly DashboardPosition[];
  readonly trades: readonly DashboardTrade[];
  readonly candles: Readonly<Record<string, readonly DashboardCandle[]>>;
  readonly strategyStatus: Readonly<Record<string, DashboardStrategyStatus>>;
  readonly logs: readonly DashboardLogEntry[];
  readonly analytics: PerformanceAnalyticsReport;
  readonly settings: DashboardSettings;
  readonly strategies: readonly StrategyDescriptor[];
  readonly risk: {
    readonly killSwitchActive: boolean;
    readonly liveExecutionAllowed: false;
  };
  readonly liveExecutionAllowed: false;
}
