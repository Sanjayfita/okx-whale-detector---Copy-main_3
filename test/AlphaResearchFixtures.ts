import {
  createAlertOutcomeObservation,
  type AlertOutcomeHorizonMinutes,
  type AlertOutcomeObservation,
} from '../src/research/alertOutcomeObservation';
import type {
  AlphaResearchCandle,
  AlphaResearchEventSnapshot,
} from '../src/research/alphaFeatureTypes';
import { ALPHA_RESEARCH_EVENT_SNAPSHOT_SCHEMA_VERSION } from '../src/research/alphaFeatureTypes';
import {
  createQualifiedAlertEvidenceRecord,
  type QualifiedAlertDirection,
  type QualifiedAlertEvidenceRecord,
} from '../src/research/qualifiedAlertEvidence';

export const ALPHA_FIXTURE_EVALUATION_ID = 'alpha-fixture-evaluation';

export const createAlphaEvidenceFixture = (
  input: {
    readonly alertId?: string;
    readonly detectedAt?: number;
    readonly direction?: QualifiedAlertDirection;
    readonly evaluationId?: string;
  } = {},
): QualifiedAlertEvidenceRecord => {
  const detectedAt = input.detectedAt ?? 1_800_000_030_000;
  return createQualifiedAlertEvidenceRecord({
    evaluationId: input.evaluationId ?? ALPHA_FIXTURE_EVALUATION_ID,
    alertId: input.alertId ?? 'alpha-alert-1',
    instrumentId: 'BTC-USDT',
    detectedAt,
    recordedAt: detectedAt,
    direction: input.direction ?? 'BULLISH',
    signalType: 'WHALE_ABSORPTION',
    confidence: 80,
    referencePrice: 100,
    bestBid: 99.9,
    bestAsk: 100.1,
    spreadPercent: 0.2,
    sourceCommit: 'fixture',
    configurationFingerprint: 'alpha-fixture-config',
  });
};

export const createAlphaCandleFixtures = (
  detectedAt: number,
  count = 1_100,
): readonly AlphaResearchCandle[] => {
  const intervalMs = 60_000;
  const firstStart = detectedAt - 30_000 - count * intervalMs;
  return Object.freeze(
    Array.from({ length: count }, (_, index) => {
      const intervalStart = firstStart + index * intervalMs;
      const open = 100 + index * 0.02;
      const close = open + 0.01;
      return Object.freeze({
        intervalStart,
        intervalEnd: intervalStart + intervalMs,
        availabilityTimestamp: intervalStart + intervalMs,
        open,
        high: close + 0.05,
        low: open - 0.05,
        close,
        volume: 1_000 + (index % 20) * 25,
      });
    }),
  );
};

export const createAlphaSnapshotFixture = (
  input: {
    readonly alertId?: string;
    readonly detectedAt?: number;
    readonly direction?: QualifiedAlertDirection;
    readonly evaluationId?: string;
    readonly synthetic?: boolean;
  } = {},
): AlphaResearchEventSnapshot => {
  const evidence = createAlphaEvidenceFixture(input);
  return Object.freeze({
    schemaVersion: ALPHA_RESEARCH_EVENT_SNAPSHOT_SCHEMA_VERSION,
    evidence,
    candles: createAlphaCandleFixtures(evidence.detectedAt),
    orderBook: Object.freeze({
      eventTimestamp: evidence.detectedAt - 100,
      availabilityTimestamp: evidence.detectedAt - 50,
      bids: Object.freeze([
        Object.freeze({ price: 99.9, size: 3 }),
        Object.freeze({ price: 99.8, size: 2 }),
      ]),
      asks: Object.freeze([
        Object.freeze({ price: 100.1, size: 1 }),
        Object.freeze({ price: 100.2, size: 2 }),
      ]),
    }),
    trades: Object.freeze([
      Object.freeze({
        tradeId: `${evidence.alertId}-buy`,
        eventTimestamp: evidence.detectedAt - 500,
        availabilityTimestamp: evidence.detectedAt - 450,
        side: 'BUY' as const,
        price: 100,
        size: 2,
        notionalQuote: 200,
      }),
      Object.freeze({
        tradeId: `${evidence.alertId}-sell`,
        eventTimestamp: evidence.detectedAt - 300,
        availabilityTimestamp: evidence.detectedAt - 250,
        side: 'SELL' as const,
        price: 100,
        size: 0.5,
        notionalQuote: 50,
      }),
    ]),
    whale: Object.freeze({
      availabilityTimestamp: evidence.detectedAt,
      wallPersistenceMs: 12_000,
      refillCount: 3,
      spoofProbability: 0.1,
      absorptionScore: 0.8,
      executionRatio: 0.6,
      whaleNotionalQuote: 1_000_000,
    }),
    synthetic: input.synthetic ?? true,
    liveOrderExecutionAllowed: false,
  });
};

export const createAlphaOutcomeFixture = (input: {
  readonly snapshot: AlphaResearchEventSnapshot;
  readonly directionalReturnPercent?: number;
  readonly horizonMinutes?: AlertOutcomeHorizonMinutes;
}): AlertOutcomeObservation => {
  const directionalReturnPercent = input.directionalReturnPercent ?? 0.5;
  const directionMultiplier =
    input.snapshot.evidence.direction === 'BULLISH' ? 1 : -1;
  const rawReturnPercent = directionalReturnPercent * directionMultiplier;
  const horizonMinutes = input.horizonMinutes ?? 15;
  return createAlertOutcomeObservation({
    evaluationId: input.snapshot.evidence.evaluationId,
    alertId: input.snapshot.evidence.alertId,
    instrumentId: input.snapshot.evidence.instrumentId,
    detectedAt: input.snapshot.evidence.detectedAt,
    horizonMinutes,
    observedAt: input.snapshot.evidence.detectedAt + horizonMinutes * 60_000,
    referencePrice: input.snapshot.evidence.referencePrice,
    observedPrice:
      input.snapshot.evidence.referencePrice * (1 + rawReturnPercent / 100),
    rawReturnPercent,
    directionAdjustedReturnPercent: directionalReturnPercent,
    maximumFavorableExcursionPercent: Math.max(
      0,
      directionalReturnPercent + 0.1,
    ),
    maximumAdverseExcursionPercent: Math.max(0, 0.1 - directionalReturnPercent),
  });
};
