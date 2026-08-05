import { describe, expect, it } from 'vitest';

import {
  createTestnetOrderIntentDocument,
  readTestnetOrderIntentDocumentFromText,
  serializeTestnetOrderIntentDocument,
} from '../src/safety/testnetOrderIntentPersistence';
import { prepareTestnetOrderIntent } from '../src/safety/testnetOrderIntent';
import type { TestnetHumanApprovalCheckpoint } from '../src/safety/testnetHumanApprovalCheckpoint';

const approvalCheckpoint: TestnetHumanApprovalCheckpoint = {
  status: 'ACKNOWLEDGED_FOR_TESTNET_PREPARATION',
  reviewerName: 'EJ',
  reviewedAt: 900,
  approved: true,
  acknowledgement: 'acknowledged',
  reasons: ['test checkpoint'],
  testnetPreparationAcknowledged: true,
  testnetExecutionAuthorized: false,
  orderExecutionAuthorized: false,
};

const createIntent = () =>
  prepareTestnetOrderIntent({
    approvalCheckpoint,
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

describe('testnet order intent persistence', () => {
  it('creates and serializes a deterministic versioned document', () => {
    const document = createTestnetOrderIntentDocument({
      generatedAt: 1_100,
      intent: createIntent(),
    });

    expect(document.schemaVersion).toBe(1);
    expect(document.intent.status).toBe('PREPARED_FOR_DRY_RUN');
    expect(document.intent.transportDispatchAllowed).toBe(false);
    expect(serializeTestnetOrderIntentDocument(document)).toBe(
      serializeTestnetOrderIntentDocument(document),
    );
  });

  it('round-trips canonical JSON', () => {
    const document = createTestnetOrderIntentDocument({
      generatedAt: 1_100,
      intent: createIntent(),
    });

    expect(
      readTestnetOrderIntentDocumentFromText(
        serializeTestnetOrderIntentDocument(document),
      ),
    ).toEqual(document);
  });

  it('rejects unsupported versions and malformed JSON', () => {
    expect(() =>
      readTestnetOrderIntentDocumentFromText('{"schemaVersion":2}'),
    ).toThrow('Unsupported testnet order intent schema version');
    expect(() => readTestnetOrderIntentDocumentFromText('{')).toThrow(
      'Malformed testnet order intent JSON',
    );
  });

  it('rejects changed execution safeguards', () => {
    const document = createTestnetOrderIntentDocument({
      generatedAt: 1_100,
      intent: createIntent(),
    });
    const unsafe = JSON.parse(
      serializeTestnetOrderIntentDocument(document),
    ) as Record<string, unknown>;
    (unsafe.intent as Record<string, unknown>).transportDispatchAllowed = true;

    expect(() =>
      readTestnetOrderIntentDocumentFromText(JSON.stringify(unsafe)),
    ).toThrow('intent execution safeguards are invalid');
  });

  it('rejects inconsistent notional and future intent timestamps', () => {
    const document = createTestnetOrderIntentDocument({
      generatedAt: 1_100,
      intent: createIntent(),
    });
    const inconsistent = JSON.parse(
      serializeTestnetOrderIntentDocument(document),
    ) as Record<string, unknown>;
    (inconsistent.intent as Record<string, unknown>).estimatedNotional = 1;

    expect(() =>
      readTestnetOrderIntentDocumentFromText(JSON.stringify(inconsistent)),
    ).toThrow('intent.estimatedNotional is inconsistent');
    expect(() =>
      createTestnetOrderIntentDocument({
        generatedAt: 999,
        intent: createIntent(),
      }),
    ).toThrow('intent.createdAt cannot be newer than document generatedAt');
  });
});
