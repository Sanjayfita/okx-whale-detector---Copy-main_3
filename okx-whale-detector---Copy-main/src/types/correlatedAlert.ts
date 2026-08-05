import type { CorrelatedMarketSignal } from '../external/core/ExternalSignalCorrelationEngine';
import type { MarketBias } from './signal';

export type CorrelatedAlertSeverity = 'INFO' | 'WATCH' | 'STRONG' | 'CRITICAL';

export type CorrelatedAlertEventType =
  | 'NEW_SIGNAL'
  | 'CONFIDENCE_INCREASED'
  | 'DIRECTION_CHANGED'
  | 'AGREEMENT'
  | 'CONTRADICTION';

export interface CorrelatedAlert {
  id: string;
  /**
   * Identity of the application runtime that produced related alert and market
   * recordings. Present on alerts emitted by the version 2 alert pipeline.
   * Legacy schemaVersion 1 records do not contain durable session identity.
   */
  sourceSessionId?: string;
  alertSequence?: number;
  symbol: string;
  severity: CorrelatedAlertSeverity;
  eventType: CorrelatedAlertEventType;
  bias: MarketBias;
  relationship: CorrelatedMarketSignal['agreement'];
  /** Certainty in the resulting directional bias. */
  combinedConfidence: number;
  /** Operational significance of the correlated relationship. */
  alertImportance: number;
  okxConfidence: number;
  externalEffectiveConfidence: number;
  externalSignalsUsed: number;
  ignoredExternalSignals: number;
  reason: string;
  /** UTC epoch milliseconds when the qualifying alert was emitted. */
  createdAt: number;
}

export interface VersionedCorrelatedAlert extends CorrelatedAlert {
  sourceSessionId: string;
  alertSequence: number;
}
