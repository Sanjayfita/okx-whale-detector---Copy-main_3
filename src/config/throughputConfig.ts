export interface ThroughputConfig {
  reportIntervalMs: number;
  eventLoopSampleIntervalMs: number;
  eventLoopLagWarningMs: number;
  warningCooldownMs: number;
  maximumSymbolsInReport: number;
}

export const throughputConfig: ThroughputConfig = {
  reportIntervalMs: 60_000,
  eventLoopSampleIntervalMs: 1_000,
  eventLoopLagWarningMs: 100,
  warningCooldownMs: 30_000,
  maximumSymbolsInReport: 5,
};

export const validateThroughputConfig = (config: ThroughputConfig): void => {
  const positiveFields: Array<[string, number]> = [
    ['reportIntervalMs', config.reportIntervalMs],
    ['eventLoopSampleIntervalMs', config.eventLoopSampleIntervalMs],
    ['eventLoopLagWarningMs', config.eventLoopLagWarningMs],
  ];
  const errors: string[] = [];

  for (const [name, value] of positiveFields) {
    if (!Number.isFinite(value) || value <= 0) {
      errors.push(`${name} must be greater than 0`);
    }
  }

  if (
    !Number.isFinite(config.warningCooldownMs) ||
    config.warningCooldownMs < 0
  ) {
    errors.push('warningCooldownMs must be greater than or equal to 0');
  }

  if (
    !Number.isInteger(config.maximumSymbolsInReport) ||
    config.maximumSymbolsInReport <= 0
  ) {
    errors.push('maximumSymbolsInReport must be a positive integer');
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid throughput configuration:\n- ${errors.join('\n- ')}`,
    );
  }
};
