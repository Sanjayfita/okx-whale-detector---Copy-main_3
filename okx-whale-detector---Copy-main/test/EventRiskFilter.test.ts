import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EVENT_RISK_FILTER_POLICY,
  evaluateEventRisk,
  type ScheduledRiskEvent,
} from '../src/risk/EventRiskFilter';

const EVENT_TIME = 1_700_000_000_000;

const event = (
  overrides: Partial<ScheduledRiskEvent> = {},
): ScheduledRiskEvent => ({
  eventId: 'fomc-1',
  title: 'Federal Reserve rate decision',
  category: 'FOMC',
  scheduledAt: EVENT_TIME,
  publishedAt: EVENT_TIME - 24 * 60 * 60 * 1_000,
  sourceId: 'federal-reserve-calendar',
  sourceReliability: 'VERIFIED_PRIMARY',
  severity: 'CRITICAL',
  scope: { kind: 'GLOBAL' },
  cancelled: false,
  ...overrides,
});

describe('evaluateEventRisk', () => {
  it('blocks trading inside a trusted applicable blackout window', () => {
    const decision = evaluateEventRisk({
      asOf: EVENT_TIME - 10 * 60_000,
      instrumentId: 'BTC-USDT-SWAP',
      sector: 'CRYPTO_MAJOR',
      events: [event()],
    });

    expect(decision.blocked).toBe(true);
    expect(decision.activeBlackouts).toHaveLength(1);
    expect(decision.activeBlackouts[0]?.category).toBe('FOMC');
    expect(decision.explanations[0]).toContain('Trading blocked');
    expect(decision.liveExecutionAllowed).toBe(false);
  });

  it('does not use unverified or future-published events', () => {
    const decision = evaluateEventRisk({
      asOf: EVENT_TIME,
      instrumentId: 'BTC-USDT-SWAP',
      sector: 'CRYPTO_MAJOR',
      events: [
        event({
          eventId: 'unverified-unlock',
          category: 'TOKEN_UNLOCK',
          sourceReliability: 'UNVERIFIED',
        }),
        event({
          eventId: 'future-known-etf',
          category: 'ETF_ANNOUNCEMENT',
          publishedAt: EVENT_TIME + 1,
        }),
      ],
    });

    expect(decision.blocked).toBe(false);
    expect(decision.ignoredEvents).toContainEqual({
      eventId: 'unverified-unlock',
      reason: 'SOURCE_NOT_TRUSTED',
    });
    expect(decision.ignoredEvents).toContainEqual({
      eventId: 'future-known-etf',
      reason: 'EVENT_NOT_KNOWN_AT_DECISION_TIME',
    });
  });

  it('can be disabled without deleting the configured event feed', () => {
    const decision = evaluateEventRisk({
      asOf: EVENT_TIME,
      instrumentId: 'BTC-USDT-SWAP',
      sector: 'CRYPTO_MAJOR',
      events: [event()],
      policy: { ...DEFAULT_EVENT_RISK_FILTER_POLICY, enabled: false },
    });

    expect(decision.blocked).toBe(false);
    expect(decision.activeBlackouts).toEqual([]);
    expect(decision.ignoredEvents[0]?.reason).toBe('EVENT_FILTER_DISABLED');
  });
});
