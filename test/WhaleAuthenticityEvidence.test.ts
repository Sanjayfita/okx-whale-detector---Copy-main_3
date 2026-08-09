import { describe, expect, it } from 'vitest';

import {
  buildWhaleAuthenticityDataset,
  createWhaleAuthenticityEventObservation,
  createWhaleAuthenticityOutcomeObservation,
  extractWhaleAuthenticityFeatures,
} from '../src/research/whaleAuthenticityEvidence';

const createEvent = (
  alertId: string,
  side: 'BID' | 'ASK' = 'BID',
) =>
  createWhaleAuthenticityEventObservation({
    evaluationId: 'authenticity-test',
    alertId,
    instrumentId: 'BTC-USDT',
    wallId: `wall-${alertId}`,
    detectedAt: 1_800_000_000_000 + Number(alertId.replace(/\D/g, '')),
    availabilityTimestamp:
      1_800_000_000_000 + Number(alertId.replace(/\D/g, '')),
    side,
    whalePrice: side === 'BID' ? 99 : 101,
    referencePrice: 100,
    whaleNotionalQuote: 1_200_000,
    wallPersistenceMs: 120_000,
    refillCount: 3,
    lifecycleUpdateCount: 20,
    increaseCount: 6,
    decreaseCount: 4,
    initialNotionalQuote: 1_000_000,
    peakNotionalQuote: 1_500_000,
    minimumNotionalQuote: 800_000,
    matchingAggressiveNotionalQuote: 600_000,
    executionRatio: 0.5,
    spoofProbability: 0.1,
    absorptionScore: 0.8,
  });

const createOutcome = (
  event: ReturnType<typeof createEvent>,
  classification:
    | 'LIKELY_EXECUTED'
    | 'POSSIBLE_CANCELLATION'
    | 'UNCONFIRMED_DISAPPEARANCE',
) =>
  createWhaleAuthenticityOutcomeObservation({
    evaluationId: event.evaluationId,
    alertId: event.alertId,
    instrumentId: event.instrumentId,
    wallId: event.wallId,
    detectedAt: event.detectedAt,
    observedAt: event.detectedAt + 30_000,
    classification,
    finalLifetimeMs: 150_000,
    finalExecutedRatio: classification === 'LIKELY_EXECUTED' ? 0.8 : 0.01,
    finalMatchingAggressiveNotionalQuote:
      classification === 'LIKELY_EXECUTED' ? 960_000 : 12_000,
  });

describe('whale authenticity evidence', () => {
  it('extracts event-time lifecycle features without using removal outcomes', () => {
    const event = createEvent('alert-1');
    const features = extractWhaleAuthenticityFeatures(event);

    expect(features.wallPersistenceSeconds).toBe(120);
    expect(features.increaseRatePerMinute).toBe(3);
    expect(features.decreaseRatePerMinute).toBe(2);
    expect(features.directionalDistanceFromMarketPercent).toBeCloseTo(-1);
    expect(features.absoluteDistanceFromMarketPercent).toBeCloseTo(1);
    expect(features.notionalChangeFromInitialPercent).toBeCloseTo(20);
    expect(features.peakDrawdownPercent).toBeCloseTo(20);
    expect(features.recoveryFromMinimumPercent).toBeCloseTo(50);
    expect(features.executionRatio).toBe(0.5);
  });

  it('joins only confirmed execution or cancellation labels and audits exclusions', () => {
    const authentic = createEvent('alert-1');
    const cancelled = createEvent('alert-2', 'ASK');
    const unconfirmed = createEvent('alert-3');
    const missing = createEvent('alert-4');
    const unmatchedEvent = createEvent('alert-5');
    const report = buildWhaleAuthenticityDataset({
      events: [authentic, cancelled, unconfirmed, missing],
      outcomes: [
        createOutcome(authentic, 'LIKELY_EXECUTED'),
        createOutcome(cancelled, 'POSSIBLE_CANCELLATION'),
        createOutcome(unconfirmed, 'UNCONFIRMED_DISAPPEARANCE'),
        createOutcome(unmatchedEvent, 'LIKELY_EXECUTED'),
      ],
    });

    expect(report.rows).toHaveLength(2);
    expect(report.authenticExecutionCount).toBe(1);
    expect(report.deceptiveCancellationCount).toBe(1);
    expect(report.unconfirmedOutcomeCount).toBe(1);
    expect(report.missingOutcomeCount).toBe(1);
    expect(report.unmatchedOutcomeCount).toBe(1);
    expect(report.rows[0]?.label).toBe('AUTHENTIC_EXECUTION');
    expect(report.rows[1]?.label).toBe('DECEPTIVE_CANCELLATION');
    expect(report.liveOrderExecutionAllowed).toBe(false);
  });

  it('rejects future-informed event features', () => {
    expect(() =>
      createWhaleAuthenticityEventObservation({
        ...createEvent('alert-1'),
        availabilityTimestamp: createEvent('alert-1').detectedAt + 1,
      }),
    ).toThrow(/available no later than detectedAt/);
  });

  it('rejects impossible lifecycle extrema', () => {
    expect(() =>
      createWhaleAuthenticityEventObservation({
        ...createEvent('alert-1'),
        peakNotionalQuote: 1_000_000,
      }),
    ).toThrow(/extrema are inconsistent/);
  });
});
