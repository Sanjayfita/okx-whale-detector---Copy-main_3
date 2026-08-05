import { describe, expect, it } from 'vitest';

import type { ResearchDashboardSnapshot } from '../src/dashboard/researchDashboard';
import {
  createResearchDashboardDocument,
  readResearchDashboardDocumentFromText,
  serializeResearchDashboardDocument,
} from '../src/dashboard/researchDashboardPersistence';

const snapshot = (): ResearchDashboardSnapshot => ({
  generatedAt: 1_700_000_000_000,
  status: 'WARNING',
  runtimeStatus: 'DEGRADED',
  counts: {
    recordings: 2,
    validRecordings: 2,
    researchSessions: 2,
    completedResearchSessions: 1,
    strategyCandidates: 2,
    evaluatedStrategyCandidates: 1,
  },
  invalidRecordingPaths: [],
  incompleteResearchSessionIds: ['session-b'],
  unevaluatedStrategyCandidateIds: ['candidate-b'],
  reasons: [
    'Runtime health is degraded',
    '1 research session(s) are incomplete',
    '1 strategy candidate(s) are unevaluated',
  ],
});

describe('research dashboard persistence', () => {
  it('serializes and reloads a deterministic versioned document', () => {
    const document = createResearchDashboardDocument(snapshot());
    const first = serializeResearchDashboardDocument(document);
    const second = serializeResearchDashboardDocument(document);

    expect(first).toBe(second);
    expect(readResearchDashboardDocumentFromText(first)).toEqual(document);
    expect(first.endsWith('\n')).toBe(true);
  });

  it('rejects malformed JSON and unsupported versions', () => {
    expect(() => readResearchDashboardDocumentFromText('{')).toThrow(
      'Malformed research dashboard document JSON',
    );

    const document = createResearchDashboardDocument(snapshot());
    expect(() =>
      readResearchDashboardDocumentFromText(
        JSON.stringify({ ...document, schemaVersion: 2 }),
      ),
    ).toThrow('Unsupported research dashboard document schema version');
  });

  it('rejects inconsistent derived counts and status', () => {
    const document = createResearchDashboardDocument(snapshot());

    expect(() =>
      readResearchDashboardDocumentFromText(
        JSON.stringify({
          ...document,
          snapshot: {
            ...document.snapshot,
            counts: { ...document.snapshot.counts, validRecordings: 1 },
          },
        }),
      ),
    ).toThrow('Recording counts are inconsistent');

    expect(() =>
      readResearchDashboardDocumentFromText(
        JSON.stringify({
          ...document,
          snapshot: { ...document.snapshot, status: 'READY' },
        }),
      ),
    ).toThrow('snapshot.status is inconsistent');
  });
});
