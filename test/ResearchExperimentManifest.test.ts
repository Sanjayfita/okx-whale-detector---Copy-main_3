import { describe, expect, it } from 'vitest';

import { createResearchExperimentManifest } from '../src/research/ResearchExperimentManifest';

const quality = (sourceName: string) => ({
  sourceName,
  inputCount: 100,
  selectedCount: 90,
  excludedFutureObservationCount: 0,
  excludedUnavailableAtDecisionCount: 5,
  excludedOutsideLookbackCount: 5,
  latestObservedAt: 900,
  latestReceivedAt: 901,
  ageMs: 99,
  status: 'PASSED' as const,
  rejectionReasons: [],
});

const baseInput = () => ({
  experimentId: 'experiment-1',
  scope: 'PURGED_DISCOVERY' as const,
  hypothesisFamilyId: 'family-1',
  strategyIds: ['trend', 'mean-reversion'],
  featureNames: ['cvd', 'basis'],
  discoveryDatasetFingerprint: 'discovery-fingerprint',
  holdoutDatasetFingerprint: 'holdout-fingerprint',
  codeCommit: 'commit-sha',
  configurationHash: 'configuration-hash',
  candidateFamilyFingerprint: 'candidate-family-fingerprint',
  candidateCount: 8,
  hypothesisCount: 8,
  splitAudit: {
    foldCount: 4,
    discoveryObservationCount: 1_000,
    holdoutObservationCount: 200,
    overlappingEpisodeCount: 0,
    holdoutPurgedObservationCount: 12,
    holdoutEmbargoedObservationCount: 8,
  },
  dataQuality: [quality('books'), quality('trades')],
  frozenAt: 1_000,
  startedAt: 1_100,
  completedAt: 2_000,
  holdoutAccessCount: 0,
  significanceMethod: 'PAIRED_BOOTSTRAP_AND_RANDOMIZATION' as const,
  multiplicityMethod: 'HOLM_BONFERRONI' as const,
});

describe('createResearchExperimentManifest', () => {
  it('creates deterministic accepted discovery evidence without promotion', () => {
    const first = createResearchExperimentManifest(baseInput());
    const second = createResearchExperimentManifest({
      ...baseInput(),
      strategyIds: ['mean-reversion', 'trend'],
      featureNames: ['basis', 'cvd'],
      dataQuality: [quality('trades'), quality('books')],
    });

    expect(first).toEqual(second);
    expect(first.status).toBe('ACCEPTED_FOR_RESEARCH');
    expect(first.strategyPromotionAllowed).toBe(false);
    expect(first.liveExecutionAllowed).toBe(false);
  });

  it('rejects discovery that touches holdout or contains episode overlap', () => {
    const manifest = createResearchExperimentManifest({
      ...baseInput(),
      holdoutAccessCount: 1,
      splitAudit: {
        ...baseInput().splitAudit,
        overlappingEpisodeCount: 2,
      },
    });

    expect(manifest.status).toBe('REJECTED');
    expect(manifest.rejectionReasons).toContain(
      'HOLDOUT_ACCESSED_DURING_DISCOVERY',
    );
    expect(manifest.rejectionReasons).toContain('EPISODE_OVERLAP_DETECTED');
  });

  it('requires an exactly-once holdout access after freeze', () => {
    const accepted = createResearchExperimentManifest({
      ...baseInput(),
      scope: 'FROZEN_HOLDOUT',
      holdoutAccessCount: 1,
    });
    const repeated = createResearchExperimentManifest({
      ...baseInput(),
      scope: 'FROZEN_HOLDOUT',
      holdoutAccessCount: 2,
    });

    expect(accepted.status).toBe('ACCEPTED_FOR_RESEARCH');
    expect(repeated.status).toBe('REJECTED');
    expect(repeated.rejectionReasons).toContain(
      'HOLDOUT_MUST_BE_ACCESSED_EXACTLY_ONCE',
    );
  });

  it('rejects failed point-in-time quality evidence', () => {
    const manifest = createResearchExperimentManifest({
      ...baseInput(),
      dataQuality: [
        {
          ...quality('books'),
          status: 'REJECTED',
          rejectionReasons: ['LATEST_RECORD_TOO_STALE'],
        },
      ],
    });

    expect(manifest.status).toBe('REJECTED');
    expect(manifest.rejectionReasons).toContain(
      'DATA_QUALITY_REJECTED:books',
    );
  });
});
