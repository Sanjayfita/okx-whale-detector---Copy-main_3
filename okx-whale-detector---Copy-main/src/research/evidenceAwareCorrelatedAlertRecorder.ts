import type { PerformanceTrace } from '../core/PerformanceTrace';
import {
  CorrelatedAlertRecorder,
  type CorrelatedAlertRecorderOptions,
  type CorrelatedAlertRecordResult,
} from '../recording/CorrelatedAlertRecorder';
import type { CorrelatedAlert } from '../types/correlatedAlert';
import type { CorrelatedAlertRecordContext } from '../types/correlatedAlertEvaluation';

export interface EvidenceAwareCorrelatedAlertRecorderOptions
  extends CorrelatedAlertRecorderOptions {
  onPersistedLiveAlert: (
    alert: CorrelatedAlert,
    context: CorrelatedAlertRecordContext,
  ) => void;
}

export class EvidenceAwareCorrelatedAlertRecorder extends CorrelatedAlertRecorder {
  private readonly onPersistedLiveAlert: (
    alert: CorrelatedAlert,
    context: CorrelatedAlertRecordContext,
  ) => void;

  public constructor(options: EvidenceAwareCorrelatedAlertRecorderOptions) {
    const { onPersistedLiveAlert, ...recorderOptions } = options;
    super(recorderOptions);
    this.onPersistedLiveAlert = onPersistedLiveAlert;
  }

  public override record(
    alert: CorrelatedAlert,
    context: CorrelatedAlertRecordContext,
    trace?: PerformanceTrace,
  ): CorrelatedAlertRecordResult {
    const result = super.record(alert, context, trace);

    if (result.persisted && context.provenance === 'LIVE') {
      this.onPersistedLiveAlert(alert, context);
    }

    return result;
  }
}
