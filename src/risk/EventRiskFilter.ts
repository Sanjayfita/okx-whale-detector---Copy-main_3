export type EventRiskCategory =
  | 'CPI'
  | 'FOMC'
  | 'NFP'
  | 'EXCHANGE_MAINTENANCE'
  | 'TOKEN_UNLOCK'
  | 'ETF_ANNOUNCEMENT'
  | 'OTHER_HIGH_IMPACT';

export type EventSourceReliability =
  | 'VERIFIED_PRIMARY'
  | 'VERIFIED_SECONDARY'
  | 'UNVERIFIED';

export interface ScheduledRiskEvent {
  readonly eventId: string;
  readonly title: string;
  readonly category: EventRiskCategory;
  readonly scheduledAt: number;
  readonly publishedAt: number;
  readonly sourceId: string;
  readonly sourceReliability: EventSourceReliability;
  readonly severity: 'HIGH' | 'CRITICAL';
  readonly scope:
    | Readonly<{ kind: 'GLOBAL' }>
    | Readonly<{ kind: 'INSTRUMENTS'; instrumentIds: readonly string[] }>
    | Readonly<{ kind: 'SECTORS'; sectors: readonly string[] }>;
  readonly cancelled: boolean;
}

export interface EventBlackoutWindow {
  readonly beforeMs: number;
  readonly afterMs: number;
}

