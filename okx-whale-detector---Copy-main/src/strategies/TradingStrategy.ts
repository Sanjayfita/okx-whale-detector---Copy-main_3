import type { TradingStrategyConfig } from '../config/tradingStrategyConfig';
import type {
  EmaTrendCandle,
  EmaTrendOpenPosition,
  TradeDirection,
} from '../strategy/EmaTrendStrategy';

export type StrategySignalAction = 'BUY' | 'SELL' | 'WAIT' | 'EXIT';

export interface StrategyContext {
  readonly instrumentId: string;
  readonly candles: readonly EmaTrendCandle[];
  readonly accountEquity: number;
  readonly openPosition?: EmaTrendOpenPosition | null;
  readonly config: TradingStrategyConfig;
}

export interface StrategySignalResult {
  readonly strategyId: string;
  readonly action: StrategySignalAction;
  readonly direction: TradeDirection | null;
  readonly observedAt: number | null;
  readonly reasons: readonly string[];
  readonly entryPrice: number | null;
  readonly stopLossPrice: number | null;
  readonly takeProfitPrice: number | null;
  readonly trailingStopPrice: number | null;
  readonly positionSizeBaseUnits: number;
  readonly riskAmount: number;
  readonly riskRewardRatio: number | null;
  readonly indicators: Readonly<Record<string, number | null>>;
  readonly liveExecutionAllowed: false;
}

/**
 * Stable extension point for dashboard-selectable strategies.
 *
 * Strategy implementations decide *what* they want to trade. Execution, account
 * bookkeeping, portfolio risk, notifications and live-order authorization remain
 * outside the strategy so a new strategy cannot bypass platform controls.
 */
export interface TradingStrategy {
  readonly id: string;
  readonly label: string;
  generateSignal(context: StrategyContext): StrategySignalResult;
  calculateStop(context: StrategyContext): number | null;
  calculateTakeProfit(context: StrategyContext): number | null;
  calculatePositionSize(context: StrategyContext): number;
}
