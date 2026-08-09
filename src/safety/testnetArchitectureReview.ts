export type TestnetArchitectureReviewStatus =
  | 'BLOCKED'
  | 'CHANGES_REQUIRED'
  | 'READY_FOR_MANUAL_REVIEW';

export interface TestnetArchitectureChecklist {
  testnetEndpointHardCoded: boolean;
  productionEndpointRejected: boolean;
  credentialsDisabledByDefault: boolean;
  testnetCredentialsIsolated: boolean;
  maximumOrderNotionalConfigured: boolean;
  maximumDailyLossConfigured: boolean;
  emergencyStopImplemented: boolean;
  duplicateOrderProtectionImplemented: boolean;
  clientOrderIdRequired: boolean;
  exchangeReconciliationImplemented: boolean;
  auditLoggingImplemented: boolean;
  manualApprovalRequired: boolean;
  startupSafetyValidationImplemented: boolean;
  productionExecutionCodeAbsent: boolean;
}

export interface TestnetArchitectureReview {
  status: TestnetArchitectureReviewStatus;
  completedChecks: number;
  totalChecks: number;
  missingChecks: readonly (keyof TestnetArchitectureChecklist)[];
  blockers: readonly (keyof TestnetArchitectureChecklist)[];
  reasons: readonly string[];
  testnetExecutionAuthorized: false;
  orderExecutionAuthorized: false;
}

const CHECKLIST_KEYS: readonly (keyof TestnetArchitectureChecklist)[] = Object.freeze([
  'testnetEndpointHardCoded',
  'productionEndpointRejected',
  'credentialsDisabledByDefault',
  'testnetCredentialsIsolated',
  'maximumOrderNotionalConfigured',
  'maximumDailyLossConfigured',
  'emergencyStopImplemented',
  'duplicateOrderProtectionImplemented',
  'clientOrderIdRequired',
  'exchangeReconciliationImplemented',
  'auditLoggingImplemented',
  'manualApprovalRequired',
  'startupSafetyValidationImplemented',
  'productionExecutionCodeAbsent',
]);

const BLOCKING_KEYS: readonly (keyof TestnetArchitectureChecklist)[] = Object.freeze([
  'testnetEndpointHardCoded',
  'productionEndpointRejected',
  'credentialsDisabledByDefault',
  'testnetCredentialsIsolated',
  'emergencyStopImplemented',
  'duplicateOrderProtectionImplemented',
  'clientOrderIdRequired',
  'manualApprovalRequired',
  'productionExecutionCodeAbsent',
]);

export const reviewTestnetArchitecture = (
  checklist: TestnetArchitectureChecklist,
): TestnetArchitectureReview => {
  const missingChecks = CHECKLIST_KEYS.filter((key) => checklist[key] !== true);
  const blockers = BLOCKING_KEYS.filter((key) => checklist[key] !== true);
  const completedChecks = CHECKLIST_KEYS.length - missingChecks.length;
  const reasons: string[] = [];
  let status: TestnetArchitectureReviewStatus;

  if (blockers.length > 0) {
    status = 'BLOCKED';
    reasons.push('One or more mandatory testnet isolation controls are missing');
  } else if (missingChecks.length > 0) {
    status = 'CHANGES_REQUIRED';
    reasons.push('The architecture still requires non-blocking safety improvements');
  } else {
    status = 'READY_FOR_MANUAL_REVIEW';
    reasons.push('All testnet architecture controls are present for manual review');
  }

  reasons.push('Architecture review does not authorize testnet or real-order execution');

  return Object.freeze({
    status,
    completedChecks,
    totalChecks: CHECKLIST_KEYS.length,
    missingChecks: Object.freeze(missingChecks),
    blockers: Object.freeze(blockers),
    reasons: Object.freeze(reasons),
    testnetExecutionAuthorized: false,
    orderExecutionAuthorized: false,
  });
};
