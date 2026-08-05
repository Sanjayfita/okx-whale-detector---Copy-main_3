import type { AppConfig } from './appConfig';
import { isSafeCorrelatedAlertOutputPath } from '../recording/correlatedAlertPath';

const requireFinitePositive = (
  errors: string[],
  path: string,
  value: number,
): void => {
  if (!Number.isFinite(value) || value <= 0) {
    errors.push(`${path} must be a finite number greater than 0`);
  }
};

const requireFiniteNonNegative = (
  errors: string[],
  path: string,
  value: number,
): void => {
  if (!Number.isFinite(value) || value < 0) {
    errors.push(`${path} must be a finite number greater than or equal to 0`);
  }
};

const requirePercent = (
  errors: string[],
  path: string,
  value: number,
  allowZero = false,
): void => {
  const minimum = allowZero ? 0 : Number.EPSILON;

  if (!Number.isFinite(value) || value < minimum || value > 100) {
    errors.push(
      `${path} must be a finite percentage ${allowZero ? 'between 0 and 100' : 'greater than 0 and at most 100'}`,
    );
  }
};

const requireRatio = (
  errors: string[],
  path: string,
  value: number,
  allowZero = false,
): void => {
  const minimum = allowZero ? 0 : Number.EPSILON;

  if (!Number.isFinite(value) || value < minimum || value > 1) {
    errors.push(
      `${path} must be a finite ratio ${allowZero ? 'between 0 and 1' : 'greater than 0 and at most 1'}`,
    );
  }
};

const requireDescending = (
  errors: string[],
  entries: Array<[path: string, value: number]>,
): void => {
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];

    if (!previous || !current) {
      continue;
    }

    if (previous[1] <= current[1]) {
      errors.push(`${previous[0]} must be greater than ${current[0]}`);
    }
  }
};

