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
  confidenceInterval: {
    lower: 0.05,
    upper: 0.35,
    level: 0.95,
  },
  probabilityOfImprovement: 0.99,
  rejectionReasons: [],
  liveExecutionAllowed: false,
});

const candidate = (input: {
  readonly featureName: string;
  readonly importance: readonly number[];
  readonly ablation?: FeatureAblationDecision | null;
}): FeatureSelectionCandidate => ({
  featureName: input.featureName,
  role: 'ALPHA',
  documentedPurpose: `Research purpose for ${input.featureName}`,
  requiredForSafety: false,
  importanceByFold: input.importance.map((importance, fold) => ({
    fold,
    importance,
  })),
  ablation:
    input.ablation === undefined ? justifiedAblation() : input.ablation,
});

describe('selectFeatures', () => {
  it('retains supported features, removes redundant features, and preserves safety filters', () => {
    const report = selectFeatures({
      candidates: [
        candidate({
          featureName: 'cvd',
          importance: [0.4, 0.35, 0.3],
        }),
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
    expect(report.selectedFeatures).toEqual(['cvd', 'spread_bps']);
    expect(
      report.decisions.find(
        (decision) => decision.featureName === 'aggressive_delta',
      )?.rejectionReasons,
    ).toEqual(['REDUNDANT_WITH:cvd']);
    expect(report.liveExecutionAllowed).toBe(false);
  });

  it('rejects a directional feature without paired ablation evidence', () => {
    const report = selectFeatures({
      candidates: [
        candidate({
          featureName: 'funding_acceleration',
          importance: [0.2, 0.15, 0.18],
          ablation: null,
        }),
      ],
      correlations: [],
    });

    expect(report.status).toBe('REJECTED');
    expect(report.selectedFeatures).toEqual([]);
    expect(report.rejectionReasons).toContain('NO_RESEARCH_FEATURE_RETAINED');
    expect(report.decisions[0]?.rejectionReasons).toContain(
      'PAIRED_ABLATION_REQUIRED',
    );
  });

  it('rejects unstable importance even when an ablation result is positive', () => {
    const report = selectFeatures({
      candidates: [
        candidate({
          featureName: 'basis_expansion',
          importance: [1, -0.9, 0.01],
        }),
      ],
      correlations: [],
    });

    expect(report.status).toBe('REJECTED');
    expect(report.decisions[0]?.rejectionReasons).toContain(
      'IMPORTANCE_NOT_POSITIVE_ACROSS_FOLDS',
    );
    expect(report.decisions[0]?.rejectionReasons).toContain(
      'IMPORTANCE_UNSTABLE',
    );
  });
});
