import { describe, expect, it } from 'vitest';

import { discoverAdaptiveFeatures } from '../src/autonomy/AdaptiveFeatureDiscovery';
import { generateAutonomousHypotheses } from '../src/autonomy/ResearchHypothesis';
import {
  canonicalResearchJson,
  fingerprintResearchValue,
} from '../src/research/ResearchFingerprint';

describe('research fingerprints', () => {
  it('is invariant to object key order and rejects non-finite values', () => {
    expect(fingerprintResearchValue({ b: 2, a: [true, 'x'] })).toBe(
      fingerprintResearchValue({ a: [true, 'x'], b: 2 }),
    );
    expect(canonicalResearchJson({ optional: undefined, value: -0 })).toBe(
      '{"value":0}',
    );
    expect(() => fingerprintResearchValue({ value: Number.NaN })).toThrow(
      'finite numbers',
    );
  });
});

describe('generateAutonomousHypotheses', () => {
  it('expands deterministic templates and blocks unavailable evidence', () => {
    const report = generateAutonomousHypotheses({
      datasetFingerprint: 'dataset',
      codeCommit: 'commit',
      configurationHash: 'config',
      availableDataCapabilities: ['CANDLES', 'TRADES'],
      templates: [
        {
          templateId: 'trend-regime',
          kind: 'REGIME_CONDITION',
          strategyId: 'trend-following',
          strategyVersion: 1,
          researchQuestion: 'Does trend efficiency improve conditional expectancy?',
          rationale: 'Trend candidates should be tested only where their premise holds.',
          falsificationCriterion: 'Reject when corrected lower confidence bound is non-positive.',
          featureSets: [
            ['trendEfficiency', 'realizedVolatility'],
            ['trendEfficiency', 'orderBookImbalance'],
          ],
          parameterSpace: {
            minimumTrendEfficiency: [0.4, 0.3, 0.4],
          },
          requiredDataCapabilities: ['CANDLES', 'TRADES'],
          complexityUnits: 4,
        },
        {
          templateId: 'liquidation-flow',
          kind: 'FEATURE_INTERACTION',
          strategyId: 'derivatives-flow',
          strategyVersion: 1,
          researchQuestion: 'Do liquidation clusters improve flow signals?',
          rationale: 'Forced flow may alter continuation probabilities.',
          falsificationCriterion: 'Reject without familywise-significant ablation.',
          featureSets: [['liquidationCluster', 'aggressiveDelta']],
          parameterSpace: { threshold: [1, 2] },
          requiredDataCapabilities: ['LIQUIDATIONS'],
          complexityUnits: 5,
        },
      ],
    });

    expect(report.status).toBe('GENERATED');
    expect(report.generatedCount).toBe(3);
    expect(report.readyCount).toBe(2);
    expect(report.blockedCount).toBe(1);
    expect(
      report.hypotheses.find((hypothesis) => hypothesis.templateId === 'liquidation-flow')
        ?.blockingReasons,
    ).toContain('MISSING_DATA_CAPABILITY:LIQUIDATIONS');
    expect(report.holdoutAccessed).toBe(false);
    expect(report.strategyPromotionAllowed).toBe(false);
  });

  it('rejects oversized families instead of truncating them', () => {
    const report = generateAutonomousHypotheses({
      datasetFingerprint: 'dataset',
      codeCommit: 'commit',
      configurationHash: 'config',
      availableDataCapabilities: [],
      templates: [
        {
          templateId: 'many',
          kind: 'STRATEGY_VARIANT',
          strategyId: 'baseline',
          strategyVersion: 1,
          researchQuestion: 'question',
          rationale: 'rationale',
          falsificationCriterion: 'criterion',
          featureSets: [['a'], ['b']],
          parameterSpace: { x: [1] },
          requiredDataCapabilities: [],
          complexityUnits: 1,
        },
      ],
      policy: { maximumHypotheses: 1 },
    });

    expect(report.status).toBe('REJECTED');
    expect(report.hypotheses).toEqual([]);
    expect(report.rejectionReasons).toContain('HYPOTHESIS_LIMIT_EXCEEDED');
  });
});

describe('discoverAdaptiveFeatures', () => {
  const input = () => ({
    datasetFingerprint: 'dataset',
    codeCommit: 'commit',
    configurationHash: 'config',
    availableDataCapabilities: ['TRADES', 'BOOKS'],
    baseFeatures: [
      {
        featureName: 'aggressiveDelta',
        role: 'ALPHA' as const,
        requiredDataCapabilities: ['TRADES'],
        maximumSourceLookbackMs: 60_000,
        targetDerived: false,
      },
      {
        featureName: 'bookImbalance',
        role: 'ALPHA' as const,
        requiredDataCapabilities: ['BOOKS'],
        maximumSourceLookbackMs: 5_000,
        targetDerived: false,
      },
      {
        featureName: 'futureReturn',
        role: 'ALPHA' as const,
        requiredDataCapabilities: [],
        maximumSourceLookbackMs: 0,
        targetDerived: true,
      },
    ],
    recipes: [
      {
        recipeId: 'identity',
        operation: 'IDENTITY' as const,
        arity: 1 as const,
        windowsMs: [],
        complexityUnits: 1,
      },
      {
        recipeId: 'interaction-5m',
        operation: 'INTERACTION' as const,
        arity: 2 as const,
        windowsMs: [300_000],
        complexityUnits: 3,
      },
    ],
  });

  it('creates lineage-aware candidates without target-derived inputs', () => {
    const report = discoverAdaptiveFeatures(input());

    expect(report.status).toBe('GENERATED');
    expect(report.generatedCount).toBe(3);
    expect(
      report.candidates.some((candidate) =>
        candidate.inputFeatureNames.includes('futureReturn'),
      ),
    ).toBe(false);
    expect(report.candidates.every((candidate) => candidate.discoveryOnly)).toBe(true);
    expect(report.liveExecutionAllowed).toBe(false);
  });

  it('blocks previously tested feature identities', () => {
    const first = discoverAdaptiveFeatures(input());
    const fingerprint = first.candidates[0]?.featureFingerprint;
    expect(fingerprint).toBeDefined();
    const second = discoverAdaptiveFeatures({
      ...input(),
      priorExperiments: [
        {
          featureFingerprint: fingerprint ?? '',
          status: 'REJECTED',
          completedAt: 1,
        },
      ],
    });

    expect(
      second.candidates.find((candidate) => candidate.featureFingerprint === fingerprint)
        ?.blockingReasons,
    ).toContain('FEATURE_ALREADY_TESTED:REJECTED');
  });
});
