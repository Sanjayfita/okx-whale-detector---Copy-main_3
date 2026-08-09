export interface SubscriptionConfig {
  maximumSymbolsPerConnection: number;
}

export const subscriptionConfig: SubscriptionConfig = {
  maximumSymbolsPerConnection: 6,
};

export const validateSubscriptionConfig = (
  config: SubscriptionConfig,
): void => {
  if (
    !Number.isInteger(config.maximumSymbolsPerConnection) ||
    config.maximumSymbolsPerConnection <= 0
  ) {
    throw new Error(
      'Invalid subscription configuration: ' +
        'maximumSymbolsPerConnection must be a positive integer',
    );
  }
};
