import { describe, expect, it } from 'vitest';

import {
  healthConfig,
  validateHealthConfig,
  type HealthConfig,
} from '../src/config/healthConfig';

describe('health configuration', () => {
  it('accepts the default configuration', () => {
    expect(() => validateHealthConfig(healthConfig)).not.toThrow();
  });

  it.each([
    'checkIntervalMs',
    'reportIntervalMs',
    'startupGraceMs',
    'orderBookStaleAfterMs',
    'candleStaleAfterMs',
  ] as const)('rejects a non-positive %s', (field) => {
    const config: HealthConfig = { ...healthConfig, [field]: 0 };

    expect(() => validateHealthConfig(config)).toThrow(field);
  });

  it('rejects reports scheduled faster than health checks', () => {
    expect(() =>
      validateHealthConfig({
        ...healthConfig,
        checkIntervalMs: 10_000,
        reportIntervalMs: 5_000,
      }),
    ).toThrow('reportIntervalMs');
  });
});
