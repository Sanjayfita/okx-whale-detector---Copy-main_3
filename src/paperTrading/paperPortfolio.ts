export type PaperTradeSide = 'BUY' | 'SELL';

export interface PaperTradeFill {
  fillId: string;
  instrumentId: string;
  side: PaperTradeSide;
  quantity: number;
  price: number;
  fee: number;
  executedAt: number;
}

export interface PaperPosition {
  instrumentId: string;
  quantity: number;
  averageEntryPrice: number;
  realizedPnl: number;
}

export interface PaperPortfolioSnapshot {
  generatedAt: number;
  initialCash: number;
  cash: number;
  realizedPnl: number;
  feesPaid: number;
  fills: readonly PaperTradeFill[];
  positions: readonly PaperPosition[];
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EPSILON = 1e-12;

const assertFiniteNonNegative = (name: string, value: number): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number`);
  }
};

const assertFinitePositive = (name: string, value: number): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a finite positive number`);
  }
};

const assertTimestamp = (name: string, value: number): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

const normalizeZero = (value: number): number => (Math.abs(value) < EPSILON ? 0 : value);

export const createPaperPortfolioSnapshot = (input: {
  generatedAt: number;
  initialCash: number;
  fills: readonly PaperTradeFill[];
}): PaperPortfolioSnapshot => {
  assertTimestamp('generatedAt', input.generatedAt);
  assertFiniteNonNegative('initialCash', input.initialCash);

  const seenFillIds = new Set<string>();
  const positions = new Map<string, PaperPosition>();
  let cash = input.initialCash;
  let realizedPnl = 0;
  let feesPaid = 0;

  const fills = [...input.fills].sort(
    (left, right) => left.executedAt - right.executedAt || left.fillId.localeCompare(right.fillId),
  );

  for (const fill of fills) {
    if (!IDENTIFIER_PATTERN.test(fill.fillId)) {
      throw new Error(`Invalid paper fill ID: ${fill.fillId}`);
    }
    if (!IDENTIFIER_PATTERN.test(fill.instrumentId)) {
      throw new Error(`Invalid paper instrument ID: ${fill.instrumentId}`);
    }
    if (seenFillIds.has(fill.fillId)) {
      throw new Error(`Duplicate paper fill ID: ${fill.fillId}`);
    }
    seenFillIds.add(fill.fillId);
    assertFinitePositive(`Fill ${fill.fillId} quantity`, fill.quantity);
    assertFinitePositive(`Fill ${fill.fillId} price`, fill.price);
    assertFiniteNonNegative(`Fill ${fill.fillId} fee`, fill.fee);
    assertTimestamp(`Fill ${fill.fillId} executedAt`, fill.executedAt);
    if (fill.executedAt > input.generatedAt) {
      throw new Error(`Fill ${fill.fillId} cannot be executed after generatedAt`);
    }

    const signedQuantity = fill.side === 'BUY' ? fill.quantity : -fill.quantity;
    const current = positions.get(fill.instrumentId) ?? {
      instrumentId: fill.instrumentId,
      quantity: 0,
      averageEntryPrice: 0,
      realizedPnl: 0,
    };

    const currentQuantity = current.quantity;
    const sameDirection =
      currentQuantity === 0 || Math.sign(currentQuantity) === Math.sign(signedQuantity);
    let nextQuantity = currentQuantity + signedQuantity;
    let nextAverageEntryPrice = current.averageEntryPrice;
    let fillRealizedPnl = 0;

    if (sameDirection) {
      const totalCost =
        Math.abs(currentQuantity) * current.averageEntryPrice + fill.quantity * fill.price;
      nextAverageEntryPrice = totalCost / Math.abs(nextQuantity);
    } else {
      const closingQuantity = Math.min(Math.abs(currentQuantity), fill.quantity);
      const direction = Math.sign(currentQuantity);
      fillRealizedPnl = closingQuantity * (fill.price - current.averageEntryPrice) * direction;

      if (Math.abs(signedQuantity) > Math.abs(currentQuantity)) {
        nextAverageEntryPrice = fill.price;
      } else if (Math.abs(signedQuantity) === Math.abs(currentQuantity)) {
        nextAverageEntryPrice = 0;
      }
    }

    nextQuantity = normalizeZero(nextQuantity);
    cash += fill.side === 'BUY' ? -fill.quantity * fill.price : fill.quantity * fill.price;
    cash -= fill.fee;
    feesPaid += fill.fee;
    realizedPnl += fillRealizedPnl;

    positions.set(
      fill.instrumentId,
      Object.freeze({
        instrumentId: fill.instrumentId,
        quantity: nextQuantity,
        averageEntryPrice: nextAverageEntryPrice,
        realizedPnl: current.realizedPnl + fillRealizedPnl,
      }),
    );
  }

  return Object.freeze({
    generatedAt: input.generatedAt,
    initialCash: input.initialCash,
    cash,
    realizedPnl,
    feesPaid,
    fills: Object.freeze(fills.map((fill) => Object.freeze({ ...fill }))),
    positions: Object.freeze(
      [...positions.values()].sort((left, right) => left.instrumentId.localeCompare(right.instrumentId)),
    ),
  });
};
