export interface AppConfig {
  whale: {
    minimumNotionalQuote: number;
    persistentAfterMs: number;
    strongAfterMs: number;
    movementPriceTolerancePercent: number;
  };
  tracker: {
    minimumNotionalQuote: number;
    persistentAfterSeconds: number;
    strongAfterSeconds: number;
    minimumMovementSizeRatio: number;
    maximumMovementSizeRatio: number;
    movementToleranceHighPrice: number;
    movementToleranceHigh: number;
    movementToleranceMediumPrice: number;
    movementToleranceMedium: number;
    movementToleranceLowPrice: number;
    movementToleranceLow: number;
    movementToleranceVeryLow: number;
    strengthMaximum: number;
    strengthLargeNotional: number;
    strengthLargeScore: number;
    strengthMediumNotional: number;
    strengthMediumScore: number;
    strengthSmallNotional: number;
    strengthSmallScore: number;
    strengthBaseScore: number;
    strengthOldAgeSeconds: number;
    strengthOldAgeScore: number;
    strengthMatureAgeSeconds: number;
    strengthMatureAgeScore: number;
    strengthPersistentAgeSeconds: number;
    strengthPersistentAgeScore: number;
    strengthYoungAgeSeconds: number;
    strengthYoungAgeScore: number;
  };
  events: {
    removalGraceMs: number;
    minimumChangePercent: number;
    minimumChangeNotional: number;
  };
  behavior: {
    spoofMaxAgeSeconds: number;
    persistentMinAgeSeconds: number;
    repeatedIncreaseCount: number;
    growthMultiplier: number;
  };
  refill: {
    dropThresholdPercent: number;
    recoveryThresholdPercent: number;
  };
  scoring: {
    maxScore: number;
    maxSizeScore: number;
    maxDistanceScore: number;
    maxPersistenceScore: number;
    maxStabilityScore: number;
    persistenceWindowMs: number;
    minimumScoredNotionalQuote: number;
    veryStrongThreshold: number;
    strongThreshold: number;
    moderateThreshold: number;
  };
  market: {
    neutralBandPercent: number;
  };
  reporting: {
    summaryIntervalMs: number;
  };
  correlation: {
    okxWeight: number;
    externalWeight: number;
    minimumEffectiveConfidence: number;
    agreementBonus: number;
    contradictionPenalty: number;
    maximumConfidence: number;
  };
  correlatedAlerts: {
    enabled: boolean;
    minimumAgreementAlertImportance: number;
    minimumContradictionAlertImportance: number;
    externalOnlyAlertsEnabled: boolean;
    minimumExternalOnlyAlertImportance: number;
    cooldownSeconds: number;
    confidenceChangeThreshold: number;
    severityThresholds: {
      watch: number;
      strong: number;
      critical: number;
    };
  };
  correlatedAlertRecording: {
    enabled: boolean;
    outputPath: string;
    flushAfterEachAlert: boolean;
  };
  polymarket: {
    enabled: boolean;
    minimumSignalUsd: number;
    minimumLiquidityUsd: number;
    marketLimit: number;
    watchMarkets: number;
    windowSeconds: number;
    minimumDominance: number;
    signalCooldownSeconds: number;
    statusSeconds: number;
    showExecutions: boolean;
  };
  history: {
    candleLimit: number;
    orderBookLevelLimit: number;
  };
}

export const appConfig: AppConfig = {
  whale: {
    minimumNotionalQuote: 500_000,
    persistentAfterMs: 30_000,
    strongAfterMs: 120_000,
    movementPriceTolerancePercent: 0.1,
  },
  tracker: {
    minimumNotionalQuote: 500_000,
    persistentAfterSeconds: 30,
    strongAfterSeconds: 60,
    minimumMovementSizeRatio: 0.8,
    maximumMovementSizeRatio: 1.2,
    movementToleranceHighPrice: 50_000,
    movementToleranceHigh: 100,
    movementToleranceMediumPrice: 1_000,
    movementToleranceMedium: 10,
    movementToleranceLowPrice: 10,
    movementToleranceLow: 0.5,
    movementToleranceVeryLow: 0.01,
    strengthMaximum: 100,
    strengthLargeNotional: 10_000_000,
    strengthLargeScore: 50,
    strengthMediumNotional: 5_000_000,
    strengthMediumScore: 40,
    strengthSmallNotional: 1_000_000,
    strengthSmallScore: 25,
    strengthBaseScore: 10,
    strengthOldAgeSeconds: 120,
    strengthOldAgeScore: 50,
    strengthMatureAgeSeconds: 60,
    strengthMatureAgeScore: 35,
    strengthPersistentAgeSeconds: 30,
    strengthPersistentAgeScore: 20,
    strengthYoungAgeSeconds: 10,
    strengthYoungAgeScore: 10,
  },
  events: {
    removalGraceMs: 2_000,
    minimumChangePercent: 10,
    minimumChangeNotional: 100_000,
  },
  behavior: {
    spoofMaxAgeSeconds: 3,
    persistentMinAgeSeconds: 30,
    repeatedIncreaseCount: 3,
    growthMultiplier: 1.2,
  },
  refill: {
    dropThresholdPercent: 10,
    recoveryThresholdPercent: 90,
  },
  scoring: {
    maxScore: 100,
    maxSizeScore: 30,
    maxDistanceScore: 25,
    maxPersistenceScore: 25,
    maxStabilityScore: 20,
    persistenceWindowMs: 120_000,
    minimumScoredNotionalQuote: 500_000,
    veryStrongThreshold: 80,
    strongThreshold: 60,
    moderateThreshold: 35,
  },
  market: {
    neutralBandPercent: 10,
  },
  reporting: {
    summaryIntervalMs: 5_000,
  },
  correlation: {
    okxWeight: 0.7,
    externalWeight: 0.3,
    minimumEffectiveConfidence: 5,
    agreementBonus: 8,
    contradictionPenalty: 15,
    maximumConfidence: 100,
  },
  correlatedAlerts: {
    enabled: true,
    minimumAgreementAlertImportance: 55,
    minimumContradictionAlertImportance: 55,
    externalOnlyAlertsEnabled: false,
    minimumExternalOnlyAlertImportance: 55,
    cooldownSeconds: 60,
    confidenceChangeThreshold: 10,
    severityThresholds: {
      watch: 55,
      strong: 65,
      critical: 80,
    },
  },
  correlatedAlertRecording: {
    enabled: true,
    outputPath: 'data/alerts/correlated-alerts.jsonl',
    flushAfterEachAlert: true,
  },
  polymarket: {
    enabled: true,
    minimumSignalUsd: 5_000,
    minimumLiquidityUsd: 5_000,
    marketLimit: 2_000,
    watchMarkets: 100,
    windowSeconds: 60,
    minimumDominance: 0.15,
    signalCooldownSeconds: 15,
    statusSeconds: 30,
    showExecutions: false,
  },
  history: {
    candleLimit: 1_200,
    orderBookLevelLimit: 400,
  },
};
