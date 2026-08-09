import type { CorrelatedMarketSignal } from '../external/core/ExternalSignalCorrelationEngine';
import { isValidRuntimeSessionId } from '../runtime/runtimeSession';
import type {
  CorrelatedAlertEventType,
  CorrelatedAlertSeverity,
  VersionedCorrelatedAlert,
} from '../types/correlatedAlert';
import type { MarketEvaluation } from '../types/marketEvaluation';

export interface CorrelatedAlertEngineOptions {
  sourceSessionId: string;
  enabled?: boolean;
  minimumAgreementAlertImportance?: number;
  minimumContradictionAlertImportance?: number;
  externalOnlyAlertsEnabled?: boolean;
  minimumExternalOnlyAlertImportance?: number;
  okxOnlyAlertsEnabled?: boolean;
  minimumOkxOnlyAlertImportance?: number;
  severityThresholds?: Partial<CorrelatedAlertSeverityThresholds>;
  cooldownMs?: number;
  confidenceChangeThreshold?: number;
  clock?: () => number;
  initialAlertSequence?: number;
}

export interface CorrelatedAlertSeverityThresholds {
  watch: number;
  strong: number;
  critical: number;
}

interface CorrelatedAlertState {
  bias: CorrelatedMarketSignal['bias'];
  relationship: CorrelatedMarketSignal['agreement'];
  severity: CorrelatedAlertSeverity;
  combinedConfidence: number;
  alertImportance: number;
  emittedAt: number;
}

const DEFAULT_OPTIONS = {
  enabled: true,
  minimumAgreementAlertImportance: 55,
  minimumContradictionAlertImportance: 55,
  externalOnlyAlertsEnabled: false,
  minimumExternalOnlyAlertImportance: 55,
  okxOnlyAlertsEnabled: false,
  minimumOkxOnlyAlertImportance: 55,
  cooldownMs: 60_000,
  confidenceChangeThreshold: 10,
} as const;

const DEFAULT_SEVERITY_THRESHOLDS: CorrelatedAlertSeverityThresholds = {
  watch: 55,
  strong: 65,
  critical: 80,
};

const SEVERITY_RANK: Readonly<Record<CorrelatedAlertSeverity, number>> = {
  INFO: 0,
  WATCH: 1,
  STRONG: 2,
  CRITICAL: 3,
};

export class CorrelatedAlertEngine {
  private readonly enabled: boolean;
  private readonly minimumAgreementAlertImportance: number;
  private readonly minimumContradictionAlertImportance: number;
  private readonly externalOnlyAlertsEnabled: boolean;
  private readonly minimumExternalOnlyAlertImportance: number;
  private readonly okxOnlyAlertsEnabled: boolean;
  private readonly minimumOkxOnlyAlertImportance: number;
  private readonly severityThresholds: CorrelatedAlertSeverityThresholds;
  private readonly cooldownMs: number;
  private readonly confidenceChangeThreshold: number;
  private readonly clock: () => number;
  public readonly sourceSessionId: string;
  private readonly states = new Map<string, CorrelatedAlertState>();
  private nextAlertSequence: number;

  public constructor(options: CorrelatedAlertEngineOptions) {
    this.enabled = options.enabled ?? DEFAULT_OPTIONS.enabled;
    this.minimumAgreementAlertImportance =
      options.minimumAgreementAlertImportance ??
      DEFAULT_OPTIONS.minimumAgreementAlertImportance;
    this.minimumContradictionAlertImportance =
      options.minimumContradictionAlertImportance ??
      DEFAULT_OPTIONS.minimumContradictionAlertImportance;
    this.externalOnlyAlertsEnabled =
      options.externalOnlyAlertsEnabled ??
      DEFAULT_OPTIONS.externalOnlyAlertsEnabled;
    this.minimumExternalOnlyAlertImportance =
      options.minimumExternalOnlyAlertImportance ??
      DEFAULT_OPTIONS.minimumExternalOnlyAlertImportance;
    this.okxOnlyAlertsEnabled =
      options.okxOnlyAlertsEnabled ?? DEFAULT_OPTIONS.okxOnlyAlertsEnabled;
    this.minimumOkxOnlyAlertImportance =
      options.minimumOkxOnlyAlertImportance ??
      DEFAULT_OPTIONS.minimumOkxOnlyAlertImportance;
    this.severityThresholds = {
      ...DEFAULT_SEVERITY_THRESHOLDS,
      ...options.severityThresholds,
    };
    this.cooldownMs = options.cooldownMs ?? DEFAULT_OPTIONS.cooldownMs;
    this.confidenceChangeThreshold =
      options.confidenceChangeThreshold ??
      DEFAULT_OPTIONS.confidenceChangeThreshold;
    this.clock = options.clock ?? Date.now;
    this.sourceSessionId = options.sourceSessionId;
    this.nextAlertSequence = (options.initialAlertSequence ?? 0) + 1;

    this.validateOptions();
  }

