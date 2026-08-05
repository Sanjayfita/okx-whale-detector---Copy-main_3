export interface BacktestTradeRecord {
  readonly id: string;
  readonly openedAt: number;
  readonly closedAt: number;
  readonly grossPnl: number;
  readonly feeCost: number;
  readonly fundingPnl: number;
  readonly netPnl: number;
  readonly initialRisk: number;
}

export interface EquityCurvePoint {
  readonly timestamp: number;
  readonly equity: number;
  readonly drawdown: number;
  readonly drawdownPercent: number;
}

export interface BacktestStatistics {
  readonly tradeCount: number;
  readonly winningTrades: number;
  readonly losingTrades: number;
  readonly breakevenTrades: number;
  readonly winRate: number;
  readonly grossProfit: number;
  readonly grossLoss: number;
  readonly netProfit: number;
  readonly profitFactor: number | null;
  readonly expectancy: number;
  readonly averageR: number | null;
  readonly sharpeRatio: number | null;
  readonly sortinoRatio: number | null;
  readonly maximumDrawdown: number;
  readonly maximumDrawdownPercent: number;
  readonly recoveryFactor: number | null;
  readonly averageHoldingTimeMs: number;
  readonly totalFees: number;
  readonly totalFundingPnl: number;
  readonly equityCurve: readonly EquityCurvePoint[];
}

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1_000;

const mean = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

const sampleStandardDeviation = (values: readonly number[]): number | null => {
  if (values.length < 2) {
    return null;
  }
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
  return variance > 0 ? Math.sqrt(variance) : null;
};

const requireFinite = (value: number, name: string): void => {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
};

const validateTrade = (trade: BacktestTradeRecord): void => {
  if (trade.id.trim().length === 0) {
    throw new Error('trade id must not be empty');
  }
  if (
    !Number.isSafeInteger(trade.openedAt) ||
    !Number.isSafeInteger(trade.closedAt) ||
    trade.openedAt < 0 ||
    trade.closedAt < trade.openedAt
  ) {
    throw new Error(`invalid timestamps for trade ${trade.id}`);
  }
  requireFinite(trade.grossPnl, 'grossPnl');
  requireFinite(trade.feeCost, 'feeCost');
  requireFinite(trade.fundingPnl, 'fundingPnl');
  requireFinite(trade.netPnl, 'netPnl');
  requireFinite(trade.initialRisk, 'initialRisk');
  if (trade.feeCost < 0 || trade.initialRisk <= 0) {
    throw new Error(`invalid costs or risk for trade ${trade.id}`);
  }
};

const calculateAnnualizationFactor = (
  trades: readonly BacktestTradeRecord[],
): number => {
  if (trades.length === 0) {
    return 1;
  }
  const first = trades[0];
  const last = trades[trades.length - 1];
  if (first === undefined || last === undefined) {
    return 1;
  }
  const elapsedYears = Math.max(
    (last.closedAt - first.openedAt) / YEAR_MS,
    1 / 365.25,
  );
  const tradesPerYear = Math.min(trades.length / elapsedYears, 24 * 365.25);
  return Math.sqrt(tradesPerYear);
};

export const calculateBacktestStatistics = (input: {
  readonly initialEquity: number;
  readonly trades: readonly BacktestTradeRecord[];
}): BacktestStatistics => {
  if (!Number.isFinite(input.initialEquity) || input.initialEquity <= 0) {
    throw new Error('initialEquity must be finite and greater than 0');
  }

  const trades = input.trades
    .slice()
    .sort(
      (left, right) =>
        left.closedAt - right.closedAt || left.openedAt - right.openedAt,
    );
  for (const trade of trades) {
    validateTrade(trade);
  }

  let equity = input.initialEquity;
  let peakEquity = input.initialEquity;
  let maximumDrawdown = 0;
  let maximumDrawdownPercent = 0;
  const returns: number[] = [];
  const equityCurve: EquityCurvePoint[] = [
    {
      timestamp: trades[0]?.openedAt ?? 0,
      equity,
      drawdown: 0,
      drawdownPercent: 0,
    },
  ];

  for (const trade of trades) {
    const equityBefore = equity;
    equity += trade.netPnl;
    peakEquity = Math.max(peakEquity, equity);
    const drawdown = Math.max(0, peakEquity - equity);
    const drawdownPercent = peakEquity > 0 ? drawdown / peakEquity : 0;
    maximumDrawdown = Math.max(maximumDrawdown, drawdown);
    maximumDrawdownPercent = Math.max(
      maximumDrawdownPercent,
      drawdownPercent,
    );
    returns.push(trade.netPnl / equityBefore);
    equityCurve.push({
      timestamp: trade.closedAt,
      equity,
      drawdown,
      drawdownPercent,
    });
  }

  const winningTrades = trades.filter((trade) => trade.netPnl > 0);
  const losingTrades = trades.filter((trade) => trade.netPnl < 0);
  const breakevenTrades = trades.length - winningTrades.length - losingTrades.length;
  const grossProfit = winningTrades.reduce(
    (sum, trade) => sum + trade.netPnl,
    0,
  );
  const grossLoss = Math.abs(
    losingTrades.reduce((sum, trade) => sum + trade.netPnl, 0),
  );
  const netProfit = trades.reduce((sum, trade) => sum + trade.netPnl, 0);
  const annualizationFactor = calculateAnnualizationFactor(trades);
  const returnDeviation = sampleStandardDeviation(returns);
  const averageReturn = mean(returns);
  const downsideDeviation =
    returns.length === 0
      ? null
      : Math.sqrt(
          returns.reduce(
            (sum, value) => sum + Math.min(0, value) ** 2,
            0,
          ) / returns.length,
        );
  const rMultiples = trades.map((trade) => trade.netPnl / trade.initialRisk);

  return {
    tradeCount: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    breakevenTrades,
    winRate: trades.length === 0 ? 0 : winningTrades.length / trades.length,
    grossProfit,
    grossLoss,
    netProfit,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    expectancy: trades.length === 0 ? 0 : netProfit / trades.length,
    averageR: rMultiples.length === 0 ? null : mean(rMultiples),
    sharpeRatio:
      returnDeviation === null
        ? null
        : (averageReturn / returnDeviation) * annualizationFactor,
    sortinoRatio:
      downsideDeviation === null || downsideDeviation === 0
        ? null
        : (averageReturn / downsideDeviation) * annualizationFactor,
    maximumDrawdown,
    maximumDrawdownPercent,
    recoveryFactor:
      maximumDrawdown > 0 ? netProfit / maximumDrawdown : null,
    averageHoldingTimeMs:
      trades.length === 0
        ? 0
        : mean(trades.map((trade) => trade.closedAt - trade.openedAt)),
    totalFees: trades.reduce((sum, trade) => sum + trade.feeCost, 0),
    totalFundingPnl: trades.reduce(
      (sum, trade) => sum + trade.fundingPnl,
      0,
    ),
    equityCurve,
  };
};
