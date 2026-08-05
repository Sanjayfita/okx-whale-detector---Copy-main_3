import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createAlertQualityThresholdPolicy,
  createPersistedAlertQualityThresholdEvaluation,
  readAlertQualityThresholdEvaluations,
  readAlertQualityThresholdEvaluationsFromText,
  serializeAlertQualityThresholdEvaluations,
  validatePersistedAlertQualityThresholdEvaluation,
  writeAlertQualityThresholdEvaluations,
  type AlertQualityThresholdReport,
} from '../src/evaluation';

const thresholdReport = (): AlertQualityThresholdReport => ({
  reportRunId: 'alert-quality-report:persistence-test',
  generatedAt: 1_700_000_000_000,
  policy: createAlertQualityThresholdPolicy({ minimumSampleCount: 10 }),
  evaluations: [
    {
      groupKey: 'overall',
      dimension: 'OVERALL',
      value: null,
      status: 'PASS',
      reasons: [],
      observation: {
        sampleCount: 50,
        eligibleRate: 0.9,
        winRate: 0.6,
        expectancyPercent: 0.2,
        ambiguityRate: 0.05,
      },
    },
  ],
  passedCount: 1,
  failedCount: 0,
  insufficientDataCount: 0,
});

describe('alert quality threshold policy persistence', () => {
  it('creates a versioned artifact with deterministic policy fingerprint', () => {
    const artifact = createPersistedAlertQualityThresholdEvaluation({
      thresholdReport: thresholdReport(),
      evaluationRunId: 'threshold-evaluation:test',
      generatedAt: 1_700_000_000_100,
    });

    expect(validatePersistedAlertQualityThresholdEvaluation(artifact)).toBe(true);
    expect(artifact).toMatchObject({
      schemaVersion: 1,
      evaluatorVersion: 'alert-quality-threshold-evaluator-v1',
      sourceReportRunId: 'alert-quality-report:persistence-test',
      passedCount: 1,
    });
    expect(artifact.policyFingerprint).toContain('minimumSampleCount');
  });

  it('serializes in deterministic identity order and deduplicates exact copies', () => {
    const first = createPersistedAlertQualityThresholdEvaluation({
      thresholdReport: thresholdReport(),
      evaluationRunId: 'threshold-evaluation:b',
      generatedAt: 2,
    });
    const second = createPersistedAlertQualityThresholdEvaluation({
      thresholdReport: thresholdReport(),
      evaluationRunId: 'threshold-evaluation:a',
      generatedAt: 1,
    });
    const serialized = serializeAlertQualityThresholdEvaluations([first, second, first]);
    const lines = serialized.trim().split('\n');

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('threshold-evaluation:a');
    expect(lines[1]).toContain('threshold-evaluation:b');
  });

  it('writes and reloads persisted evaluations without issues', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'threshold-policy-persistence-'));
    const filePath = path.join(directory, 'evaluations.jsonl');
    try {
      const artifact = createPersistedAlertQualityThresholdEvaluation({
        thresholdReport: thresholdReport(),
        evaluationRunId: 'threshold-evaluation:reload',
        generatedAt: 3,
      });
      await writeAlertQualityThresholdEvaluations(filePath, [artifact]);
      const result = await readAlertQualityThresholdEvaluations(filePath);

      expect(result.issues).toEqual([]);
      expect(result.evaluations).toHaveLength(1);
      expect(readFileSync(filePath, 'utf8')).toBe(
        serializeAlertQualityThresholdEvaluations([artifact]),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reports malformed, unsupported, and invalid lines while counting exact duplicates', () => {
    const artifact = createPersistedAlertQualityThresholdEvaluation({
      thresholdReport: thresholdReport(),
      evaluationRunId: 'threshold-evaluation:reader',
      generatedAt: 4,
    });
    const invalid = { ...artifact, passedCount: 2 };
    const unsupported = { ...artifact, schemaVersion: 99 };
    const text = [
      JSON.stringify(artifact),
      JSON.stringify(artifact),
      '{broken',
      JSON.stringify(unsupported),
      JSON.stringify(invalid),
    ].join('\n');
    const result = readAlertQualityThresholdEvaluationsFromText(text);

    expect(result.evaluations).toHaveLength(1);
    expect(result.exactDuplicateCount).toBe(1);
    expect(result.issues.map((issue) => issue.reason)).toEqual([
      'MALFORMED_JSON',
      'UNSUPPORTED_SCHEMA_VERSION',
      'INVALID_EVALUATION',
    ]);
  });

  it('rejects a policy fingerprint that does not match the policy', () => {
    const artifact = createPersistedAlertQualityThresholdEvaluation({
      thresholdReport: thresholdReport(),
      evaluationRunId: 'threshold-evaluation:fingerprint',
      generatedAt: 5,
    });

    expect(() =>
      validatePersistedAlertQualityThresholdEvaluation({
        ...artifact,
        policyFingerprint: 'wrong',
      }),
    ).toThrow('policyFingerprint');
  });
});
