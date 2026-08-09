import { describe, expect, it } from 'vitest';

import {
  subscriptionConfig,
  validateSubscriptionConfig,
} from '../src/config/subscriptionConfig';

describe('subscription configuration', () => {
  it('accepts the default configuration', () => {
    expect(() => validateSubscriptionConfig(subscriptionConfig)).not.toThrow();
  });

  it('rejects zero symbols per connection', () => {
    expect(() =>
      validateSubscriptionConfig({ maximumSymbolsPerConnection: 0 }),
    ).toThrow('maximumSymbolsPerConnection');
  });

  it('rejects fractional symbols per connection', () => {
    expect(() =>
      validateSubscriptionConfig({ maximumSymbolsPerConnection: 2.5 }),
    ).toThrow('positive integer');
  });
});
