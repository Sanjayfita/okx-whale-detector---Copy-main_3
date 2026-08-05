import { describe, expect, it, vi } from 'vitest';

import { CorrelatedAlertReporter } from '../src/reporting/CorrelatedAlertReporter';

describe('CorrelatedAlertReporter', () => {
  it('prints a structured correlated alert', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const reporter = new CorrelatedAlertReporter();

    reporter.report({
      id: 'alert-1',
      symbol: 'BTC-USDT',
      severity: 'STRONG',
      eventType: 'AGREEMENT',
      bias: 'BEARISH',
      relationship: 'AGREEMENT',
      combinedConfidence: 74,
      alertImportance: 82,
      okxConfidence: 81,
      externalEffectiveConfidence: 53,
      externalSignalsUsed: 2,
      ignoredExternalSignals: 1,
      reason: 'OKX and external intelligence agree.',
      createdAt: 1_700_000,
    });

    expect(logSpy).toHaveBeenCalledTimes(1);

    const output = String(logSpy.mock.calls[0]?.[0]);

    expect(output).toContain('🚨 CORRELATED ALERT | BTC-USDT | STRONG');
    expect(output).toContain('Event: AGREEMENT');
    expect(output).toContain('Bias: BEARISH');
    expect(output).toContain('Relationship: AGREEMENT');
    expect(output).toContain('Directional confidence: 74.0%');
    expect(output).toContain('Alert importance: 82.0%');
    expect(output).toContain('OKX confidence: 81.0%');
    expect(output).toContain('External confidence: 53.0%');
    expect(output).toContain('External signals used: 2');
    expect(output).toContain('Ignored external signals: 1');
    expect(output).toContain('Reason: OKX and external intelligence agree.');

    logSpy.mockRestore();
  });

  it('clarifies that contradiction importance is not directional certainty', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const reporter = new CorrelatedAlertReporter();

    reporter.report({
      id: 'alert-2',
      symbol: 'ETH-USDT',
      severity: 'STRONG',
      eventType: 'CONTRADICTION',
      bias: 'BULLISH',
      relationship: 'CONTRADICTION',
      combinedConfidence: 25,
      alertImportance: 70,
      okxConfidence: 80,
      externalEffectiveConfidence: 70,
      externalSignalsUsed: 1,
      ignoredExternalSignals: 0,
      reason: 'External intelligence contradicts the OKX market signal.',
      createdAt: 1_700_000,
    });

    const output = String(logSpy.mock.calls[0]?.[0]);

    expect(output).toContain('Directional confidence: 25.0%');
    expect(output).toContain('Alert importance: 70.0%');
    expect(output).toContain(
      'Warning: high disagreement importance does not imply high directional certainty.',
    );

    logSpy.mockRestore();
  });
});
