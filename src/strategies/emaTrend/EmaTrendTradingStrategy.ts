import { evaluateEmaTrendStrategy } from '../../strategy/EmaTrendStrategy';
import type {
  StrategyContext,
  StrategySignalResult,
  TradingStrategy,
} from '../TradingStrategy';

const toAction = (
  action: ReturnType<typeof evaluateEmaTrendStrategy>['action'],
): StrategySignalResult['action'] => {
  if (action === 'ENTER_LONG') return 'BUY';
  if (action === 'ENTER_SHORT') return 'SELL';
  if (action === 'EXIT_LONG' || action === 'EXIT_SHORT') return 'EXIT';
  return 'WAIT';
};

const indicators = (
  value: ReturnType<typeof evaluateEmaTrendStrategy>['indicators'],
): Readonly<Record<string, number | null>> => ({
  previousFastEma: value?.previousFastEma ?? null,
  fastEma: value?.currentFastEma ?? null,
  previousSlowEma: value?.previousSlowEma ?? null,
  slowEma: value?.currentSlowEma ?? null,
  rsi: value?.rsi ?? null,
  atr: value?.atr ?? null,
  atrPercent: value?.atrPercent ?? null,
});

const evaluate = (context: StrategyContext): StrategySignalResult => {
  const result = evaluateEmaTrendStrategy({
    instrumentId: context.instrumentId,
    candles: context.candles,
    accountEquity: context.accountEquity,
    openPosition: context.openPosition,
    config: context.config,
  });

  // The maintained EMA evaluator historically used a fixed one-percent risk.
  // The platform keeps that as the hard ceiling while allowing the dashboard to
  // lower risk. Scaling is done here so every strategy still passes through the
  // same shared risk manager before an order can be simulated.
  const requestedRiskFraction = context.config.riskPerTradePercent / 100;
  const riskAmount =
    result.entryPrice === null ? 0 : context.accountEquity * requestedRiskFraction;
  const stopDistance =
    result.entryPrice !== null && result.stopLossPrice !== null
      ? Math.abs(result.entryPrice - result.stopLossPrice)
      : 0;
  const positionSizeBaseUnits =
    stopDistance > 0 ? riskAmount / stopDistance : 0;

  return {
    strategyId: result.strategyId,
    instrumentId: context.instrumentId,
    action: toAction(result.action),
    direction: result.direction,
    observedAt: result.observedAt,
    reasons: result.reasons,
    diagnostics: result.diagnostics,
    entryPrice: result.entryPrice,
    stopLossPrice: result.stopLossPrice,
    takeProfitPrice: result.takeProfitPrice,
    trailingStopPrice: result.trailingStopPrice,
    positionSizeBaseUnits,
    riskAmount,
    riskRewardRatio: result.riskRewardRatio,
    indicators: indicators(result.indicators),
    liveExecutionAllowed: false,
  };
};

export class EmaTrendTradingStrategy implements TradingStrategy {
  public readonly id = 'ema-trend-crossover-v1';
  public readonly label = 'EMA 20/50 Trend Crossover';

  public generateSignal(context: StrategyContext): StrategySignalResult {
    return evaluate(context);
  }

  public calculateStop(context: StrategyContext): number | null {
    return evaluate(context).stopLossPrice;
  }

  public calculateTakeProfit(context: StrategyContext): number | null {
    return evaluate(context).takeProfitPrice;
  }

  public calculatePositionSize(context: StrategyContext): number {
    return evaluate(context).positionSizeBaseUnits;
  }
}
