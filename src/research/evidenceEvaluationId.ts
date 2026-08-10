export const requireSafeEvidenceEvaluationId = (
  value: string,
  name = 'evaluationId',
): string => {
  const normalized = value.trim();
  if (normalized.startsWith('$')) {
    throw new Error(
      `${name} looks like an unexpanded PowerShell variable; use $EvaluationId without quotes after assigning it`,
    );
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,127}$/u.test(normalized)) {
    throw new Error(
      `${name} must be a safe directory name and safe path segment: 3-128 characters using only letters, numbers, dot, underscore, or hyphen`,
    );
  }
  return normalized;
};
