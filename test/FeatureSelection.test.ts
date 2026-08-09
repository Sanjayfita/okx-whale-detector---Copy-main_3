import { describe, expect, it } from 'vitest';

import type { FeatureAblationDecision } from '../src/research/FeatureAblation';
import {
  selectFeatures,
  type FeatureSelectionCandidate,
} from '../src/research/FeatureSelection';

const justifiedAblation = (): FeatureAblationDecision => ({
  status: 'FEATURE_JUSTIFIED_FOR_FROZEN_CANDIDATE',
  independentEpisodeCount: 100,
  observedMeanImprovement: 0.2,
  standardizedEffect: 0.5,
  confidenceInterval: { lower: 0.05, upper: 0.35, level: 0.95 },
  probabilityOfImprovement: 0.99,
  rawPValue: 0.005,
  adjustedPValue: 0.01,
  hypothesisFamilySize: 3,
  multiplicityMethod: 'HOLM_BONFERRONI',
  rejectionReasons: [],
  liveExecutionAllowed: false,
});

const candidate = (input: {
  readonly featureName: string;
  readonly importance: readonly number[];
  readonly ablation?: FeatureAblationDecision | null;
  readonly permutationScope?: 'GLOBAL' | 'WITHIN_BLOCK';
}): FeatureSelectionCandidate => ({
  featureName: input.featureName,
  role: 'ALPHA',
  documentedPurpose: `Research purpose for ${input.featureName}`,
  requiredForSafety: false,
  importanceByFold: input.importance.map((importance, fold) => ({
    fold,
    importance,
    permutationScope: input.permutationScope ?? 'WITHIN_BLOCK',
  })),
  ablation:
    input.ablation === undefined ? justifiedAblation() : input.ablation,
});

describe('selectFeatures', () => {
  it('retains supported features, removes redundancy, and preserves safety filters', () => {
    const report = selectFeatures({
      candidates: [
        candidate({ featureName: 'cvd', importance: [0.4, 0.35, 0.3] }),
        candidate({
          featureName: 'aggressive_delta',
          importance: [0.28, 0.25, 0.22],
        }),
        {
          featureName: 'spread_bps',
          role: 'EXECUTION_FILTER',
          documentedPurpose: 'Reject entries whose spread makes fills unrealistic',
          requiredForSafety: true,
          importanceByFold: [],
          ablation: null,
        },
      ],
      correlations: [
        {
          leftFeature: 'cvd',
          rightFeature: 'aggressive_delta',
          absoluteCorrelation: 0.95,
        },
      ],
    });

    expect(report.status).toBe('SELECTION_PASSED');
    expect(report.retainedResearchFeatures).toEqual(['cvd']);
    expect(report.retainedSafetyFeatures).toEqual(['spread_bps']);
    expect(report.correlationEvidenceComplete).toBe(true);
    expect(
      report.decisions.find(
        (decision) => decision.featureName === 'aggressive_delta',
      )?.rejectionReasons,
    ).toEqual(['REDUNDANT_WITH:cvd']);
  });

  it('rejects global permutation importance and missing paired ablation', () => {
    const report = selectFeatures({
      candidates: [
        candidate({
          featureName: 'funding_acceleration',
          importance: [0.2, 0.15, 0.18],
          ablation: null,
          permutationScope: 'GLOBAL',
        }),
      ],
      correlations: [],
    });

    expect(report.status).toBe('REJECTED');
    expect(report.decisions[0]?.rejectionReasons).toContain(
      'BLOCK_AWARE_IMPORTANCE_REQUIRED',
    );
    expect(report.decisions[0]?.rejectionReasons).toContain(
      'PAIRED_ABLATION_REQUIRED',
    );
  });

  it('fails closed when pairwise correlation evidence is incomplete', () => {
    const report = selectFeatures({
      candidates: [
        candidate({ featureName: 'basis', importance: [0.3, 0.25, 0.2] }),
        candidate({ featureName: 'funding', importance: [0.2, 0.18, 0.16] }),
      ],
      correlations: [],
    });

    expect(report.status).toBe('REJECTED');
    expect(report.correlationEvidenceComplete).toBe(false);
    expect(report.rejectionReasons).toContain(
      'MISSING_CORRELATION_EVIDENCE:basis:funding',
    );
    expect(report.decisions.every((decision) =>
      decision.rejectionReasons.includes('INCOMPLETE_CORRELATION_EVIDENCE'),
    )).toBe(true);
  });

  it('rejects familywise-insignificant ablation evidence', () => {
    const ablation = {
      ...justifiedAblation(),
      adjustedPValue: 0.2,
    };
    const report = selectFeatures({
      candidates: [
        candidate({
          featureName: 'basis_expansion',
          importance: [0.2, 0.15, 0.18],
          ablation,
        }),
      ],
      correlations: [],
    });

    expect(report.status).toBe('REJECTED');
    expect(report.decisions[0]?.rejectionReasons).toContain(
      'FAMILYWISE_ABLATION_NOT_SIGNIFICANT',
    );
  });
});
