export const FINAL_EMPIRICAL_VALIDATION_REPORT_SCHEMA_VERSION = 1 as const;

export type EmpiricalValidationVerdict =
  | 'PASSED'
  | 'FAILED'
  | 'INSUFFICIENT_EVIDENCE';

export interface FinalEmpiricalValidationReportInput {
  evaluationId: string;
  sourceCommit: string;
  configurationFingerprint: string;
  collectionDays: number;
  qualifiedAlertCount: number;
  requiredCollectionDays: number;
  requiredQualifiedAlertCount: number;
  evaluatedHorizons: number;
  outperformedHorizons: number;
  profitableAfterCostHorizons: number;
  chronologicalHoldoutUsed: boolean;
}

export interface FinalEmpiricalValidationReport {
  schemaVersion: typeof FINAL_EMPIRICAL_VALIDATION_REPORT_SCHEMA_VERSION;
  evaluationId: string;
  sourceCommit: string;
  configurationFingerprint: string;
  verdict: EmpiricalValidationVerdict;
  evidenceSufficient: boolean;
  baselineRequirementPassed: boolean;
  costRequirementPassed: boolean;
  chronologicalHoldoutPassed: boolean;
  reasons: readonly string[];
  complete: true;
  paperOnly: true;
  orderExecutionAuthorized: false;
  liveOrderExecutionAllowed: false;
}

const requireNonEmpty = (value: string, name: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${name} must not be empty`);
  return normalized;
};

const requireNonNegativeInteger = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value;
};

export const createFinalEmpiricalValidationReport = (
  input: FinalEmpiricalValidationReportInput,
): FinalEmpiricalValidationReport => {
  const collectionDays = requireNonNegativeInteger(input.collectionDays, 'collectionDays');
  const qualifiedAlertCount = requireNonNegativeInteger(
    input.qualifiedAlertCount,
    'qualifiedAlertCount',
  );
  const requiredCollectionDays = requireNonNegativeInteger(
    input.requiredCollectionDays,
    'requiredCollectionDays',
  );
  const requiredQualifiedAlertCount = requireNonNegativeInteger(
    input.requiredQualifiedAlertCount,
    'requiredQualifiedAlertCount',
  );
  const evaluatedHorizons = requireNonNegativeInteger(
    input.evaluatedHorizons,
    'evaluatedHorizons',
  );
  const outperformedHorizons = requireNonNegativeInteger(
    input.outperformedHorizons,
    'outperformedHorizons',
  );
  const profitableAfterCostHorizons = requireNonNegativeInteger(
    input.profitableAfterCostHorizons,
    'profitableAfterCostHorizons',
  );

  if (evaluatedHorizons === 0) throw new Error('evaluatedHorizons must be greater than zero');
  if (outperformedHorizons > evaluatedHorizons) {
    throw new Error('outperformedHorizons cannot exceed evaluatedHorizons');
  }
  if (profitableAfterCostHorizons > evaluatedHorizons) {
    throw new Error('profitableAfterCostHorizons cannot exceed evaluatedHorizons');
  }

  const evidenceSufficient =
    collectionDays >= requiredCollectionDays &&
    qualifiedAlertCount >= requiredQualifiedAlertCount;
  const majority = Math.floor(evaluatedHorizons / 2) + 1;
  const baselineRequirementPassed = outperformedHorizons >= majority;
  const costRequirementPassed = profitableAfterCostHorizons >= majority;
  const chronologicalHoldoutPassed = input.chronologicalHoldoutUsed;

  const reasons: string[] = [];
  if (!evidenceSufficient) reasons.push('Minimum evidence requirements were not met');
  if (!baselineRequirementPassed) reasons.push('Detector did not outperform baseline on a majority of horizons');
  if (!costRequirementPassed) reasons.push('Detector was not profitable after estimated costs on a majority of horizons');
  if (!chronologicalHoldoutPassed) reasons.push('A chronological holdout evaluation was not used');

  const verdict: EmpiricalValidationVerdict = !evidenceSufficient
    ? 'INSUFFICIENT_EVIDENCE'
    : baselineRequirementPassed && costRequirementPassed && chronologicalHoldoutPassed
      ? 'PASSED'
      : 'FAILED';

  return Object.freeze({
    schemaVersion: FINAL_EMPIRICAL_VALIDATION_REPORT_SCHEMA_VERSION,
    evaluationId: requireNonEmpty(input.evaluationId, 'evaluationId'),
    sourceCommit: requireNonEmpty(input.sourceCommit, 'sourceCommit'),
    configurationFingerprint: requireNonEmpty(
      input.configurationFingerprint,
      'configurationFingerprint',
    ),
    verdict,
    evidenceSufficient,
    baselineRequirementPassed,
    costRequirementPassed,
    chronologicalHoldoutPassed,
    reasons: Object.freeze(reasons),
    complete: true,
    paperOnly: true,
    orderExecutionAuthorized: false,
    liveOrderExecutionAllowed: false,
  });
};
