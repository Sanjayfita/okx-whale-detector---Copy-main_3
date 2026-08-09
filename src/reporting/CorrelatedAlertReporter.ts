import type { CorrelatedAlert } from '../types/correlatedAlert';
import type { PerformanceRecorder } from '../core/PipelineProfiler';

export class CorrelatedAlertReporter {
  public report(
    alert: CorrelatedAlert,
    performanceRecorder?: PerformanceRecorder,
  ): void {
    const format = (): string =>
      `🚨 CORRELATED ALERT | ${alert.symbol} | ${alert.severity}\n` +
      `Event: ${alert.eventType}\n` +
      `Bias: ${alert.bias}\n` +
      `Relationship: ${alert.relationship}\n` +
      `Directional confidence: ${alert.combinedConfidence.toFixed(1)}%\n` +
      `Alert importance: ${alert.alertImportance.toFixed(1)}%\n` +
      `OKX confidence: ${alert.okxConfidence.toFixed(1)}%\n` +
      `External confidence: ${alert.externalEffectiveConfidence.toFixed(1)}%\n` +
      `External signals used: ${alert.externalSignalsUsed}\n` +
      `Ignored external signals: ${alert.ignoredExternalSignals}\n` +
      `${
        alert.relationship === 'CONTRADICTION'
          ? 'Warning: high disagreement importance does not imply high directional certainty.\n'
          : ''
      }` +
      `Reason: ${alert.reason}`;
    const output = performanceRecorder
      ? performanceRecorder.measure('alert.reporting.formatting', format)
      : format();
    const emit = (): void => console.log(output);

    if (performanceRecorder) {
      performanceRecorder.measure('alert.reporting.consoleEmission', emit);
    } else {
      emit();
    }
  }
}
