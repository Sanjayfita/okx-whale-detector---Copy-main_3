export interface HealthConfig {
  checkIntervalMs: number;
  reportIntervalMs: number;
  startupGraceMs: number;
  orderBookStaleAfterMs: number;
  candleStaleAfterMs: number;
}

export const healthConfig: HealthConfig = {
  checkIntervalMs: 10_000,
  reportIntervalMs: 60_000,
  startupGraceMs: 20_000,
  orderBookStaleAfterMs: 15_000,
  candleStaleAfterMs: 90_000,
};

export const validateHealthConfig = (config: HealthConfig): void => {
  const errors: string[] = [];

  const requirePositive = (path: keyof HealthConfig, value: number): void => {
    if (!Number.isFinite(value) || value <= 0) {
      errors.push(`${path} must be greater than 0`);
    }
  };

  requirePositive('checkIntervalMs', config.checkIntervalMs);
  requirePositive('reportIntervalMs', config.reportIntervalMs);
  requirePositive('startupGraceMs', config.startupGraceMs);
  requirePositive('orderBookStaleAfterMs', config.orderBookStaleAfterMs);
  requirePositive('candleStaleAfterMs', config.candleStaleAfterMs);

  if (config.reportIntervalMs < config.checkIntervalMs) {
    errors.push(
      'reportIntervalMs must be greater than or equal to checkIntervalMs',
    );
  }

  if (errors.length > 0) {
    throw new Error(`Invalid health configuration:\n- ${errors.join('\n- ')}`);
  }
};