  public evaluate(
    evaluation: MarketEvaluation,
    createdAtOverride?: number,
  ): VersionedCorrelatedAlert | undefined {
    const correlatedSignal = evaluation.correlatedSignal;

    if (
      !this.enabled ||
      !correlatedSignal ||
      !this.hasEligibleEvidenceSource(correlatedSignal) ||
      !this.qualifies(correlatedSignal)
    ) {
      return undefined;
    }

    const severity = this.getSeverity(correlatedSignal.alertImportance);
    const previous = this.states.get(correlatedSignal.symbol);
    const createdAt = createdAtOverride ?? this.clock();

    if (
      previous &&
      createdAt - previous.emittedAt < this.cooldownMs &&
      !this.canBypassCooldown(correlatedSignal, severity, previous)
    ) {
      return undefined;
    }

    const eventType = this.getEventType(correlatedSignal, previous);
    const alertSequence = this.nextAlertSequence;
    const alert: VersionedCorrelatedAlert = {
      id: `correlated-alert:${this.sourceSessionId}:${alertSequence}`,
      sourceSessionId: this.sourceSessionId,
      alertSequence,
      symbol: correlatedSignal.symbol,
      severity,
      eventType,
      bias: correlatedSignal.bias,
      relationship: correlatedSignal.agreement,
      combinedConfidence: correlatedSignal.confidence,
      alertImportance: correlatedSignal.alertImportance,
      okxConfidence: correlatedSignal.okxConfidence,
      externalEffectiveConfidence: correlatedSignal.externalConfidence,
      externalSignalsUsed: correlatedSignal.consideredSignals,
      ignoredExternalSignals: correlatedSignal.ignoredSignals,
      reason: this.getReason(correlatedSignal),
      createdAt,
    };

    this.nextAlertSequence += 1;
    this.states.set(correlatedSignal.symbol, {
      bias: correlatedSignal.bias,
      relationship: correlatedSignal.agreement,
      severity,
      combinedConfidence: correlatedSignal.confidence,
      alertImportance: correlatedSignal.alertImportance,
      emittedAt: createdAt,
    });

    return alert;
  }

  public resetSymbol(symbol: string): void {
    this.states.delete(symbol);
  }

  public clear(): void {
    this.states.clear();
  }

  private hasEligibleEvidenceSource(signal: CorrelatedMarketSignal): boolean {
    if (signal.agreement === 'OKX_ONLY') {
      return this.okxOnlyAlertsEnabled && signal.consideredSignals === 0;
    }

    if (signal.agreement === 'EXTERNAL_ONLY') {
      return this.externalOnlyAlertsEnabled && signal.consideredSignals > 0;
    }

    if (
      signal.agreement === 'AGREEMENT' ||
      signal.agreement === 'CONTRADICTION'
    ) {
      return signal.consideredSignals > 0;
    }

    return false;
  }

  private canBypassCooldown(
    signal: CorrelatedMarketSignal,
    severity: CorrelatedAlertSeverity,
    previous: CorrelatedAlertState,
  ): boolean {
    return (
      signal.bias !== previous.bias ||
      (signal.agreement === 'CONTRADICTION' &&
        previous.relationship !== 'CONTRADICTION') ||
      SEVERITY_RANK[severity] > SEVERITY_RANK[previous.severity] ||
      Math.abs(signal.confidence - previous.combinedConfidence) >=
        this.confidenceChangeThreshold ||
      Math.abs(signal.alertImportance - previous.alertImportance) >=
        this.confidenceChangeThreshold
    );
  }

