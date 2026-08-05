import type { RecordingIntegrityReport } from '../recording/recordingIntegrity';
import type { RuntimeHealthSnapshot } from '../observability/runtimeHealth';

export type ResearchDashboardStatus = 'READY' | 'WARNING' | 'BLOCKED';

export interface ResearchDashboardCounts {
  recordings: number;
  validRecordings: number;
  researchSessions: number;
  completedResearchSessions: number;
  strategyCandidates: number;
  evaluatedStrategyCandidates: number;
}

export interface ResearchDashboardInput {
  generatedAt: number;
  runtimeHealth: RuntimeHealthSnapshot;
  recordings: readonly RecordingIntegrityReport[];
  researchSessions: readonly {
    sessionId: string;
    completed: boolean;
  }[];
  strategyCandidates: readonly {
    candidateId: string;
    evaluated: boolean;
  }[];
}

export interface ResearchDashboardSnapshot {
  generatedAt: number;
  status: ResearchDashboardStatus;
  runtimeStatus: RuntimeHealthSnapshot['status'];
  counts: Readonly<ResearchDashboardCounts>;
  invalidRecordingPaths: readonly string[];
  incompleteResearchSessionIds: readonly string[];
  unevaluatedStrategyCandidateIds: readonly string[];
  reasons: readonly string[];
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const assertTimestamp = (name: string, value: number): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

const assertUniqueIdentifiers = (
  name: string,
  values: readonly string[],
): void => {
  const seen = new Set<string>();
  for (const value of values) {
    if (!IDENTIFIER_PATTERN.test(value)) {
      throw new Error(`${name} contains an invalid identifier: ${value}`);
    }
    if (seen.has(value)) {
      throw new Error(`${name} contains a duplicate identifier: ${value}`);
    }
    seen.add(value);
  }
};

export const createResearchDashboardSnapshot = (
  input: ResearchDashboardInput,
): ResearchDashboardSnapshot => {
  assertTimestamp('generatedAt', input.generatedAt);
  if (input.runtimeHealth.generatedAt > input.generatedAt) {
    throw new Error('Runtime health snapshot cannot be newer than the dashboard snapshot');
  }

  assertUniqueIdentifiers(
    'researchSessions',
    input.researchSessions.map((session) => session.sessionId),
  );
  assertUniqueIdentifiers(
    'strategyCandidates',
    input.strategyCandidates.map((candidate) => candidate.candidateId),
  );

  const invalidRecordingPaths = input.recordings
    .filter((recording) => !recording.valid)
    .map((recording) => recording.filePath)
    .sort((left, right) => left.localeCompare(right));
  const incompleteResearchSessionIds = input.researchSessions
    .filter((session) => !session.completed)
    .map((session) => session.sessionId)
    .sort((left, right) => left.localeCompare(right));
  const unevaluatedStrategyCandidateIds = input.strategyCandidates
    .filter((candidate) => !candidate.evaluated)
    .map((candidate) => candidate.candidateId)
    .sort((left, right) => left.localeCompare(right));

  const counts: ResearchDashboardCounts = {
    recordings: input.recordings.length,
    validRecordings: input.recordings.length - invalidRecordingPaths.length,
    researchSessions: input.researchSessions.length,
    completedResearchSessions:
      input.researchSessions.length - incompleteResearchSessionIds.length,
    strategyCandidates: input.strategyCandidates.length,
    evaluatedStrategyCandidates:
      input.strategyCandidates.length - unevaluatedStrategyCandidateIds.length,
  };

  const reasons: string[] = [];
  if (input.runtimeHealth.status === 'UNHEALTHY') {
    reasons.push('Runtime health is unhealthy');
  } else if (input.runtimeHealth.status === 'DEGRADED') {
    reasons.push('Runtime health is degraded');
  }
  if (invalidRecordingPaths.length > 0) {
    reasons.push(`${invalidRecordingPaths.length} recording(s) failed integrity checks`);
  }
  if (incompleteResearchSessionIds.length > 0) {
    reasons.push(`${incompleteResearchSessionIds.length} research session(s) are incomplete`);
  }
  if (unevaluatedStrategyCandidateIds.length > 0) {
    reasons.push(`${unevaluatedStrategyCandidateIds.length} strategy candidate(s) are unevaluated`);
  }

  const status: ResearchDashboardStatus =
    input.runtimeHealth.status === 'UNHEALTHY' || invalidRecordingPaths.length > 0
      ? 'BLOCKED'
      : reasons.length > 0
        ? 'WARNING'
        : 'READY';

  return Object.freeze({
    generatedAt: input.generatedAt,
    status,
    runtimeStatus: input.runtimeHealth.status,
    counts: Object.freeze(counts),
    invalidRecordingPaths: Object.freeze(invalidRecordingPaths),
    incompleteResearchSessionIds: Object.freeze(incompleteResearchSessionIds),
    unevaluatedStrategyCandidateIds: Object.freeze(unevaluatedStrategyCandidateIds),
    reasons: Object.freeze(reasons),
  });
};
