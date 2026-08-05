import { describe, expect, it } from 'vitest';

import {
  prepareTestnetOrderIntent,
  type TestnetOrderIntentInput,
} from '../src/safety/testnetOrderIntent';
import type { TestnetHumanApprovalCheckpoint } from '../src/safety/testnetHumanApprovalCheckpoint';

const checkpoint = (
  acknowledged: boolean,
): TestnetHumanApprovalCheckpoint => ({
  status: acknowledged
    ? 'ACKNOWLEDGED_FOR_TESTNET_PREPARATION'
    : 'APPROVAL_REQUIRED',
  reviewerName: acknowledged ? 'EJ' : '',
  reviewedAt: 900,
  approved: acknowledged,
  acknowledgement: acknowledged ? 'acknowledged' : '',
  reasons: ['test checkpoint'],
  testnetPreparationAcknowledged: acknowledged,
  testnetExecutionAuthorized: false,
  orderExecutionAuthorized: false,
});

const baseInput = (): TestnetOrderIntentInput => ({
  approvalCheckpoint: checkpoint(true),
  environment: 'TESTNET',
  instrumentId: 'BTC-USDT-SWAP',
  side: 'BUY',
  orderType: 'LIMIT',
  quantity: 0.001,
  referencePrice: 100_000,
  limitPrice: 99_000,
  maximumNotional: 150,
  createdAt: 1_000,
});

describe('prepareTestnetOrderIntent', () => {
  it('prepares a deterministic dry-run intent without execution authority', () => {
    const intent = prepareTestnetOrderIntent(baseInput());

    expect(intent.status).toBe('PREPARED_FOR_DRY_RUN');
    expect(intent.estimatedNotional).toBe(99);
    expect(intent.dryRunOnly).toBe(true);
    expect(intent.transportDispatchAllowed).toBe(false);
    expect(intent.testnetExecutionAuthorized).toBe(false);
    expect(intent.orderExecutionAuthorized).toBe(false);
  });

  it('rejects production and missing human acknowledgement', () => {
    const intent = prepareTestnetOrderIntent({
      ...baseInput(),
      environment: 'PRODUCTION',
      approvalCheckpoint: checkpoint(false),
    });

    expect(intent.status).toBe('REJECTED');
    expect(intent.reasons).toContain('Only the testnet environment is accepted');
    expect(intent.reasons).toContain(
      'Human approval checkpoint has not acknowledged testnet preparation',
    );
  });

  it('rejects estimated notional above the configured limit', () => {
    const intent = prepareTestnetOrderIntent({
      ...baseInput(),
      quantity: 1,
      maximumNotional: 50,
    });

    expect(intent.status).toBe('REJECTED');
    expect(intent.reasons).toContain(
      'Estimated notional exceeds the configured testnet limit',
    );
  });

  it('requires a limit price for limit orders and validates values', () => {
    expect(() =>
      prepareTestnetOrderIntent({ ...baseInput(), limitPrice: undefined }),
    ).toThrow('limitPrice must be a positive finite number');

    expect(() =>
      prepareTestnetOrderIntent({ ...baseInput(), quantity: 0 }),
    ).toThrow('quantity must be a positive finite number');
  });

  it('is deterministic for identical input', () => {
    expect(prepareTestnetOrderIntent(baseInput())).toEqual(
      prepareTestnetOrderIntent(baseInput()),
    );
  });
});
