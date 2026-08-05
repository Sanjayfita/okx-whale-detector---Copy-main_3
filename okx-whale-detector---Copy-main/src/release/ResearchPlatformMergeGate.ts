export interface ResearchPlatformMergeEvidence {
  readonly repositoryFullName: string;
  readonly pullRequestNumber: number;
  readonly targetBranch: string;
  readonly headCommit: string;
  readonly mergeable: boolean;
  readonly draft: boolean;
  readonly unresolvedReviewThreadCount: number;
  readonly changedFileCount: number;
  readonly documentationUpdated: boolean;
  readonly databaseMigrationsPassed: boolean;
  readonly unitTestsPassed: boolean;
  readonly integrationTestsPassed: boolean;
  readonly typecheckPassed: boolean;
  readonly lintPassed: boolean;
  readonly productionBuildPassed: boolean;
  readonly githubActionsPassed: boolean;
  readonly liveOrderSubmissionEnabled: boolean;
}

export interface ResearchPlatformMergeDecision {
  readonly status: 'READY_TO_MERGE_AS_RESEARCH_FOUNDATION' | 'BLOCKED';
  readonly mergeAllowed: boolean;
  readonly rejectionReasons: readonly string[];
  readonly strategyPromotionAllowed: false;
  readonly testnetExecutionAllowed: false;
  readonly liveExecutionAllowed: false;
  readonly requiresPostMergeEmpiricalValidation: true;
}

const requireNonEmpty = (value: string, name: string): void => {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
};

export const evaluateResearchPlatformMerge = (
  evidence: ResearchPlatformMergeEvidence,
): ResearchPlatformMergeDecision => {
  requireNonEmpty(evidence.repositoryFullName, 'repositoryFullName');
  requireNonEmpty(evidence.targetBranch, 'targetBranch');
  requireNonEmpty(evidence.headCommit, 'headCommit');
  if (
    !Number.isSafeInteger(evidence.pullRequestNumber) ||
    evidence.pullRequestNumber <= 0
  ) {
    throw new Error('pullRequestNumber must be a positive integer');
  }
  if (
    !Number.isSafeInteger(evidence.unresolvedReviewThreadCount) ||
    evidence.unresolvedReviewThreadCount < 0 ||
    !Number.isSafeInteger(evidence.changedFileCount) ||
    evidence.changedFileCount <= 0
  ) {
    throw new Error('review-thread and changed-file counts are invalid');
  }

  const reasons: string[] = [];
  if (!evidence.mergeable) reasons.push('PULL_REQUEST_NOT_MERGEABLE');
  if (evidence.draft) reasons.push('PULL_REQUEST_STILL_DRAFT');
  if (evidence.unresolvedReviewThreadCount !== 0) {
    reasons.push('UNRESOLVED_REVIEW_THREADS');
  }
  if (!evidence.documentationUpdated) reasons.push('DOCUMENTATION_NOT_UPDATED');

  const checks: readonly [boolean, string][] = [
    [evidence.databaseMigrationsPassed, 'DATABASE_MIGRATIONS_FAILED'],
    [evidence.unitTestsPassed, 'UNIT_TESTS_FAILED'],
    [evidence.integrationTestsPassed, 'INTEGRATION_TESTS_FAILED'],
    [evidence.typecheckPassed, 'TYPECHECK_FAILED'],
    [evidence.lintPassed, 'LINT_FAILED'],
    [evidence.productionBuildPassed, 'PRODUCTION_BUILD_FAILED'],
    [evidence.githubActionsPassed, 'GITHUB_ACTIONS_FAILED'],
  ];
  for (const [passed, reason] of checks) {
    if (!passed) reasons.push(reason);
  }
  if (evidence.liveOrderSubmissionEnabled) {
    reasons.push('LIVE_ORDER_SUBMISSION_MUST_REMAIN_DISABLED');
  }

  const rejectionReasons = [...new Set(reasons)];
  const mergeAllowed = rejectionReasons.length === 0;
  return {
    status: mergeAllowed
      ? 'READY_TO_MERGE_AS_RESEARCH_FOUNDATION'
      : 'BLOCKED',
    mergeAllowed,
    rejectionReasons,
    strategyPromotionAllowed: false,
    testnetExecutionAllowed: false,
    liveExecutionAllowed: false,
    requiresPostMergeEmpiricalValidation: true,
  };
};
