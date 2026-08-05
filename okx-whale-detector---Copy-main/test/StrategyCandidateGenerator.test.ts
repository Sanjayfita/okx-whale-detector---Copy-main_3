import { describe, expect, it } from 'vitest';

import { generateStrategyCandidates } from '../src/research/StrategyCandidateGenerator';

const baseInput = () => ({
  strategyId: 'trend-following',
  strategyVersion: 1,
  hypothesisFamilyId: 'trend-grid-v1',
  datasetFingerprint: 'discovery-fingerprint',
  codeCommit: 'commit-sha',
  configurationHash: 'configuration-hash',
  discoveryScope: 'PURGED_DISCOVERY' as const,
  holdoutAccessed: false as const,
});

describe('generateStrategyCandidates', () => {
  it('enumerates and fingerprints a deterministic constrained family', () => {
    const input = {
      ...baseInput(),
      parameterSpace: {
        minimumTrendEfficiency: [0.3, 0.4],
        initialStopAtrMultiple: [1, 2],
        trailingStopAtrMultiple: [1.5, 2.5],
      },
      constraints: [
        {
          leftParameter: 'initialStopAtrMultiple',
          operator: 'LESS_THAN' as const,
          rightParameter: 'trailingStopAtrMultiple',
        },
      ],
    };
    const first = generateStrategyCandidates(input);
    const second = generateStrategyCandidates(input);

    expect(first).toEqual(second);
    expect(first.status).toBe('GENERATED');
    expect(first.searchSpaceSize).toBe(8);
    expect(first.effectiveHypothesisCount).toBe(6);
    expect(first.constraintRejectedCount).toBe(2);
    expect(new Set(first.candidates.map((candidate) => candidate.candidateId)).size)
      .toBe(first.candidates.length);
    expect(first.candidates.every((candidate) => !candidate.holdoutAccessed))
      .toBe(true);
    expect(first.liveExecutionAllowed).toBe(false);
  });

  it('rejects oversized search families instead of silently truncating them', () => {
    const report = generateStrategyCandidates({
      ...baseInput(),
      parameterSpace: {
        a: [1, 2, 3],
        b: [1, 2, 3],
      },
      policy: {
        maximumSearchSpaceSize: 5,
      },
    });

    expect(report.status).toBe('REJECTED');
    expect(report.rejectionReasons).toContain('SEARCH_SPACE_LIMIT_EXCEEDED');
    expect(report.candidates).toEqual([]);
  });

  it('rejects candidate generation outside purged discovery scope', () => {
    expect(() =>
      generateStrategyCandidates({
        ...baseInput(),
        discoveryScope: 'NOT_DISCOVERY' as 'PURGED_DISCOVERY',
        parameterSpace: { threshold: [1] },
      }),
    ).toThrow('purged discovery');
  });

  it('rejects invalid cross-parameter constraints', () => {
    expect(() =>
      generateStrategyCandidates({
        ...baseInput(),
        parameterSpace: { threshold: [1] },
        constraints: [
          {
            leftParameter: 'threshold',
            operator: 'LESS_THAN',
            rightParameter: 'missing',
          },
        ],
      }),
    ).toThrow('right-hand value is unavailable');
  });
});
