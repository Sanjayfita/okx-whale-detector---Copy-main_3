import type { CorrelatedAlert } from '../types/correlatedAlert';
import type { CorrelatedAlertEvaluationContext } from '../types/correlatedAlertEvaluation';
import {
  createQualifiedAlertEvidenceRecord,
  type QualifiedAlertEvidenceRecord,
} from './qualifiedAlertEvidence';

export type EvidenceAlertAdmissionPolicy = 'CORRELATED' | 'OKX_ONLY';

export interface CorrelatedAlertEvidenceIdentity {
  evaluationId: string;
  sourceCommit: string;
  configurationFingerprint: string;
  alertAdmissionPolicy?: EvidenceAlertAdmissionPolicy;
}

export interface CorrelatedAlertEvidenceBridgeInput {
  alert: CorrelatedAlert;
  evaluationContext: CorrelatedAlertEvaluationContext;
  recordedAt: number;
}

export class CorrelatedAlertEvidenceBridge {
  private readonly alertAdmissionPolicy: EvidenceAlertAdmissionPolicy;

  public constructor(private readonly identity: CorrelatedAlertEvidenceIdentity) {
    if (
      identity.evaluationId.trim().length === 0 ||
      identity.sourceCommit.trim().length === 0 ||
      identity.configurationFingerprint.trim().length === 0
    ) {
      throw new Error('Evidence identity fields must not be empty');
    }
    this.alertAdmissionPolicy = identity.alertAdmissionPolicy ?? 'CORRELATED';
  }

  public createEvidence(
    input: CorrelatedAlertEvidenceBridgeInput,
  ): QualifiedAlertEvidenceRecord {
    const { alert, evaluationContext } = input;

    if (evaluationContext.instId !== alert.symbol) {
      throw new Error('Alert symbol does not match its evaluation context');
    }
    if (alert.bias !== 'BULLISH' && alert.bias !== 'BEARISH') {
      throw new Error('Only directional correlated alerts qualify for evidence');
    }
    if (
      this.alertAdmissionPolicy === 'OKX_ONLY' &&
      (alert.relationship !== 'OKX_ONLY' ||
        alert.externalSignalsUsed !== 0 ||
        alert.externalEffectiveConfidence !== 0)
    ) {
      throw new Error(
        'OKX-only evidence requires an OKX_ONLY alert with zero external contribution',
      );
    }

    return createQualifiedAlertEvidenceRecord({
      evaluationId: this.identity.evaluationId,
      alertId: alert.id,
      instrumentId: alert.symbol,
      detectedAt: alert.createdAt,
      recordedAt: input.recordedAt,
      direction: alert.bias,
      signalType: `${alert.eventType}:${alert.relationship}:${alert.severity}`,
      confidence: alert.combinedConfidence,
      referencePrice: evaluationContext.referenceMidpoint,
      bestBid: evaluationContext.referenceBestBid,
      bestAsk: evaluationContext.referenceBestAsk,
      spreadPercent: evaluationContext.referenceSpreadPercent,
      sourceCommit: this.identity.sourceCommit,
      configurationFingerprint: this.identity.configurationFingerprint,
    });
  }
}
