import { describe, expect, it } from 'vitest';

import {
  evaluateTestnetHumanApproval,
  TESTNET_PREPARATION_ACKNOWLEDGEMENT,
} from '../src/safety/testnetHumanApprovalCheckpoint';
import type { TestnetArchitectureReview } from '../src/safety/testnetArchitectureReview';

const architectureReview = (
  status: TestnetArchitectureReview['status'],
): TestnetArchitectureReview => ({
  status,
  completedChecks: status === 'READY_FOR_MANUAL_REVIEW' ? 14 : 10,
  totalChecks: 14,
  missingChecks: status === 'READY_FOR_MANUAL_REVIEW' ? [] : ['auditLoggingImplemented'],
  blockers: status === 'BLOCKED' ? ['productionEndpointRejected'] : [],
  reasons: ['test review'],
  testnetExecutionAuthorized: false,
  orderExecutionAuthorized: false,
});

describe('evaluateTestnetHumanApproval', () => {
  it('acknowledges testnet preparation after exact human approval', () => {
    const checkpoint = evaluateTestnetHumanApproval({
      architectureReview: architectureReview('READY_FOR_MANUAL_REVIEW'),
      reviewerName: 'EJ',
      reviewedAt: 1_000,
      approved: true,
      acknowledgement: TESTNET_PREPARATION_ACKNOWLEDGEMENT,
    });

    expect(checkpoint.status).toBe('ACKNOWLEDGED_FOR_TESTNET_PREPARATION');
    expect(checkpoint.testnetPreparationAcknowledged).toBe(true);
    expect(checkpoint.testnetExecutionAuthorized).toBe(false);
    expect(checkpoint.orderExecutionAuthorized).toBe(false);
  });

  it('requires explicit approval and exact acknowledgement', () => {
    const checkpoint = evaluateTestnetHumanApproval({
      architectureReview: architectureReview('READY_FOR_MANUAL_REVIEW'),
      reviewerName: '',
      reviewedAt: 1_000,
      approved: false,
      acknowledgement: 'approved',
    });

    expect(checkpoint.status).toBe('APPROVAL_REQUIRED');
    expect(checkpoint.reasons).toContain('Explicit human approval is required');
    expect(checkpoint.reasons).toContain('Reviewer name is required');
    expect(checkpoint.reasons).toContain(
      'The exact non-execution acknowledgement is required',
    );
    expect(checkpoint.testnetPreparationAcknowledged).toBe(false);
  });

  it('blocks approval until architecture review is ready', () => {
    const checkpoint = evaluateTestnetHumanApproval({
      architectureReview: architectureReview('BLOCKED'),
      reviewerName: 'EJ',
      reviewedAt: 1_000,
      approved: true,
      acknowledgement: TESTNET_PREPARATION_ACKNOWLEDGEMENT,
    });

    expect(checkpoint.status).toBe('BLOCKED');
    expect(checkpoint.testnetPreparationAcknowledged).toBe(false);
    expect(checkpoint.testnetExecutionAuthorized).toBe(false);
  });

  it('rejects invalid timestamps and is deterministic', () => {
    expect(() =>
      evaluateTestnetHumanApproval({
        architectureReview: architectureReview('READY_FOR_MANUAL_REVIEW'),
        reviewerName: 'EJ',
        reviewedAt: -1,
        approved: true,
        acknowledgement: TESTNET_PREPARATION_ACKNOWLEDGEMENT,
      }),
    ).toThrow('reviewedAt must be a non-negative safe integer');

    const input = {
      architectureReview: architectureReview('READY_FOR_MANUAL_REVIEW'),
      reviewerName: ' EJ ',
      reviewedAt: 1_000,
      approved: true,
      acknowledgement: TESTNET_PREPARATION_ACKNOWLEDGEMENT,
    } as const;

    expect(evaluateTestnetHumanApproval(input)).toEqual(
      evaluateTestnetHumanApproval(input),
    );
  });
});
