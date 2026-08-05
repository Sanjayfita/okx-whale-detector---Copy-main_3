import type { LiveTradingReadinessStatus } from './liveTradingReadiness';
import type { LiveTradingReadinessDocument } from './liveTradingReadinessPersistence';

export type LiveTradingReadinessTrendDirection =
  | 'IMPROVING'
  | 'STABLE'
  | 'DETERIORATING';

export interface LiveTradingReadinessTrendPoint {
  generatedAt: number;
  status: LiveTradingReadinessStatus;
  completedChecks: number;
  missingChecks: number;
}

export interface LiveTradingReadinessTrendSummary {
  direction: LiveTradingReadinessTrendDirection;
  points: readonly LiveTradingReadinessTrendPoint[];
  completedChecksChange: number;
  readinessEscalations: number;
  readinessRegressions: number;
  bestCompletedChecks: number;
  worstCompletedChecks: number;
  reasons: readonly string[];
  orderExecutionAuthorized: false;
}

const STATUS_RANK: Readonly<Record<LiveTradingReadinessStatus, number>> = Object.freeze({
  NOT_READY: 0,
  REVIEW_REQUIRED: 1,
  READY_FOR_MANUAL_REVIEW: 2,
});

export const summarizeLiveTradingReadinessTrend = (
  documents: readonly LiveTradingReadinessDocument[],
): LiveTradingReadinessTrendSummary => {
  if (documents.length < 2) {
    throw new Error('At least two readiness documents are required');
  }

  const sorted = [...documents].sort((left, right) => left.generatedAt - right.generatedAt);
  const timestamps = new Set<number>();

  for (const document of sorted) {
    if (timestamps.has(document.generatedAt)) {
      throw new Error(`Duplicate readiness timestamp: ${document.generatedAt}`);
    }
    timestamps.add(document.generatedAt);
  }

  const points = sorted.map((document): LiveTradingReadinessTrendPoint =>
    Object.freeze({
      generatedAt: document.generatedAt,
      status: document.assessment.status,
      completedChecks: document.assessment.completedChecks,
      missingChecks: document.assessment.missingChecks.length,
    }),
  );

  let readinessEscalations = 0;
  let readinessRegressions = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const rankDelta = STATUS_RANK[current.status] - STATUS_RANK[previous.status];
    const checksDelta = current.completedChecks - previous.completedChecks;

    if (rankDelta > 0 || (rankDelta === 0 && checksDelta > 0)) {
      readinessEscalations += 1;
    } else if (rankDelta < 0 || (rankDelta === 0 && checksDelta < 0)) {
      readinessRegressions += 1;
    }
  }

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const completedChecksChange = last.completedChecks - first.completedChecks;
  const reasons: string[] = [];
  let direction: LiveTradingReadinessTrendDirection;

  if (
    readinessEscalations > readinessRegressions ||
    (readinessEscalations === readinessRegressions && completedChecksChange > 0)
  ) {
    direction = 'IMPROVING';
    reasons.push('Safety readiness improved across the recorded assessments');
  } else if (
    readinessRegressions > readinessEscalations ||
    (readinessEscalations === readinessRegressions && completedChecksChange < 0)
  ) {
    direction = 'DETERIORATING';
    reasons.push('Safety readiness regressed across the recorded assessments');
  } else {
    direction = 'STABLE';
    reasons.push('Safety readiness remained stable across the recorded assessments');
  }

  reasons.push('Trend analysis never authorizes real-order execution');

  return Object.freeze({
    direction,
    points: Object.freeze(points),
    completedChecksChange,
    readinessEscalations,
    readinessRegressions,
    bestCompletedChecks: Math.max(...points.map((point) => point.completedChecks)),
    worstCompletedChecks: Math.min(...points.map((point) => point.completedChecks)),
    reasons: Object.freeze(reasons),
    orderExecutionAuthorized: false,
  });
};
