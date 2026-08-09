import type { PaperPortfolioSnapshot } from './paperPortfolio';

export interface PaperMarketMark {
  instrumentId: string;
  price: number;
  observedAt: number;
}

export interface PaperPositionValuation {
  instrumentId: string;
  quantity: number;
  averageEntryPrice: number;
  markPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  realizedPnl: number;
}

export interface PaperPortfolioValuation {
  generatedAt: number;
  cash: number;
  equity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  feesPaid: number;
  grossExposure: number;
  netExposure: number;
  positions: readonly PaperPositionValuation[];
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const assertTimestamp = (name: string, value: number): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

const assertFinitePositive = (name: string, value: number): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite positive number`);
  }
};

export const valuePaperPortfolio = (input: {
  generatedAt: number;
  portfolio: PaperPortfolioSnapshot;
  marks: readonly PaperMarketMark[];
}): PaperPortfolioValuation => {
  assertTimestamp('generatedAt', input.generatedAt);
  if (input.portfolio.generatedAt > input.generatedAt) {
    throw new Error('Paper portfolio snapshot cannot be newer than the valuation');
  }

  const marks = new Map<string, PaperMarketMark>();
  for (const mark of input.marks) {
    if (!IDENTIFIER_PATTERN.test(mark.instrumentId)) {
      throw new Error(`Invalid paper mark instrument ID: ${mark.instrumentId}`);
    }
    if (marks.has(mark.instrumentId)) {
      throw new Error(`Duplicate paper mark instrument ID: ${mark.instrumentId}`);
    }
    assertFinitePositive(`Mark ${mark.instrumentId} price`, mark.price);
    assertTimestamp(`Mark ${mark.instrumentId} observedAt`, mark.observedAt);
    if (mark.observedAt > input.generatedAt) {
      throw new Error(`Mark ${mark.instrumentId} cannot be observed after generatedAt`);
    }
    marks.set(mark.instrumentId, mark);
  }

  const positions = input.portfolio.positions
    .filter((position) => position.quantity !== 0)
    .map((position): PaperPositionValuation => {
      const mark = marks.get(position.instrumentId);
      if (mark === undefined) {
        throw new Error(`Missing paper mark for open position: ${position.instrumentId}`);
      }
      const marketValue = position.quantity * mark.price;
      const unrealizedPnl =
        position.quantity * (mark.price - position.averageEntryPrice);
      return Object.freeze({
        instrumentId: position.instrumentId,
        quantity: position.quantity,
        averageEntryPrice: position.averageEntryPrice,
        markPrice: mark.price,
        marketValue,
        unrealizedPnl,
        realizedPnl: position.realizedPnl,
      });
    })
    .sort((left, right) => left.instrumentId.localeCompare(right.instrumentId));

  const netExposure = positions.reduce((sum, position) => sum + position.marketValue, 0);
  const grossExposure = positions.reduce(
    (sum, position) => sum + Math.abs(position.marketValue),
    0,
  );
  const unrealizedPnl = positions.reduce(
    (sum, position) => sum + position.unrealizedPnl,
    0,
  );

  return Object.freeze({
    generatedAt: input.generatedAt,
    cash: input.portfolio.cash,
    equity: input.portfolio.cash + netExposure,
    realizedPnl: input.portfolio.realizedPnl,
    unrealizedPnl,
    feesPaid: input.portfolio.feesPaid,
    grossExposure,
    netExposure,
    positions: Object.freeze(positions),
  });
};
