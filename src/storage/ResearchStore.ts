import type { BacktestStatistics } from '../backtest/BacktestStatistics';
import type { ResearchMarketDataRecord } from '../data/ResearchMarketData';

export interface StoredFeatureValue {
  readonly featureSetId: string;
  readonly instrumentId: string;
  readonly observedAt: number;
  readonly featureName: string;
  readonly featureValue: number;
  readonly sourceMaxObservedAt: number;
  readonly calculationVersion: number;
}

export interface StoredSignal {
  readonly signalId: string;
  readonly strategyId: string;
  readonly instrumentId: string;
  readonly observedAt: number;
  readonly direction: 'LONG' | 'SHORT' | 'FLAT';
  readonly score: number;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly featureValues: Readonly<Record<string, number>>;
  readonly episodeId: string;
  readonly liveExecutionAllowed: false;
}

export interface StoredBacktest {
  readonly backtestId: string;
  readonly strategyId: string;
  readonly datasetId: string;
  readonly codeCommit: string;
  readonly configurationHash: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly status: 'RUNNING' | 'COMPLETED' | 'REJECTED' | 'FAILED';
  readonly trainingRange: readonly [number, number] | null;
  readonly testRange: readonly [number, number] | null;
  readonly untouchedHoldout: boolean;
  readonly metrics: BacktestStatistics | null;
  readonly rejectionReasons: readonly string[];
}

export interface StoredOptimizationExperiment {
  readonly experimentId: string;
  readonly strategyId: string;
  readonly datasetId: string;
  readonly codeCommit: string;
  readonly searchSpace: Readonly<Record<string, unknown>>;
  readonly optimizer: string;
  readonly objectiveDefinition: Readonly<Record<string, unknown>>;
  readonly seed: number;
  readonly status: 'RUNNING' | 'COMPLETED' | 'REJECTED' | 'FAILED';
  readonly createdAt: string;
  readonly completedAt: string | null;
}

export interface StoredOptimizationTrial {
  readonly experimentId: string;
  readonly trialIndex: number;
  readonly parameters: Readonly<Record<string, number | string | boolean>>;
  readonly foldMetrics: readonly Readonly<Record<string, unknown>>[];
  readonly objectiveValue: number | null;
  readonly overfitReasons: readonly string[];
  readonly status: 'COMPLETED' | 'REJECTED' | 'FAILED';
}

export interface ResearchStoreTransaction {
  appendMarketData(records: readonly ResearchMarketDataRecord[]): Promise<void>;
  appendFeatures(features: readonly StoredFeatureValue[]): Promise<void>;
  appendSignals(signals: readonly StoredSignal[]): Promise<void>;
  saveBacktest(backtest: StoredBacktest): Promise<void>;
  saveOptimizationExperiment(
    experiment: StoredOptimizationExperiment,
  ): Promise<void>;
  saveOptimizationTrials(trials: readonly StoredOptimizationTrial[]): Promise<void>;
}

export interface ResearchStore extends ResearchStoreTransaction {
  withTransaction<T>(
    operation: (transaction: ResearchStoreTransaction) => Promise<T>,
  ): Promise<T>;
  close(): Promise<void>;
}
