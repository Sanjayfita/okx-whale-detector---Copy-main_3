import { describe, expect, it } from 'vitest';

import { createResearchDashboardSnapshot } from '../src/dashboard/researchDashboard';
import { createRuntimeHealthSnapshot } from '../src/observability/runtimeHealth';
import { inspectRecordingIntegrityFromText } from '../src/recording/recordingIntegrity';

const runtime = (status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY') =>
  createRuntimeHealthSnapshot({
    generatedAt: 200,
    startedAt: 100,
    components: [{ name: 'market-engine', status, observedAt: 200 }],
  });

const validRecording = inspectRecordingIntegrityFromText({
  filePath: 'recordings/valid.jsonl',
  text: '{"timestamp":1}\n{"timestamp":2}\n',
});

const invalidRecording = inspectRecordingIntegrityFromText({
  filePath: 'recordings/invalid.jsonl',
  text: '{"timestamp":2}\n{"timestamp":1}\n',
});

describe('createResearchDashboardSnapshot', () => {
  it('creates a ready snapshot when all research inputs are healthy and complete', () => {
    const snapshot = createResearchDashboardSnapshot({
      generatedAt: 300,
      runtimeHealth: runtime('HEALTHY'),
      recordings: [validRecording],
      researchSessions: [{ sessionId: 'session-1', completed: true }],
      strategyCandidates: [{ candidateId: 'candidate-1', evaluated: true }],
    });

    expect(snapshot.status).toBe('READY');
    expect(snapshot.reasons).toEqual([]);
    expect(snapshot.counts).toEqual({
      recordings: 1,
      validRecordings: 1,
      researchSessions: 1,
      completedResearchSessions: 1,
      strategyCandidates: 1,
      evaluatedStrategyCandidates: 1,
    });
  });

  it('blocks research when runtime health or recording integrity is unsafe', () => {
    const snapshot = createResearchDashboardSnapshot({
      generatedAt: 300,
      runtimeHealth: runtime('UNHEALTHY'),
      recordings: [invalidRecording],
      researchSessions: [{ sessionId: 'session-2', completed: false }],
      strategyCandidates: [{ candidateId: 'candidate-2', evaluated: false }],
    });

    expect(snapshot.status).toBe('BLOCKED');
    expect(snapshot.invalidRecordingPaths).toEqual(['recordings/invalid.jsonl']);
    expect(snapshot.incompleteResearchSessionIds).toEqual(['session-2']);
    expect(snapshot.unevaluatedStrategyCandidateIds).toEqual(['candidate-2']);
    expect(snapshot.reasons).toEqual([
      'Runtime health is unhealthy',
      '1 recording(s) failed integrity checks',
      '1 research session(s) are incomplete',
      '1 strategy candidate(s) are unevaluated',
    ]);
  });

  it('sorts identifiers and rejects duplicates deterministically', () => {
    const snapshot = createResearchDashboardSnapshot({
      generatedAt: 300,
      runtimeHealth: runtime('DEGRADED'),
      recordings: [validRecording],
      researchSessions: [
        { sessionId: 'session-z', completed: false },
        { sessionId: 'session-a', completed: false },
      ],
      strategyCandidates: [],
    });

    expect(snapshot.status).toBe('WARNING');
    expect(snapshot.incompleteResearchSessionIds).toEqual(['session-a', 'session-z']);

    expect(() =>
      createResearchDashboardSnapshot({
        generatedAt: 300,
        runtimeHealth: runtime('HEALTHY'),
        recordings: [],
        researchSessions: [
          { sessionId: 'duplicate', completed: true },
          { sessionId: 'duplicate', completed: false },
        ],
        strategyCandidates: [],
      }),
    ).toThrow('duplicate identifier');
  });
});
