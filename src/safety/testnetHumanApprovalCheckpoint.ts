import type { TestnetArchitectureReview } from './testnetArchitectureReview';

export type TestnetHumanApprovalStatus =
  | 'BLOCKED'
  | 'APPROVAL_REQUIRED'
  | 'ACKNOWLEDGED_FOR_TESTNET_PREPARATION';

export interface TestnetHumanApprovalInput {
  architectureReview: TestnetArchitectureReview;
  reviewerName: string;
  reviewedAt: number;
  approved: boolean;
  acknowledgement: string;
}

export interface TestnetHumanApprovalCheckpoint {
  status: TestnetHumanApprovalStatus;
  reviewerName: string;
  reviewedAt: number;
  approved: boolean;
  acknowledgement: string;
  reasons: readonly string[];
  testnetPreparationAcknowledged: boolean;
  testnetExecutionAuthorized: false;
  orderExecutionAuthorized: false;
}

const REQUIRED_ACKNOWLEDGEMENT =
  'I understand this approval only permits further testnet preparation and does not authorize order execution.';

export const evaluateTestnetHumanApproval = (
  input: TestnetHumanApprovalInput,
): TestnetHumanApprovalCheckpoint => {
  if (!Number.isSafeInteger(input.reviewedAt) || input.reviewedAt < 0) {
    throw new Error('reviewedAt must be a non-negative safe integer');
  }

  const reviewerName = input.reviewerName.trim();
  const acknowledgement = input.acknowledgement.trim();
  const reasons: string[] = [];
  let status: TestnetHumanApprovalStatus;
  let testnetPreparationAcknowledged = false;

  if (input.architectureReview.status !== 'READY_FOR_MANUAL_REVIEW') {
    status = 'BLOCKED';
    reasons.push('Testnet architecture must be ready for manual review first');
  } else if (
    !input.approved ||
    reviewerName === '' ||
    acknowledgement !== REQUIRED_ACKNOWLEDGEMENT
  ) {
    status = 'APPROVAL_REQUIRED';
    if (!input.approved) reasons.push('Explicit human approval is required');
    if (reviewerName === '') reasons.push('Reviewer name is required');
    if (acknowledgement !== REQUIRED_ACKNOWLEDGEMENT) {
      reasons.push('The exact non-execution acknowledgement is required');
    }
  } else {
    status = 'ACKNOWLEDGED_FOR_TESTNET_PREPARATION';
    testnetPreparationAcknowledged = true;
    reasons.push('Human review acknowledged further testnet preparation only');
  }

  reasons.push('Human approval never authorizes testnet or real-order execution');

  return Object.freeze({
    status,
    reviewerName,
    reviewedAt: input.reviewedAt,
    approved: input.approved,
    acknowledgement,
    reasons: Object.freeze(reasons),
    testnetPreparationAcknowledged,
    testnetExecutionAuthorized: false,
    orderExecutionAuthorized: false,
  });
};

export const TESTNET_PREPARATION_ACKNOWLEDGEMENT = REQUIRED_ACKNOWLEDGEMENT;
