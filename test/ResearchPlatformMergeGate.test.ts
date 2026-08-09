import { describe, expect, it } from 'vitest';

import {
  evaluateResearchPlatformMerge,
  type ResearchPlatformMergeEvidence,
} from '../src/release/ResearchPlatformMergeGate';

const readyEvidence = (): ResearchPlatformMergeEvidence => ({
  repositoryFullName: 'Sanjayfita/okx-whale-detector---Copy-main_3',
  pullRequestNumber: 1,
  targetBranch: 'main',
  headCommit: 'abc123',
  mergeable: true,
  draft: false,
  unresolvedReviewThreadCount: 0,
  changedFileCount: 1,
  documentationUpdated: true,
  databaseMigrationsPassed: true,
  unitTestsPassed: true,
  integrationTestsPassed: true,
  typecheckPassed: true,
  lintPassed: true,
  productionBuildPassed: true,
  githubActionsPassed: true,
  liveOrderSubmissionEnabled: false,
});

describe('evaluateResearchPlatformMerge', () => {
  it('allows a platform merge without promoting a strategy', () => {
    const decision = evaluateResearchPlatformMerge(readyEvidence());

    expect(decision.status).toBe('READY_TO_MERGE_AS_RESEARCH_FOUNDATION');
    expect(decision.mergeAllowed).toBe(true);
    expect(decision.strategyPromotionAllowed).toBe(false);
    expect(decision.testnetExecutionAllowed).toBe(false);
    expect(decision.liveExecutionAllowed).toBe(false);
    expect(decision.requiresPostMergeEmpiricalValidation).toBe(true);
  });

  it('blocks failed engineering checks and unsafe execution state', () => {
    const decision = evaluateResearchPlatformMerge({
      ...readyEvidence(),
      githubActionsPassed: false,
      unresolvedReviewThreadCount: 2,
      liveOrderSubmissionEnabled: true,
    });

    expect(decision.status).toBe('BLOCKED');
    expect(decision.mergeAllowed).toBe(false);
    expect(decision.rejectionReasons).toEqual([
      'UNRESOLVED_REVIEW_THREADS',
      'GITHUB_ACTIONS_FAILED',
      'LIVE_ORDER_SUBMISSION_MUST_REMAIN_DISABLED',
    ]);
  });

  it('requires a draft pull request to be marked ready', () => {
    const decision = evaluateResearchPlatformMerge({
      ...readyEvidence(),
      draft: true,
    });

    expect(decision.mergeAllowed).toBe(false);
    expect(decision.rejectionReasons).toContain('PULL_REQUEST_STILL_DRAFT');
  });
});
