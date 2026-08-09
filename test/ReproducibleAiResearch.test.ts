import { describe, expect, it } from 'vitest';

import type { FeatureAblationDecision } from '../src/research/FeatureAblation';
import {
  evaluateAiAssistedResearch,
  type AiResearchRun,
} from '../src/research/ReproducibleAiResearch';

const supportedAblation: FeatureAblationDecision = {
  status: 'FEATURE_JUSTIFIED_FOR_FROZEN_CANDIDATE',
  independentEpisodeCount: 100,
  observedMeanImprovement: 0.1,
  confidenceInterval: { lower: 0.02, upper: 0.18, level: 0.95 },
  probabilityOfImprovement: 0.98,
  rejectionReasons: [],
  liveExecutionAllowed: false,
};

const run = (): AiResearchRun => ({
  runId: 'ai-feature-ranking-1',
  modelId: 'deterministic-ranking-model',
  modelVersion: '1',
  role: 'FEATURE_RANKING',
  datasetFingerprint: 'dataset-fingerprint',
  codeCommit: 'commit',
  configurationHash: 'configuration',
  seed: 42,
  deterministic: true,
  directSignalOutput: false,
  folds: [
    { fold: 0, featureScores: { cvd: 0.8, funding: 0.2 } },
    { fold: 1, featureScores: { funding: 0.1, cvd: 0.7 } },
    { fold: 2, featureScores: { cvd: 0.9, funding: -0.1 } },
  ],
  ablations: { cvd: supportedAblation },
});

describe('evaluateAiAssistedResearch', () => {
  it('produces deterministic rankings and requires ablation for promotion', () => {
    const first = evaluateAiAssistedResearch({ run: run() });
    const second = evaluateAiAssistedResearch({ run: run() });

    expect(first).toEqual(second);
    expect(first.status).toBe('ACCEPTED_FOR_RESEARCH');
    expect(first.decisions[0]?.featureName).toBe('cvd');
    expect(first.decisions[0]?.status).toBe('ABLATION_SUPPORTED');
    expect(
      first.decisions.find((decision) => decision.featureName === 'funding')
        ?.status,
    ).toBe('REJECTED');
    expect(first.directTradingSignalAllowed).toBe(false);
    expect(first.liveExecutionAllowed).toBe(false);
  });

  it('rejects AI systems configured to emit direct trading signals', () => {
    const report = evaluateAiAssistedResearch({
      run: { ...run(), directSignalOutput: true },
    });

    expect(report.status).toBe('REJECTED');
    expect(report.rejectionReasons).toContain(
      'DIRECT_AI_TRADING_SIGNAL_FORBIDDEN',
    );
    expect(report.decisions).toEqual([]);
  });

  it('keeps a stable feature as a research prior when ablation is missing', () => {
    const candidate = run();
    const report = evaluateAiAssistedResearch({
      run: { ...candidate, ablations: {} },
    });

    expect(report.decisions[0]?.featureName).toBe('cvd');
    expect(report.decisions[0]?.status).toBe('AI_PRIOR_ONLY');
    expect(report.decisions[0]?.reasons).toContain(
      'PAIRED_ABLATION_REQUIRED_FOR_PROMOTION',
    );
  });
});
