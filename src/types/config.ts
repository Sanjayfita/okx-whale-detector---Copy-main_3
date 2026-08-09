import type { WhaleThresholds } from './whale';

export interface DetectorConfig {
  proximityWindowPercent: number;
  wallPriceTolerancePercent: number;
  wallPersistenceMs: number;
  wallStrongMs: number;
  wallRemovalGraceMs: number;
  imbalanceBuyThreshold: number;
  imbalanceSellThreshold: number;
}

export interface WhaleDetectorConfig {
  thresholds: WhaleThresholds;
  detector: DetectorConfig;
}
