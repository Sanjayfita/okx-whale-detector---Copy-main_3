import { describe, expect, it } from 'vitest';

import {
  throughputConfig,
  validateThroughputConfig,
  type ThroughputConfig,
} from '../src/config/throughputConfig';

const validateOverride = (override: Partial<ThroughputConfig>): void => {
  validateThroughputConfig({ ...throughputConfig, ...override });
};

describe('throughput configuration', () => {
  it('accepts the default configuration', () => {
    expect(() => validateThroughputConfig(throughputConfig)).not.toThrow();
  });

  it.each([
    ['reportIntervalMs', 0],
    ['eventLoopSampleIntervalMs', 0],
    ['eventLoopLagWarningMs', 0],
  ] as const)('rejects invalid %s', (field, value) => {
    expect(() => validateOverride({ [field]: value })).toThrow(field);
  });

  it('rejects a negative warning cooldown', () => {
    expect(() => validateOverride({ warningCooldownMs: -1 })).toThrow(
      'warningCooldownMs',
    );
  });

  it('rejects a non-positive or fractional report symbol limit', () => {
    expect(() => validateOverride({ maximumSymbolsInReport: 0 })).toThrow(
      'maximumSymbolsInReport',
    );
    expect(() => validateOverride({ maximumSymbolsInReport: 1.5 })).toThrow(
      'maximumSymbolsInReport',
    );
  });
});
