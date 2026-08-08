import { statfsSync, statSync } from 'node:fs';
import type { TradingTimeframe } from '../config/tradingTimeframes';
import { tradingTimeframeSpec } from '../config/tradingTimeframes';
import type { DeploymentIdentity } from './DeploymentIdentity';
import type { TimeframeLoadState } from './PlatformContracts';

export type ApplicationHealthStatus = 'RUNNING' | 'DEGRADED' | 'FAILED';
export type ConnectivityHealthStatus = 'CONNECTED' | 'FAILED';
export type WebSocketHealthStatus = 'CONNECTED' | 'DISCONNECTED';
export type MarketDataHealthStatus = 'HEALTHY' | 'STALE';
export type StrategyHealthStatus = 'RUNNING' | 'PAUSED';
export type ComponentHealthStatus = 'HEALTHY' | 'FAILED';
export type DiskHealthStatus = 'HEALTHY' | 'LOW';

export interface PlatformHealthSnapshot {
  readonly generatedAt: number;
  readonly application: ApplicationHealthStatus;
  readonly okxRest: {
    readonly status: ConnectivityHealthStatus;
    readonly lastSuccessAt: number | null;
    readonly lastError: string | null;
  };
  readonly okxWebSocket: {
    readonly status: WebSocketHealthStatus;
    readonly lastMessageAt: number | null;
    readonly reconnectAttempts: number;
  };
  readonly marketData: {
    readonly status: MarketDataHealthStatus;
    readonly timeframe: TradingTimeframe;
    readonly lastCandleTimestamp: number | null;
    readonly lastReceivedAt: number | null;
    readonly staleAfterMs: number;
  };
  readonly strategy: {
    readonly status: StrategyHealthStatus;
    readonly lastEvaluationAt: number | null;
    readonly timeframeState: TimeframeLoadState;
  };
  readonly risk: {
    readonly killSwitchActive: boolean;
    readonly circuitBreakerActive: boolean;
  };
  readonly paperEngine: {
    readonly status: ComponentHealthStatus;
    readonly openPositions: number;
    readonly lastError: string | null;
  };
  readonly persistence: {
    readonly status: ComponentHealthStatus;
    readonly lastSuccessfulPersistenceAt: number | null;
    readonly stateFileSizeBytes: number | null;
    readonly lastError: string | null;
  };
  readonly disk: {
    readonly status: DiskHealthStatus;
    readonly freeBytes: number | null;
    readonly totalBytes: number | null;
    readonly freePercent: number | null;
  };
  readonly deployment: DeploymentIdentity;
  readonly liveExecutionAllowed: false;
}

export interface PlatformHealthInput {
  readonly now: number;
  readonly startedAt: number;
  readonly timeframe: TradingTimeframe;
  readonly timeframeState: TimeframeLoadState;
  readonly lastCandleTimestamp: number | null;
  readonly lastCandleReceivedAt: number | null;
  readonly lastStrategyEvaluationAt: number | null;
  readonly websocketConnected: boolean;
  readonly websocketLastMessageAt: number | null;
  readonly websocketReconnectAttempts: number;
  readonly okxRestConnected: boolean;
  readonly okxRestLastSuccessAt: number | null;
  readonly okxRestLastError: string | null;
  readonly persistenceHealthy: boolean;
  readonly lastSuccessfulPersistenceAt: number | null;
  readonly persistenceError: string | null;
  readonly stateFilePath: string | null;
  readonly paperEngineError: string | null;
  readonly openPositions: number;
  readonly killSwitchActive: boolean;
  readonly circuitBreakerActive: boolean;
  readonly dataDirectory: string;
  readonly deployment: DeploymentIdentity;
  readonly staleMultiplier?: number;
  readonly startupGraceMs?: number;
  readonly minimumFreeBytes?: number;
  readonly minimumFreePercent?: number;
}

const fileSize = (path: string | null): number | null => {
  if (path === null) return null;
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
};