export const validateAppConfig = (config: AppConfig): void => {
  const errors: string[] = [];

  requireFinitePositive(
    errors,
    'whale.minimumNotionalQuote',
    config.whale.minimumNotionalQuote,
  );
  requireFiniteNonNegative(
    errors,
    'whale.persistentAfterMs',
    config.whale.persistentAfterMs,
  );
  requireFinitePositive(
    errors,
    'whale.strongAfterMs',
    config.whale.strongAfterMs,
  );
  requirePercent(
    errors,
    'whale.movementPriceTolerancePercent',
    config.whale.movementPriceTolerancePercent,
  );

  if (config.whale.strongAfterMs < config.whale.persistentAfterMs) {
    errors.push(
      'whale.strongAfterMs must be greater than or equal to whale.persistentAfterMs',
    );
  }

  requireFinitePositive(
    errors,
    'tracker.minimumNotionalQuote',
    config.tracker.minimumNotionalQuote,
  );
  requireFiniteNonNegative(
    errors,
    'tracker.persistentAfterSeconds',
    config.tracker.persistentAfterSeconds,
  );
  requireFinitePositive(
    errors,
    'tracker.strongAfterSeconds',
    config.tracker.strongAfterSeconds,
  );
  requireFinitePositive(
    errors,
    'tracker.minimumMovementSizeRatio',
    config.tracker.minimumMovementSizeRatio,
  );
  requireFinitePositive(
    errors,
    'tracker.maximumMovementSizeRatio',
    config.tracker.maximumMovementSizeRatio,
  );

  if (
    config.tracker.strongAfterSeconds < config.tracker.persistentAfterSeconds
  ) {
    errors.push(
      'tracker.strongAfterSeconds must be greater than or equal to tracker.persistentAfterSeconds',
    );
  }

  if (
    config.tracker.minimumMovementSizeRatio >
    config.tracker.maximumMovementSizeRatio
  ) {
    errors.push(
      'tracker.minimumMovementSizeRatio must be less than or equal to tracker.maximumMovementSizeRatio',
    );
  }

  const trackerPositiveFields: Array<[string, number]> = [
    [
      'tracker.movementToleranceHighPrice',
      config.tracker.movementToleranceHighPrice,
    ],
    ['tracker.movementToleranceHigh', config.tracker.movementToleranceHigh],
    [
      'tracker.movementToleranceMediumPrice',
      config.tracker.movementToleranceMediumPrice,
    ],
    ['tracker.movementToleranceMedium', config.tracker.movementToleranceMedium],
    [
      'tracker.movementToleranceLowPrice',
      config.tracker.movementToleranceLowPrice,
    ],
    ['tracker.movementToleranceLow', config.tracker.movementToleranceLow],
    [
      'tracker.movementToleranceVeryLow',
      config.tracker.movementToleranceVeryLow,
    ],
    ['tracker.strengthMaximum', config.tracker.strengthMaximum],
    ['tracker.strengthLargeNotional', config.tracker.strengthLargeNotional],
    ['tracker.strengthLargeScore', config.tracker.strengthLargeScore],
    ['tracker.strengthMediumNotional', config.tracker.strengthMediumNotional],
    ['tracker.strengthMediumScore', config.tracker.strengthMediumScore],
    ['tracker.strengthSmallNotional', config.tracker.strengthSmallNotional],
    ['tracker.strengthSmallScore', config.tracker.strengthSmallScore],
    ['tracker.strengthBaseScore', config.tracker.strengthBaseScore],
    ['tracker.strengthOldAgeSeconds', config.tracker.strengthOldAgeSeconds],
    ['tracker.strengthOldAgeScore', config.tracker.strengthOldAgeScore],
    [
      'tracker.strengthMatureAgeSeconds',
      config.tracker.strengthMatureAgeSeconds,
    ],
    ['tracker.strengthMatureAgeScore', config.tracker.strengthMatureAgeScore],
    [
      'tracker.strengthPersistentAgeSeconds',
      config.tracker.strengthPersistentAgeSeconds,
    ],
    [
      'tracker.strengthPersistentAgeScore',
      config.tracker.strengthPersistentAgeScore,
    ],
    ['tracker.strengthYoungAgeSeconds', config.tracker.strengthYoungAgeSeconds],
    ['tracker.strengthYoungAgeScore', config.tracker.strengthYoungAgeScore],
  ];

  for (const [path, value] of trackerPositiveFields) {
    requireFinitePositive(errors, path, value);
  }

  requireDescending(errors, [
    [
      'tracker.movementToleranceHighPrice',
      config.tracker.movementToleranceHighPrice,
    ],
    [
      'tracker.movementToleranceMediumPrice',
      config.tracker.movementToleranceMediumPrice,
    ],
    [
      'tracker.movementToleranceLowPrice',
      config.tracker.movementToleranceLowPrice,
    ],
  ]);
  requireDescending(errors, [
    ['tracker.strengthLargeNotional', config.tracker.strengthLargeNotional],
    ['tracker.strengthMediumNotional', config.tracker.strengthMediumNotional],
    ['tracker.strengthSmallNotional', config.tracker.strengthSmallNotional],
  ]);
  requireDescending(errors, [
    ['tracker.strengthLargeScore', config.tracker.strengthLargeScore],
    ['tracker.strengthMediumScore', config.tracker.strengthMediumScore],
    ['tracker.strengthSmallScore', config.tracker.strengthSmallScore],
    ['tracker.strengthBaseScore', config.tracker.strengthBaseScore],
  ]);
  requireDescending(errors, [
    ['tracker.strengthOldAgeSeconds', config.tracker.strengthOldAgeSeconds],
    [
      'tracker.strengthMatureAgeSeconds',
      config.tracker.strengthMatureAgeSeconds,
    ],
    [
      'tracker.strengthPersistentAgeSeconds',
      config.tracker.strengthPersistentAgeSeconds,
    ],
    ['tracker.strengthYoungAgeSeconds', config.tracker.strengthYoungAgeSeconds],
  ]);
  requireDescending(errors, [
    ['tracker.strengthOldAgeScore', config.tracker.strengthOldAgeScore],
    ['tracker.strengthMatureAgeScore', config.tracker.strengthMatureAgeScore],
    [
      'tracker.strengthPersistentAgeScore',
      config.tracker.strengthPersistentAgeScore,
    ],
    ['tracker.strengthYoungAgeScore', config.tracker.strengthYoungAgeScore],
  ]);

  if (
    config.tracker.strengthLargeScore + config.tracker.strengthOldAgeScore >
    config.tracker.strengthMaximum
  ) {
    errors.push(
      'tracker maximum combined strength score must not exceed tracker.strengthMaximum',
    );
  }

  requireFiniteNonNegative(
    errors,
    'events.removalGraceMs',
    config.events.removalGraceMs,
  );

  requireFinitePositive(
    errors,
    'polymarket.minimumSignalUsd',
    config.polymarket.minimumSignalUsd,
  );
  requireFinitePositive(
    errors,
    'polymarket.minimumLiquidityUsd',
    config.polymarket.minimumLiquidityUsd,
  );
  requireFinitePositive(
    errors,
    'polymarket.marketLimit',
    config.polymarket.marketLimit,
  );
  requireFinitePositive(
    errors,
    'polymarket.watchMarkets',
    config.polymarket.watchMarkets,
  );
  requireFinitePositive(
    errors,
    'polymarket.windowSeconds',
    config.polymarket.windowSeconds,
  );
  requireRatio(
    errors,
    'polymarket.minimumDominance',
    config.polymarket.minimumDominance,
    true,
  );
  requireFinitePositive(
    errors,
    'polymarket.signalCooldownSeconds',
    config.polymarket.signalCooldownSeconds,
  );
  requireFinitePositive(
    errors,
    'polymarket.statusSeconds',
    config.polymarket.statusSeconds,
  );
  requirePercent(
    errors,
    'events.minimumChangePercent',
    config.events.minimumChangePercent,
  );
  requireFinitePositive(
    errors,
    'events.minimumChangeNotional',
    config.events.minimumChangeNotional,
  );

  requireFiniteNonNegative(
    errors,
    'behavior.spoofMaxAgeSeconds',
    config.behavior.spoofMaxAgeSeconds,
  );
  requireFiniteNonNegative(
    errors,
    'behavior.persistentMinAgeSeconds',
    config.behavior.persistentMinAgeSeconds,
  );
  requireFinitePositive(
    errors,
    'behavior.repeatedIncreaseCount',
    config.behavior.repeatedIncreaseCount,
  );
  requireFinitePositive(
    errors,
    'behavior.growthMultiplier',
    config.behavior.growthMultiplier,
  );

  if (!Number.isInteger(config.behavior.repeatedIncreaseCount)) {
    errors.push('behavior.repeatedIncreaseCount must be an integer');
  }

  requirePercent(
    errors,
    'refill.dropThresholdPercent',
    config.refill.dropThresholdPercent,
  );
  requirePercent(
    errors,
    'refill.recoveryThresholdPercent',
    config.refill.recoveryThresholdPercent,
  );

  const scoringPositiveFields: Array<[string, number]> = [
    ['scoring.maxScore', config.scoring.maxScore],
    ['scoring.maxSizeScore', config.scoring.maxSizeScore],
    ['scoring.maxDistanceScore', config.scoring.maxDistanceScore],
    ['scoring.maxPersistenceScore', config.scoring.maxPersistenceScore],
    ['scoring.maxStabilityScore', config.scoring.maxStabilityScore],
    ['scoring.persistenceWindowMs', config.scoring.persistenceWindowMs],
    [
      'scoring.minimumScoredNotionalQuote',
      config.scoring.minimumScoredNotionalQuote,
    ],
    ['scoring.veryStrongThreshold', config.scoring.veryStrongThreshold],
    ['scoring.strongThreshold', config.scoring.strongThreshold],
    ['scoring.moderateThreshold', config.scoring.moderateThreshold],
  ];

  for (const [path, value] of scoringPositiveFields) {
    requireFinitePositive(errors, path, value);
  }

  const componentScoreTotal =
    config.scoring.maxSizeScore +
    config.scoring.maxDistanceScore +
    config.scoring.maxPersistenceScore +
    config.scoring.maxStabilityScore;

  if (componentScoreTotal > config.scoring.maxScore) {
    errors.push('scoring component maximums must not exceed scoring.maxScore');
  }

  requireDescending(errors, [
    ['scoring.veryStrongThreshold', config.scoring.veryStrongThreshold],
    ['scoring.strongThreshold', config.scoring.strongThreshold],
    ['scoring.moderateThreshold', config.scoring.moderateThreshold],
  ]);

  if (config.scoring.veryStrongThreshold > config.scoring.maxScore) {
    errors.push('scoring.veryStrongThreshold must not exceed scoring.maxScore');
  }

  requirePercent(
    errors,
    'market.neutralBandPercent',
    config.market.neutralBandPercent,
  );
  requireFinitePositive(
    errors,
    'reporting.summaryIntervalMs',
    config.reporting.summaryIntervalMs,
  );
  requireRatio(
    errors,
    'correlation.okxWeight',
    config.correlation.okxWeight,
    true,
  );
  requireRatio(
    errors,
    'correlation.externalWeight',
    config.correlation.externalWeight,
    true,
  );
  if (
    Number.isFinite(config.correlation.okxWeight) &&
    Number.isFinite(config.correlation.externalWeight) &&
    Math.abs(
      config.correlation.okxWeight + config.correlation.externalWeight - 1,
    ) > 1e-9
  ) {
    errors.push('correlation weights must sum to 1');
  }
  requirePercent(
    errors,
    'correlation.minimumEffectiveConfidence',
    config.correlation.minimumEffectiveConfidence,
    true,
  );
  requirePercent(
    errors,
    'correlation.agreementBonus',
    config.correlation.agreementBonus,
    true,
  );
  requirePercent(
    errors,
    'correlation.contradictionPenalty',
    config.correlation.contradictionPenalty,
    true,
  );
  requirePercent(
    errors,
    'correlation.maximumConfidence',
    config.correlation.maximumConfidence,
  );
  if (typeof config.correlatedAlerts.enabled !== 'boolean') {
    errors.push('correlatedAlerts.enabled must be a boolean');
  }
  requirePercent(
    errors,
    'correlatedAlerts.minimumAgreementAlertImportance',
    config.correlatedAlerts.minimumAgreementAlertImportance,
    true,
  );
  requirePercent(
    errors,
    'correlatedAlerts.minimumContradictionAlertImportance',
    config.correlatedAlerts.minimumContradictionAlertImportance,
    true,
  );
  if (typeof config.correlatedAlerts.externalOnlyAlertsEnabled !== 'boolean') {
    errors.push('correlatedAlerts.externalOnlyAlertsEnabled must be a boolean');
  }
  requirePercent(
    errors,
    'correlatedAlerts.minimumExternalOnlyAlertImportance',
    config.correlatedAlerts.minimumExternalOnlyAlertImportance,
    true,
  );
  requireFinitePositive(
    errors,
    'correlatedAlerts.cooldownSeconds',
    config.correlatedAlerts.cooldownSeconds,
  );
  requirePercent(
    errors,
    'correlatedAlerts.confidenceChangeThreshold',
    config.correlatedAlerts.confidenceChangeThreshold,
  );
  const severityThresholds = config.correlatedAlerts.severityThresholds;
  requirePercent(
    errors,
    'correlatedAlerts.severityThresholds.watch',
    severityThresholds.watch,
    true,
  );
  requirePercent(
    errors,
    'correlatedAlerts.severityThresholds.strong',
    severityThresholds.strong,
  );
  requirePercent(
    errors,
    'correlatedAlerts.severityThresholds.critical',
    severityThresholds.critical,
  );
  if (
    severityThresholds.watch >= severityThresholds.strong ||
    severityThresholds.strong >= severityThresholds.critical
  ) {
    errors.push(
      'correlatedAlerts severity thresholds must increase from watch to strong to critical',
    );
  }
  if (
    config.correlatedAlerts.minimumAgreementAlertImportance <
      severityThresholds.watch ||
    config.correlatedAlerts.minimumContradictionAlertImportance <
      severityThresholds.watch ||
    config.correlatedAlerts.minimumExternalOnlyAlertImportance <
      severityThresholds.watch
  ) {
    errors.push(
      'correlated alert minimum importance thresholds must be greater than or equal to the watch severity threshold',
    );
  }
  if (config.correlation.maximumConfidence < severityThresholds.critical) {
    errors.push(
      'correlation.maximumConfidence must be greater than or equal to the critical severity threshold',
    );
  }
  if (typeof config.correlatedAlertRecording.enabled !== 'boolean') {
    errors.push('correlatedAlertRecording.enabled must be a boolean');
  }
  if (
    typeof config.correlatedAlertRecording.outputPath !== 'string' ||
    config.correlatedAlertRecording.outputPath.trim().length === 0
  ) {
    errors.push(
      'correlatedAlertRecording.outputPath must be a non-empty string',
    );
  } else if (
    !isSafeCorrelatedAlertOutputPath(config.correlatedAlertRecording.outputPath)
  ) {
    errors.push(
      'correlatedAlertRecording.outputPath must not traverse outside the project',
    );
  }
  if (
    typeof config.correlatedAlertRecording.flushAfterEachAlert !== 'boolean'
  ) {
    errors.push(
      'correlatedAlertRecording.flushAfterEachAlert must be a boolean',
    );
  }
  requireFinitePositive(
    errors,
    'history.candleLimit',
    config.history.candleLimit,
  );
  requireFinitePositive(
    errors,
    'history.orderBookLevelLimit',
    config.history.orderBookLevelLimit,
  );

  if (!Number.isInteger(config.history.candleLimit)) {
    errors.push('history.candleLimit must be an integer');
  }

  if (!Number.isInteger(config.history.orderBookLevelLimit)) {
    errors.push('history.orderBookLevelLimit must be an integer');
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid application configuration:\n- ${errors.join('\n- ')}`,
    );
  }
};
