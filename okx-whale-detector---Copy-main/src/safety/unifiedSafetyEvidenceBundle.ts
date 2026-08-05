export type SafetyEvidenceState = 'PASS' | 'REVIEW' | 'FAIL';

export interface SafetyEvidenceItem {
  source:
    | 'LIVE_TRADING_READINESS'
    | 'READINESS_TREND'
    | 'PAPER_TRADING_RISK'
    | 'RUNTIME_HEALTH'
    | 'RECORDING_INTEGRITY';
  generatedAt: number;
  state: SafetyEvidenceState;
  summary: string;
  reasons: readonly string[];
}

export type UnifiedSafetyEvidenceStatus =
  | 'BLOCKED'
  | 'MORE_EVIDENCE_REQUIRED'
  | 'READY_FOR_QUALIFICATION_REVIEW';

export interface UnifiedSafetyEvidenceBundle {
  generatedAt: number;
  status: UnifiedSafetyEvidenceStatus;
  evidence: readonly SafetyEvidenceItem[];
  passedSources: readonly SafetyEvidenceItem['source'][];
  reviewSources: readonly SafetyEvidenceItem['source'][];
  failedSources: readonly SafetyEvidenceItem['source'][];
  missingSources: readonly SafetyEvidenceItem['source'][];
  reasons: readonly string[];
  orderExecutionAuthorized: false;
}

const REQUIRED_SOURCES: readonly SafetyEvidenceItem['source'][] = Object.freeze([
  'LIVE_TRADING_READINESS',
  'READINESS_TREND',
  'PAPER_TRADING_RISK',
  'RUNTIME_HEALTH',
  'RECORDING_INTEGRITY',
]);

const validateItem = (item: SafetyEvidenceItem): SafetyEvidenceItem => {
  if (!REQUIRED_SOURCES.includes(item.source)) {
    throw new Error(`Unsupported safety evidence source: ${String(item.source)}`);
  }
  if (!Number.isSafeInteger(item.generatedAt) || item.generatedAt < 0) {
    throw new Error(
      `${item.source}.generatedAt must be a non-negative safe integer`,
    );
  }
  if (!['PASS', 'REVIEW', 'FAIL'].includes(item.state)) {
    throw new Error(`${item.source}.state is invalid`);
  }
  if (item.summary.trim() === '') {
    throw new Error(`${item.source}.summary must not be empty`);
  }

  return Object.freeze({
    ...item,
    reasons: Object.freeze([...item.reasons]),
  });
};

export const createUnifiedSafetyEvidenceBundle = (input: {
  generatedAt: number;
  evidence: readonly SafetyEvidenceItem[];
}): UnifiedSafetyEvidenceBundle => {
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) {
    throw new Error('generatedAt must be a non-negative safe integer');
  }

  const evidence = input.evidence.map(validateItem);
  const seen = new Set<SafetyEvidenceItem['source']>();
  for (const item of evidence) {
    if (seen.has(item.source)) {
      throw new Error(`Duplicate safety evidence source: ${item.source}`);
    }
    if (item.generatedAt > input.generatedAt) {
      throw new Error(`${item.source} cannot be newer than the bundle`);
    }
    seen.add(item.source);
  }

  const passedSources = evidence
    .filter((item) => item.state === 'PASS')
    .map((item) => item.source);
  const reviewSources = evidence
    .filter((item) => item.state === 'REVIEW')
    .map((item) => item.source);
  const failedSources = evidence
    .filter((item) => item.state === 'FAIL')
    .map((item) => item.source);
  const missingSources = REQUIRED_SOURCES.filter((source) => !seen.has(source));
  const reasons: string[] = [];
  let status: UnifiedSafetyEvidenceStatus;

  if (failedSources.length > 0) {
    status = 'BLOCKED';
    reasons.push('One or more required safety evidence sources failed');
  } else if (missingSources.length > 0 || reviewSources.length > 0) {
    status = 'MORE_EVIDENCE_REQUIRED';
    reasons.push('Safety evidence is incomplete or still requires review');
  } else {
    status = 'READY_FOR_QUALIFICATION_REVIEW';
    reasons.push('All required safety evidence sources passed');
  }

  reasons.push('Evidence aggregation never authorizes real-order execution');

  return Object.freeze({
    generatedAt: input.generatedAt,
    status,
    evidence: Object.freeze(
      [...evidence].sort((left, right) => left.source.localeCompare(right.source)),
    ),
    passedSources: Object.freeze([...passedSources].sort()),
    reviewSources: Object.freeze([...reviewSources].sort()),
    failedSources: Object.freeze([...failedSources].sort()),
    missingSources: Object.freeze([...missingSources].sort()),
    reasons: Object.freeze(reasons),
    orderExecutionAuthorized: false,
  });
};