const diskUsage = (
  path: string,
  minimumFreeBytes: number,
  minimumFreePercent: number,
): PlatformHealthSnapshot['disk'] => {
  try {
    const stats = statfsSync(path);
    const blockSize = Number(stats.bsize);
    const totalBytes = Number(stats.blocks) * blockSize;
    const freeBytes = Number(stats.bavail) * blockSize;
    const freePercent = totalBytes > 0 ? (freeBytes / totalBytes) * 100 : 0;
    return {
      status:
        freeBytes < minimumFreeBytes || freePercent < minimumFreePercent
          ? 'LOW'
          : 'HEALTHY',
      freeBytes,
      totalBytes,
      freePercent,
    };
  } catch {
    return {
      status: 'LOW',
      freeBytes: null,
      totalBytes: null,
      freePercent: null,
    };
  }
};

export const buildPlatformHealthSnapshot = (
  input: PlatformHealthInput,
): PlatformHealthSnapshot => {
  const staleMultiplier = input.staleMultiplier ?? 2.5;
  const startupGraceMs = input.startupGraceMs ?? 90_000;
  const staleAfterMs = Math.max(
    60_000,
    Math.ceil(tradingTimeframeSpec(input.timeframe).intervalMs * staleMultiplier),
  );
  const startupGraceActive = input.now - input.startedAt < startupGraceMs;
  const stale =
    !startupGraceActive &&
    (input.lastCandleReceivedAt === null ||
      input.now - input.lastCandleReceivedAt > staleAfterMs);
  const marketDataStatus: MarketDataHealthStatus = stale ? 'STALE' : 'HEALTHY';
  const riskPaused = input.killSwitchActive || input.circuitBreakerActive;
  const strategyStatus: StrategyHealthStatus =
    input.timeframeState === 'READY' && !stale && !riskPaused
      ? 'RUNNING'
      : 'PAUSED';
  const disk = diskUsage(
    input.dataDirectory,
    input.minimumFreeBytes ?? 1_073_741_824,
    input.minimumFreePercent ?? 10,
  );
  const componentFailure =
    !input.persistenceHealthy || input.paperEngineError !== null;
  const degraded =
    !input.okxRestConnected ||
    !input.websocketConnected ||
    stale ||
    strategyStatus === 'PAUSED' ||
    disk.status === 'LOW';

  return {
    generatedAt: input.now,
    application: componentFailure ? 'FAILED' : degraded ? 'DEGRADED' : 'RUNNING',
    okxRest: {
      status: input.okxRestConnected ? 'CONNECTED' : 'FAILED',
      lastSuccessAt: input.okxRestLastSuccessAt,
      lastError: input.okxRestLastError,
    },
    okxWebSocket: {
      status: input.websocketConnected ? 'CONNECTED' : 'DISCONNECTED',
      lastMessageAt: input.websocketLastMessageAt,
      reconnectAttempts: input.websocketReconnectAttempts,
    },
    marketData: {
      status: marketDataStatus,
      timeframe: input.timeframe,
      lastCandleTimestamp: input.lastCandleTimestamp,
      lastReceivedAt: input.lastCandleReceivedAt,
      staleAfterMs,
    },
    strategy: {
      status: strategyStatus,
      lastEvaluationAt: input.lastStrategyEvaluationAt,
      timeframeState: input.timeframeState,
    },
    risk: {
      killSwitchActive: input.killSwitchActive,
      circuitBreakerActive: input.circuitBreakerActive,
    },
    paperEngine: {
      status: input.paperEngineError === null ? 'HEALTHY' : 'FAILED',
      openPositions: input.openPositions,
      lastError: input.paperEngineError,
    },
    persistence: {
      status: input.persistenceHealthy ? 'HEALTHY' : 'FAILED',
      lastSuccessfulPersistenceAt: input.lastSuccessfulPersistenceAt,
      stateFileSizeBytes: fileSize(input.stateFilePath),
      lastError: input.persistenceError,
    },
    disk,
    deployment: input.deployment,
    liveExecutionAllowed: false,
  };
};