export interface EventRiskFilterPolicy {
  readonly enabled: boolean;
  readonly enabledCategories: readonly EventRiskCategory[];
  readonly acceptedSourceReliability: readonly EventSourceReliability[];
  readonly defaultWindows: Readonly<Record<EventRiskCategory, EventBlackoutWindow>>;
  readonly eventOverrides: Readonly<Record<string, EventBlackoutWindow>>;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export const DEFAULT_EVENT_RISK_FILTER_POLICY: EventRiskFilterPolicy = {
  enabled: true,
  enabledCategories: [
    'CPI',
    'FOMC',
    'NFP',
    'EXCHANGE_MAINTENANCE',
    'TOKEN_UNLOCK',
    'ETF_ANNOUNCEMENT',
    'OTHER_HIGH_IMPACT',
  ],
  acceptedSourceReliability: ['VERIFIED_PRIMARY', 'VERIFIED_SECONDARY'],
  defaultWindows: {
    CPI: { beforeMs: 30 * MINUTE_MS, afterMs: 30 * MINUTE_MS },
    FOMC: { beforeMs: HOUR_MS, afterMs: HOUR_MS },
    NFP: { beforeMs: 30 * MINUTE_MS, afterMs: 30 * MINUTE_MS },
    EXCHANGE_MAINTENANCE: { beforeMs: HOUR_MS, afterMs: HOUR_MS },
    TOKEN_UNLOCK: { beforeMs: 2 * HOUR_MS, afterMs: 2 * HOUR_MS },
    ETF_ANNOUNCEMENT: { beforeMs: HOUR_MS, afterMs: HOUR_MS },
    OTHER_HIGH_IMPACT: { beforeMs: 30 * MINUTE_MS, afterMs: 30 * MINUTE_MS },
  },
  eventOverrides: {},
};

export interface EventRiskDecision {
  readonly observedAt: number;
  readonly instrumentId: string;
  readonly blocked: boolean;
  readonly activeBlackouts: readonly Readonly<{
    eventId: string;
    title: string;
    category: EventRiskCategory;
    scheduledAt: number;
    blackoutStart: number;
    blackoutEnd: number;
    sourceId: string;
  }>[];
  readonly ignoredEvents: readonly Readonly<{
    eventId: string;
    reason: string;
  }>[];
  readonly explanations: readonly string[];
  readonly liveExecutionAllowed: false;
}

const validateWindow = (window: EventBlackoutWindow, name: string): void => {
  if (
    !Number.isSafeInteger(window.beforeMs) ||
    !Number.isSafeInteger(window.afterMs) ||
    window.beforeMs < 0 ||
    window.afterMs < 0
  ) {
    throw new Error(`${name} blackout window must contain non-negative integers`);
  }
};

const appliesToInstrument = (input: {
  readonly event: ScheduledRiskEvent;
  readonly instrumentId: string;
  readonly sector: string;
}): boolean => {
  switch (input.event.scope.kind) {
    case 'GLOBAL':
      return true;
    case 'INSTRUMENTS':
      return input.event.scope.instrumentIds.includes(input.instrumentId);
    case 'SECTORS':
      return input.event.scope.sectors.includes(input.sector);
  }
};

export const evaluateEventRisk = (input: {
  readonly asOf: number;
  readonly instrumentId: string;
  readonly sector: string;
  readonly events: readonly ScheduledRiskEvent[];
  readonly policy?: EventRiskFilterPolicy;
}): EventRiskDecision => {
  const policy = input.policy ?? DEFAULT_EVENT_RISK_FILTER_POLICY;
  if (!Number.isSafeInteger(input.asOf) || input.asOf < 0) {
    throw new Error('asOf must be a non-negative safe integer');
  }
  if (input.instrumentId.trim().length === 0 || input.sector.trim().length === 0) {
    throw new Error('instrumentId and sector must not be empty');
  }
  for (const [category, window] of Object.entries(policy.defaultWindows)) {
    validateWindow(window, category);
  }
  for (const [eventId, window] of Object.entries(policy.eventOverrides)) {
    validateWindow(window, eventId);
  }

  if (!policy.enabled) {
    return {
      observedAt: input.asOf,
      instrumentId: input.instrumentId,
      blocked: false,
      activeBlackouts: [],
      ignoredEvents: input.events.map((event) => ({
        eventId: event.eventId,
        reason: 'EVENT_FILTER_DISABLED',
      })),
      explanations: ['Event-risk filtering is disabled by configuration'],
      liveExecutionAllowed: false,
    };
  }

  const activeBlackouts: EventRiskDecision['activeBlackouts'][number][] = [];
  const ignoredEvents: EventRiskDecision['ignoredEvents'][number][] = [];
  for (const event of input.events) {
    if (
      event.eventId.trim().length === 0 ||
      !Number.isSafeInteger(event.scheduledAt) ||
      !Number.isSafeInteger(event.publishedAt) ||
      event.scheduledAt < 0 ||
      event.publishedAt < 0
    ) {
      throw new Error('invalid scheduled event');
    }
    if (event.cancelled) {
      ignoredEvents.push({ eventId: event.eventId, reason: 'EVENT_CANCELLED' });
      continue;
    }
    if (event.publishedAt > input.asOf) {
      ignoredEvents.push({
        eventId: event.eventId,
        reason: 'EVENT_NOT_KNOWN_AT_DECISION_TIME',
      });
      continue;
    }
    if (!policy.enabledCategories.includes(event.category)) {
      ignoredEvents.push({ eventId: event.eventId, reason: 'CATEGORY_DISABLED' });
      continue;
    }
    if (!policy.acceptedSourceReliability.includes(event.sourceReliability)) {
      ignoredEvents.push({ eventId: event.eventId, reason: 'SOURCE_NOT_TRUSTED' });
      continue;
    }
    if (
      !appliesToInstrument({
        event,
        instrumentId: input.instrumentId,
        sector: input.sector,
      })
    ) {
      ignoredEvents.push({ eventId: event.eventId, reason: 'SCOPE_NOT_APPLICABLE' });
      continue;
    }
    const window = policy.eventOverrides[event.eventId] ??
      policy.defaultWindows[event.category];
    const blackoutStart = event.scheduledAt - window.beforeMs;
    const blackoutEnd = event.scheduledAt + window.afterMs;
    if (input.asOf >= blackoutStart && input.asOf <= blackoutEnd) {
      activeBlackouts.push({
        eventId: event.eventId,
        title: event.title,
        category: event.category,
        scheduledAt: event.scheduledAt,
        blackoutStart,
        blackoutEnd,
        sourceId: event.sourceId,
      });
    } else {
      ignoredEvents.push({ eventId: event.eventId, reason: 'OUTSIDE_BLACKOUT_WINDOW' });
    }
  }

  return {
    observedAt: input.asOf,
    instrumentId: input.instrumentId,
    blocked: activeBlackouts.length > 0,
    activeBlackouts: activeBlackouts.sort(
      (left, right) => left.scheduledAt - right.scheduledAt,
    ),
    ignoredEvents,
    explanations:
      activeBlackouts.length === 0
        ? ['No trusted, applicable event blackout is active']
        : activeBlackouts.map(
            (event) =>
              `Trading blocked for ${event.title} (${event.category}) from ${event.blackoutStart} through ${event.blackoutEnd}`,
          ),
    liveExecutionAllowed: false,
  };
};
