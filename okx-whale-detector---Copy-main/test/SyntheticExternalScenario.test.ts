import { describe, expect, it } from 'vitest';

import { getSyntheticExternalScenario } from '../src/external/demo/SyntheticExternalScenarios';
import { runSyntheticExternalScenario } from '../src/external/demo/runSyntheticExternalScenario';

const runScenario = (name: string) => {
  const scenario = getSyntheticExternalScenario(name);
  if (!scenario) {
    throw new Error(`Missing synthetic scenario ${name}`);
  }

  return runSyntheticExternalScenario(scenario);
};

describe('synthetic external signal scenarios', () => {
  it('produces bearish agreement from OKX and external evidence', () => {
    const report = runScenario('bearish-agreement');

    expect(report.correlation.bias).toBe('BEARISH');
    expect(report.correlation.agreement).toBe('AGREEMENT');
    expect(report.correlation.consideredSignals).toBe(2);
  });

  it('produces bullish agreement from independent sources', () => {
    const report = runScenario('bullish-agreement');

    expect(report.correlation.bias).toBe('BULLISH');
    expect(report.correlation.agreement).toBe('AGREEMENT');
  });

  it('reduces confidence when external evidence contradicts OKX', () => {
    const report = runScenario('contradiction');

    expect(report.correlation.agreement).toBe('CONTRADICTION');
    expect(report.correlation.confidence).toBeLessThan(
      report.correlation.okxConfidence,
    );
  });

  it('deduplicates two providers reporting one transaction', () => {
    const report = runScenario('duplicate-confirmation');

    expect(report.rawSignals).toBe(2);
    expect(report.deduplicatedSignals).toBe(1);
    expect(report.mergedSignals).toBe(1);
    expect(report.evidenceProviders).toEqual(['NANSEN', 'WHALE_ALERT']);
    expect(report.correlation.consideredSignals).toBe(1);
  });

  it('ignores stale and unrelated evidence', () => {
    const report = runScenario('stale-and-unrelated');

    expect(report.correlation.consideredSignals).toBe(0);
    expect(report.correlation.ignoredSignals).toBe(2);
    expect(report.correlation.bias).toBe('NEUTRAL');
  });
});
