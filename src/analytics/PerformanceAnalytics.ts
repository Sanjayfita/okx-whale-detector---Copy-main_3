export interface EquityPoint {
  readonly timestamp: number;
  readonly equity: number;
}

export interface AnalyticsTrade {
  readonly openedAt: number;
  readonly closedAt: number;
  readonly netPnl: number;
  readonly riskAmount: number;
}

export interface ReturnBucket {
  readonly minimumInclusive: number;
  readonly maximumExclusive: number;
  readonly count: number;
}

export interface HeatmapCell {
  readonly weekday: number;
  readonly hourUtc: number;
  readonly trades: number;
  readonly netPnl: number;
  readonly winRate: number;
}

export interface PerformanceAnalyticsReport {
  readonly trades: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRate: number;
  readonly netPnl: number;
  readonly profitFactor: number | null;
  readonly expectancy: number;
  readonly averageWin: number;
  readonly averageLoss: number;
  readonly largestWin: number;
  readonly largestLoss: number;
  readonly averageHoldingTimeMs: number;
  readonly averageR: number | null;
  readonly maximumDrawdownPercent: number;
  readonly sharpeRatio: number | null;
  readonly dailyReturnsPercent: readonly {
    readonly day: string;
    readonly returnPercent: number;
  }[];
  readonly monthlyReturnsPercent: readonly {
    readonly month: string;
    readonly returnPercent: number;
  }[];
  readonly returnDistribution: readonly ReturnBucket[];
  readonly rMultipleDistribution: readonly ReturnBucket[];
  readonly heatmap: readonly HeatmapCell[];
}

const requireTimestamp = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

