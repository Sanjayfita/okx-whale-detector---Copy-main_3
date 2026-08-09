import { randomUUID } from 'node:crypto';

export const RUNTIME_SESSION_ID_DESCRIPTION =
  'The identity of the application runtime that produced related alert and market recordings.';

export const isValidRuntimeSessionId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);

export const createRuntimeSessionId = (
  factory: () => string = randomUUID,
): string => {
  const sourceSessionId = factory();

  if (!isValidRuntimeSessionId(sourceSessionId)) {
    throw new Error(
      'sourceSessionId must contain 1-128 URL-safe identifier characters',
    );
  }

  return sourceSessionId;
};
