import { describe, expect, it } from 'vitest';

import {
  createRuntimeSessionId,
  RUNTIME_SESSION_ID_DESCRIPTION,
} from '../src/runtime/runtimeSession';

describe('application runtime session identity', () => {
  it('uses an injected deterministic identity', () => {
    expect(createRuntimeSessionId(() => 'deterministic-session')).toBe(
      'deterministic-session',
    );
  });

  it('generates a different identity for a new application runtime', () => {
    expect(createRuntimeSessionId()).not.toBe(createRuntimeSessionId());
  });

  it('documents the shared alert and market recording ownership', () => {
    expect(RUNTIME_SESSION_ID_DESCRIPTION).toBe(
      'The identity of the application runtime that produced related alert and market recordings.',
    );
  });

  it('rejects invalid injected identities', () => {
    expect(() => createRuntimeSessionId(() => 'not valid')).toThrow(
      'sourceSessionId',
    );
  });
});
