export type LiveTradingReadinessStatus =
  | 'NOT_READY'
  | 'REVIEW_REQUIRED'
  | 'READY_FOR_MANUAL_REVIEW';

export interface LiveTradingReadinessChecklist {
  credentialsIsolated: boolean;
  tradePermissionDisabledByDefault: boolean;
  maximumOrderNotionalConfigured: boolean;
  maximumDailyLossConfigured: boolean;
  emergencyStopImplemented: boolean;
  duplicateOrderProtectionImplemented: boolean;
  exchangeReconciliationImplemented: boolean;
  auditLoggingImplemented: boolean;
  manualApprovalRequired: boolean;
  testnetValidationCompleted: boolean;
  independentSecurityReviewCompleted: boolean;
}

export interface LiveTradingReadinessAssessment {
  status: LiveTradingReadinessStatus;
  completedChecks: number;
  totalChecks: number;
  missingChecks: readonly (keyof LiveTradingReadinessChecklist)[];
  reasons: readonly string[];
  orderExecutionAuthorized: false;
}

const REQUIRED_CHECKS: readonly (keyof LiveTradingReadinessChecklist)[] = Object.freeze([
  'credentialsIsolated',
  'tradePermissionDisabledByDefault',
  'maximumOrderNotionalConfigured',
  'maximumDailyLossConfigured',
  'emergencyStopImplemented',
  'duplicateOrderProtectionImplemented',
  'exchangeReconciliationImplemented',
  'auditLoggingImplemented',
  'manualApprovalRequired',
  'testnetValidationCompleted',
  'independentSecurityReviewCompleted',
]);

const CRITICAL_CHECKS: ReadonlySet<keyof LiveTradingReadinessChecklist> = new Set([
  'credentialsIsolated',
  'tradePermissionDisabledByDefault',
  'maximumOrderNotionalConfigured',
  'maximumDailyLossConfigured',
  'emergencyStopImplemented',
  'duplicateOrderProtectionImplemented',
  'manualApprovalRequired',
]);

export const assessLiveTradingReadiness = (
  checklist: LiveTradingReadinessChecklist,
): LiveTradingReadinessAssessment => {
  const missingChecks = REQUIRED_CHECKS.filter((check) => !checklist[check]);
  const completedChecks = REQUIRED_CHECKS.length - missingChecks.length;
  const missingCriticalCheck = missingChecks.some((check) => CRITICAL_CHECKS.has(check));

  let status: LiveTradingReadinessStatus;
  const reasons: string[] = [];

  if (missingCriticalCheck) {
    status = 'NOT_READY';
    reasons.push('One or more critical live-trading safety controls are missing');
  } else if (missingChecks.length > 0) {
    status = 'REVIEW_REQUIRED';
    reasons.push('Critical controls are present, but the full readiness checklist is incomplete');
  } else {
    status = 'READY_FOR_MANUAL_REVIEW';
    reasons.push('All checklist items are complete; independent manual approval is still required');
  }

  reasons.push('This assessment never authorizes real-order execution');

  return Object.freeze({
    status,
    completedChecks,
    totalChecks: REQUIRED_CHECKS.length,
    missingChecks: Object.freeze([...missingChecks]),
    reasons: Object.freeze(reasons),
    orderExecutionAuthorized: false,
  });
};
