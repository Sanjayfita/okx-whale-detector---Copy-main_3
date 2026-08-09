import { describe, expect, it } from 'vitest';

import {
  alphaProbabilityLogitScore,
  analyzeAlphaProbabilityCalibration,
  calibrateAlphaProbability,
  fitAlphaLogisticModel,
  fitAlphaPlattCalibrator,
  predictAlphaSuccessProbability,
} from '../src/research/alphaProbabilityModel';
import { createMissingAlphaFeatureValues } from '../src/research/alphaFeatureExtractor';
import type { AlphaResearchDatasetRow } from '../src/research/alphaFeatureTypes';

const createRow = (
  alertId: string,
  executionRatio: number,
  netReturnPercent: number,
): AlphaResearchDatasetRow =>
  Object.freeze({
    evaluationId: 'probability-model-test',
    alertId,
    instrumentId: 'BTC-USDT',
    detectedAt: 1_800_000_000_000 + Number(alertId.replace(/\D/g, '')) * 60_000,
    direction: 'BULLISH' as const,
    outcomeObservedAt:
      1_800_000_900_000 + Number(alertId.replace(/\D/g, '')) * 60_000,
    horizonMinutes: 15 as const,
    grossReturnPercent: netReturnPercent,
    netReturnPercent,
    features: Object.freeze({
      ...createMissingAlphaFeatureValues(),
      execution_ratio: executionRatio,
    }),
    synthetic: false,
  });

describe('alpha probability confidence model', () => {
  it('learns an ordered success probability from training-only features', () => {
    const rows = Array.from({ length: 80 }, (_, index) => {
      const executionRatio = (index - 40) / 20;
      return createRow(
        `row-${index}`,
        executionRatio,
        executionRatio > 0 ? 0.4 : -0.4,
      );
    });
    const model = fitAlphaLogisticModel({
      rows,
      features: ['execution_ratio'],
      l2Lambda: 0.01,
      iterations: 2_000,
      learningRate: 0.05,
    });
    const low = predictAlphaSuccessProbability(
      model,
      createRow('row-100', -1.5, 0),
    );
    const high = predictAlphaSuccessProbability(
      model,
      createRow('row-101', 1.5, 0),
    );

    expect(low).toBeLessThan(0.2);
    expect(high).toBeGreaterThan(0.8);
    expect(high).toBeGreaterThan(low);
    expect(alphaProbabilityLogitScore(model, rows[79]!)).toBeGreaterThan(
      alphaProbabilityLogitScore(model, rows[0]!),
    );
  });

  it('rejects a training population without both outcomes', () => {
    const rows = [
      createRow('row-1', 0.1, 0.2),
      createRow('row-2', 0.2, 0.3),
    ];

    expect(() =>
      fitAlphaLogisticModel({
        rows,
        features: ['execution_ratio'],
        l2Lambda: 0.01,
        iterations: 100,
        learningRate: 0.05,
      }),
    ).toThrow(/both success and failure/);
  });

  it('reports proper probability accuracy and calibration diagnostics', () => {
    const result = analyzeAlphaProbabilityCalibration({
      pairs: [
        { probability: 0.05, success: false },
        { probability: 0.15, success: false },
        { probability: 0.8, success: true },
        { probability: 0.95, success: true },
      ],
      binCount: 5,
      minimumSamples: 4,
    });

    expect(result.sufficientSamples).toBe(true);
    expect(result.baseSuccessRate).toBe(0.5);
    expect(result.rocAuc).toBe(1);
    expect(result.accuracyAtHalf).toBe(1);
    expect(result.brierScore).toBeLessThan(0.03);
    expect(result.logarithmicLoss).toBeLessThan(0.2);
    expect(result.expectedCalibrationError).not.toBeNull();
    expect(result.bins.length).toBeGreaterThan(0);
  });

  it('fits a deterministic Platt calibrator without treating scores as probabilities', () => {
    const calibrator = fitAlphaPlattCalibrator({
      pairs: Array.from({ length: 40 }, (_, index) => ({
        score: (index - 20) / 5,
        success: index >= 20,
      })),
      l2Lambda: 0.01,
      iterations: 2_000,
      learningRate: 0.05,
    });

    expect(calibrateAlphaProbability(calibrator, -3)).toBeLessThan(0.2);
    expect(calibrateAlphaProbability(calibrator, 3)).toBeGreaterThan(0.8);
    expect(calibrateAlphaProbability(calibrator, 3)).toBeGreaterThan(
      calibrateAlphaProbability(calibrator, -3),
    );
  });

  it('returns an explicit empty calibration result', () => {
    const result = analyzeAlphaProbabilityCalibration({
      pairs: [],
      binCount: 10,
      minimumSamples: 30,
    });

    expect(result.sampleSize).toBe(0);
    expect(result.brierScore).toBeNull();
    expect(result.rocAuc).toBeNull();
    expect(result.bins).toEqual([]);
  });
});
