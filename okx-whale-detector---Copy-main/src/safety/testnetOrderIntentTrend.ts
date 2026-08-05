import type { TestnetOrderIntentDocument } from './testnetOrderIntentPersistence';

export type TestnetOrderIntentTrendDirection =
  | 'DECREASING_RISK'
  | 'STABLE'
  | 'INCREASING_RISK';

export interface TestnetOrderIntentTrendPoint {
  generatedAt: number;
  status: TestnetOrderIntentDocument['intent']['status'];
  estimatedNotional: number;
  maximumNotional: number;
  quantity: number;
  referencePrice: number;
}

export interface TestnetOrderIntentTrendSummary {
  instrumentId: string;
  side: TestnetOrderIntentDocument['intent']['side'];
  orderType: TestnetOrderIntentDocument['intent']['orderType'];
  direction: TestnetOrderIntentTrendDirection;
  points: readonly TestnetOrderIntentTrendPoint[];
  estimatedNotionalChange: number;
  maximumNotionalChange: number;
  riskIncreases: number;
  riskReductions: number;
  highestEstimatedNotional: number;
  lowestEstimatedNotional: number;
  reasons: readonly string[];
  dryRunOnly: true;
  transportDispatchAllowed: false;
  testnetExecutionAuthorized: false;
  orderExecutionAuthorized: false;
}

export const summarizeTestnetOrderIntentTrend = (
  documents: readonly TestnetOrderIntentDocument[],
): TestnetOrderIntentTrendSummary => {
  if (documents.length < 2) {
    throw new Error('At least two testnet order intent documents are required');
  }

  const sorted = [...documents].sort(
    (left, right) => left.generatedAt - right.generatedAt,
  );
  const firstIntent = sorted[0]!.intent;
  const timestamps = new Set<number>();

  for (const document of sorted) {
    if (timestamps.has(document.generatedAt)) {
      throw new Error(`Duplicate testnet order intent timestamp: ${document.generatedAt}`);
    }
    timestamps.add(document.generatedAt);

    const intent = document.intent;
    if (
      intent.instrumentId !== firstIntent.instrumentId ||
      intent.side !== firstIntent.side ||
      intent.orderType !== firstIntent.orderType
    ) {
      throw new Error(
        'Testnet order intents must describe the same instrument, side, and order type',
      );
    }
  }

  const points = sorted.map(
    (document): TestnetOrderIntentTrendPoint =>
      Object.freeze({
        generatedAt: document.generatedAt,
        status: document.intent.status,
        estimatedNotional: document.intent.estimatedNotional,
        maximumNotional: document.intent.maximumNotional,
        quantity: document.intent.quantity,
        referencePrice: document.intent.referencePrice,
      }),
  );

  let riskIncreases = 0;
  let riskReductions = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const becameMorePermissive =
      previous.status === 'REJECTED' && current.status === 'PREPARED_FOR_DRY_RUN';
    const becameMoreRestrictive =
      previous.status === 'PREPARED_FOR_DRY_RUN' && current.status === 'REJECTED';
    const exposureIncreased =
      current.estimatedNotional > previous.estimatedNotional ||
      current.maximumNotional > previous.maximumNotional;
    const exposureReduced =
      current.estimatedNotional < previous.estimatedNotional ||
      current.maximumNotional < previous.maximumNotional;

    if (becameMorePermissive || exposureIncreased) {
      riskIncreases += 1;
    } else if (becameMoreRestrictive || exposureReduced) {
      riskReductions += 1;
    }
  }

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const estimatedNotionalChange =
    last.estimatedNotional - first.estimatedNotional;
  const maximumNotionalChange = last.maximumNotional - first.maximumNotional;
  const reasons: string[] = [];
  let direction: TestnetOrderIntentTrendDirection;

  if (
    riskIncreases > riskReductions ||
    (riskIncreases === riskReductions &&
      (estimatedNotionalChange > 0 || maximumNotionalChange > 0))
  ) {
    direction = 'INCREASING_RISK';
    reasons.push('Dry-run intent permissiveness or exposure increased over time');
  } else if (
    riskReductions > riskIncreases ||
    (riskIncreases === riskReductions &&
      (estimatedNotionalChange < 0 || maximumNotionalChange < 0))
  ) {
    direction = 'DECREASING_RISK';
    reasons.push('Dry-run intent permissiveness or exposure decreased over time');
  } else {
    direction = 'STABLE';
    reasons.push('Dry-run intent safety exposure remained stable');
  }

  reasons.push('Trend analysis cannot dispatch or authorize any order');

  return Object.freeze({
    instrumentId: firstIntent.instrumentId,
    side: firstIntent.side,
    orderType: firstIntent.orderType,
    direction,
    points: Object.freeze(points),
    estimatedNotionalChange,
    maximumNotionalChange,
    riskIncreases,
    riskReductions,
    highestEstimatedNotional: Math.max(
      ...points.map((point) => point.estimatedNotional),
    ),
    lowestEstimatedNotional: Math.min(
      ...points.map((point) => point.estimatedNotional),
    ),
    reasons: Object.freeze(reasons),
    dryRunOnly: true,
    transportDispatchAllowed: false,
    testnetExecutionAuthorized: false,
    orderExecutionAuthorized: false,
  });
};
