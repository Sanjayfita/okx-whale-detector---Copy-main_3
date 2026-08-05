export interface PerformanceConfig {
  slowUpdateThresholdMs: number;
  warningCooldownMs: number;
  maximumSamplesPerSymbol: number;
  maximumSamplesPerStage: number;
  maximumProfiledStages: number;
  attributionEnabled: boolean;
  warningStageLimit: number;
}

export const performanceConfig: PerformanceConfig = {
  slowUpdateThresholdMs: 25,
  warningCooldownMs: 30_000,
  maximumSamplesPerSymbol: 100,
  maximumSamplesPerStage: 100,
  maximumProfiledStages: 100,
  attributionEnabled: true,
  warningStageLimit: 5,
};

export const validatePerformanceConfig = (config: PerformanceConfig): void => {
  const errors: string[] = [];

  if (
    !Number.isFinite(config.slowUpdateThresholdMs) ||
    config.slowUpdateThresholdMs <= 0
  ) {
    errors.push('slowUpdateThresholdMs must be greater than 0');
  }

  if (
    !Number.isFinite(config.warningCooldownMs) ||
    config.warningCooldownMs < 0
  ) {
    errors.push('warningCooldownMs must be greater than or equal to 0');
  }

  if (
    !Number.isInteger(config.maximumSamplesPerSymbol) ||
    config.maximumSamplesPerSymbol <= 0
  ) {
    errors.push('maximumSamplesPerSymbol must be a positive integer');
  }

  if (
    !Number.isInteger(config.maximumSamplesPerStage) ||
    config.maximumSamplesPerStage <= 0
  ) {
    errors.push('maximumSamplesPerStage must be a positive integer');
  }

  if (
    !Number.isInteger(config.maximumProfiledStages) ||
    config.maximumProfiledStages <= 0
  ) {
    errors.push('maximumProfiledStages must be a positive integer');
  }

  if (typeof config.attributionEnabled !== 'boolean') {
    errors.push('attributionEnabled must be a boolean');
  }

  if (
    !Number.isInteger(config.warningStageLimit) ||
    config.warningStageLimit <= 0
  ) {
    errors.push('warningStageLimit must be a positive integer');
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid performance configuration:\n- ${errors.join('\n- ')}`,
    );
  }
};