  private getEventType(
    signal: CorrelatedMarketSignal,
    previous: CorrelatedAlertState | undefined,
  ): CorrelatedAlertEventType {
    if (
      previous &&
      signal.agreement === 'CONTRADICTION' &&
      previous.relationship !== 'CONTRADICTION'
    ) {
      return 'CONTRADICTION';
    }

    if (previous && signal.bias !== previous.bias) {
      return 'DIRECTION_CHANGED';
    }

    if (previous && signal.confidence > previous.combinedConfidence) {
      return 'CONFIDENCE_INCREASED';
    }

    if (signal.agreement === 'AGREEMENT') {
      return 'AGREEMENT';
    }

    if (signal.agreement === 'CONTRADICTION') {
      return 'CONTRADICTION';
    }

    return 'NEW_SIGNAL';
  }

  private qualifies(signal: CorrelatedMarketSignal): boolean {
    if (signal.agreement === 'AGREEMENT') {
      return signal.alertImportance >= this.minimumAgreementAlertImportance;
    }

    if (signal.agreement === 'CONTRADICTION') {
      return signal.alertImportance >= this.minimumContradictionAlertImportance;
    }

    if (signal.agreement === 'EXTERNAL_ONLY') {
      return (
        this.externalOnlyAlertsEnabled &&
        signal.alertImportance >= this.minimumExternalOnlyAlertImportance
      );
    }

    if (signal.agreement === 'OKX_ONLY') {
      return (
        this.okxOnlyAlertsEnabled &&
        signal.alertImportance >= this.minimumOkxOnlyAlertImportance
      );
    }

    return false;
  }

  private getSeverity(alertImportance: number): CorrelatedAlertSeverity {
    if (alertImportance >= this.severityThresholds.critical) {
      return 'CRITICAL';
    }

    if (alertImportance >= this.severityThresholds.strong) {
      return 'STRONG';
    }

    if (alertImportance >= this.severityThresholds.watch) {
      return 'WATCH';
    }

    return 'INFO';
  }

  private getReason(signal: CorrelatedMarketSignal): string {
    if (
      signal.agreement === 'CONTRADICTION' &&
      !/\b(?:warning|contradict|conflict)\b/i.test(signal.reason)
    ) {
      return `Contradiction warning: ${signal.reason}`;
    }

    return signal.reason;
  }

  private validateOptions(): void {
    if (typeof this.enabled !== 'boolean') {
      throw new Error('enabled must be a boolean');
    }

    const importanceThresholds = [
      ['minimumAgreementAlertImportance', this.minimumAgreementAlertImportance],
      [
        'minimumContradictionAlertImportance',
        this.minimumContradictionAlertImportance,
      ],
      [
        'minimumExternalOnlyAlertImportance',
        this.minimumExternalOnlyAlertImportance,
      ],
      ['minimumOkxOnlyAlertImportance', this.minimumOkxOnlyAlertImportance],
    ] as const;

    for (const [name, value] of importanceThresholds) {
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new Error(`${name} must be between 0 and 100`);
      }
    }

    if (typeof this.externalOnlyAlertsEnabled !== 'boolean') {
      throw new Error('externalOnlyAlertsEnabled must be a boolean');
    }

    if (typeof this.okxOnlyAlertsEnabled !== 'boolean') {
      throw new Error('okxOnlyAlertsEnabled must be a boolean');
    }

    const { watch, strong, critical } = this.severityThresholds;

    if (
      !Number.isFinite(watch) ||
      !Number.isFinite(strong) ||
      !Number.isFinite(critical) ||
      watch < 0 ||
      critical > 100 ||
      watch >= strong ||
      strong >= critical
    ) {
      throw new Error(
        'severity thresholds must be finite values between 0 and 100 that increase from watch to strong to critical',
      );
    }

    if (!Number.isFinite(this.cooldownMs) || this.cooldownMs < 0) {
      throw new Error('cooldownMs must be a non-negative finite number');
    }

    if (
      !Number.isFinite(this.confidenceChangeThreshold) ||
      this.confidenceChangeThreshold <= 0 ||
      this.confidenceChangeThreshold > 100
    ) {
      throw new Error(
        'confidenceChangeThreshold must be greater than 0 and at most 100',
      );
    }

    if (!isValidRuntimeSessionId(this.sourceSessionId)) {
      throw new Error(
        'sourceSessionId must contain 1-128 URL-safe identifier characters',
      );
    }

    if (
      !Number.isSafeInteger(this.nextAlertSequence) ||
      this.nextAlertSequence <= 0
    ) {
      throw new Error(
        'initialAlertSequence must be a non-negative safe integer',
      );
    }
  }
}