const requirePositiveFinite = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive and finite`);
  }
};

const average = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

const sampleStandardDeviation = (values: readonly number[]): number => {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
};

const dayKey = (timestamp: number): string =>
  new Date(timestamp).toISOString().slice(0, 10);

const monthKey = (timestamp: number): string =>
  new Date(timestamp).toISOString().slice(0, 7);

const periodReturns = (
  points: readonly EquityPoint[],
  key: (timestamp: number) => string,
): readonly { readonly key: string; readonly returnPercent: number }[] => {
  const grouped = new Map<
    string,
    { firstTimestamp: number; firstEquity: number; lastTimestamp: number; lastEquity: number }
  >();

  for (const point of points) {
    const period = key(point.timestamp);
    const existing = grouped.get(period);
    if (existing === undefined) {
      grouped.set(period, {
        firstTimestamp: point.timestamp,
        firstEquity: point.equity,
        lastTimestamp: point.timestamp,
        lastEquity: point.equity,
      });
      continue;
    }
    if (point.timestamp < existing.firstTimestamp) {
      existing.firstTimestamp = point.timestamp;
      existing.firstEquity = point.equity;
    }
    if (point.timestamp >= existing.lastTimestamp) {
      existing.lastTimestamp = point.timestamp;
      existing.lastEquity = point.equity;
    }
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([period, values]) => ({
      key: period,
      returnPercent:
        values.firstEquity > 0
          ? ((values.lastEquity - values.firstEquity) / values.firstEquity) * 100
          : 0,
    }));
};

const maximumDrawdown = (points: readonly EquityPoint[]): number => {
  let peak = 0;
  let maximum = 0;
  for (const point of points.slice().sort((a, b) => a.timestamp - b.timestamp)) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) {
      maximum = Math.max(maximum, ((peak - point.equity) / peak) * 100);
    }
  }
  return maximum;
};

const buildDistribution = (
  values: readonly number[],
  bucketCount = 10,
): readonly ReturnBucket[] => {
  if (values.length === 0) return [];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (minimum === maximum) {
    return [{ minimumInclusive: minimum, maximumExclusive: maximum, count: values.length }];
  }
  const width = (maximum - minimum) / bucketCount;
  return Array.from({ length: bucketCount }, (_, index) => {
    const lower = minimum + width * index;
    const upper = index === bucketCount - 1 ? maximum + Number.EPSILON : lower + width;
    return {
      minimumInclusive: lower,
      maximumExclusive: upper,
      count: values.filter((value) => value >= lower && value < upper).length,
    };
  });
};

const buildHeatmap = (trades: readonly AnalyticsTrade[]): readonly HeatmapCell[] => {
  const cells = new Map<string, { trades: number; wins: number; netPnl: number }>();
  for (const trade of trades) {
    const date = new Date(trade.openedAt);
    const weekday = date.getUTCDay();
    const hourUtc = date.getUTCHours();
    const key = `${weekday}:${hourUtc}`;
    const cell = cells.get(key) ?? { trades: 0, wins: 0, netPnl: 0 };
    cell.trades += 1;
    cell.netPnl += trade.netPnl;
    if (trade.netPnl > 0) cell.wins += 1;
    cells.set(key, cell);
  }

  return [...cells.entries()]
    .map(([key, cell]) => {
      const [weekdayText, hourText] = key.split(':');
      return {
        weekday: Number(weekdayText),
        hourUtc: Number(hourText),
        trades: cell.trades,
        netPnl: cell.netPnl,
        winRate: cell.trades > 0 ? (cell.wins / cell.trades) * 100 : 0,
      };
    })
    .sort((left, right) => left.weekday - right.weekday || left.hourUtc - right.hourUtc);
};

export const calculatePerformanceAnalytics = (input: {
  readonly trades: readonly AnalyticsTrade[];
  readonly equityCurve: readonly EquityPoint[];
}): PerformanceAnalyticsReport => {
  const trades = input.trades.slice().sort((a, b) => a.closedAt - b.closedAt);
  const points = input.equityCurve.slice().sort((a, b) => a.timestamp - b.timestamp);

  for (const trade of trades) {
    requireTimestamp(trade.openedAt, 'trade.openedAt');
    requireTimestamp(trade.closedAt, 'trade.closedAt');
    if (trade.closedAt < trade.openedAt) {
      throw new Error('trade.closedAt must not precede trade.openedAt');
    }
    if (!Number.isFinite(trade.netPnl)) {
      throw new Error('trade.netPnl must be finite');
    }
    if (!Number.isFinite(trade.riskAmount) || trade.riskAmount < 0) {
      throw new Error('trade.riskAmount must be finite and non-negative');
    }
  }
  for (const point of points) {
    requireTimestamp(point.timestamp, 'equityPoint.timestamp');
    requirePositiveFinite(point.equity, 'equityPoint.equity');
  }

  const winners = trades.filter((trade) => trade.netPnl > 0);
  const losers = trades.filter((trade) => trade.netPnl < 0);
  const grossProfit = winners.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = -losers.reduce((sum, trade) => sum + trade.netPnl, 0);
  const netPnl = trades.reduce((sum, trade) => sum + trade.netPnl, 0);
  const rMultiples = trades
    .filter((trade) => trade.riskAmount > 0)
    .map((trade) => trade.netPnl / trade.riskAmount);
  const daily = periodReturns(points, dayKey);
  const monthly = periodReturns(points, monthKey);
  const dailyValues = daily.map((entry) => entry.returnPercent / 100);
  const dailyStd = sampleStandardDeviation(dailyValues);
  const sharpeRatio =
    dailyValues.length >= 2 && dailyStd > 0
      ? (average(dailyValues) / dailyStd) * Math.sqrt(365)
      : null;

  return {
    trades: trades.length,
    wins: winners.length,
    losses: losers.length,
    winRate: trades.length > 0 ? (winners.length / trades.length) * 100 : 0,
    netPnl,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : 0,
    expectancy: trades.length > 0 ? netPnl / trades.length : 0,
    averageWin: average(winners.map((trade) => trade.netPnl)),
    averageLoss: average(losers.map((trade) => trade.netPnl)),
    largestWin: winners.length > 0 ? Math.max(...winners.map((trade) => trade.netPnl)) : 0,
    largestLoss: losers.length > 0 ? Math.min(...losers.map((trade) => trade.netPnl)) : 0,
    averageHoldingTimeMs: average(
      trades.map((trade) => trade.closedAt - trade.openedAt),
    ),
    averageR: rMultiples.length > 0 ? average(rMultiples) : null,
    maximumDrawdownPercent: maximumDrawdown(points),
    sharpeRatio,
    dailyReturnsPercent: daily.map((entry) => ({
      day: entry.key,
      returnPercent: entry.returnPercent,
    })),
    monthlyReturnsPercent: monthly.map((entry) => ({
      month: entry.key,
      returnPercent: entry.returnPercent,
    })),
    returnDistribution: buildDistribution(trades.map((trade) => trade.netPnl)),
    rMultipleDistribution: buildDistribution(rMultiples),
    heatmap: buildHeatmap(trades),
  };
};
