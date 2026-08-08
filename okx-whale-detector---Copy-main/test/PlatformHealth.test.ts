import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPlatformHealthSnapshot } from '../src/platform/PlatformHealth';

const directories: string[] = [];

const dataDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'platform-health-'));
  directories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const baseInput = (directory: string) => ({
  now: 1_000_000,
  startedAt: 0,
  timeframe: '1m' as const,
  timeframeState: 'READY' as const,
  lastCandleTimestamp: 900_000,
  lastCandleReceivedAt: 999_000,
  lastStrategyEvaluationAt: 900_000,
  websocketConnected: true,
  websocketLastMessageAt: 999_000,
  websocketReconnectAttempts: 0,
  okxRestConnected: true,
  okxRestLastSuccessAt: 999_000,
  okxRestLastError: null,
  persistenceHealthy: true,
  lastSuccessfulPersistenceAt: 999_000,
  persistenceError: null,
  stateFilePath: null,
  paperEngineError: null,
  openPositions: 1,
  killSwitchActive: false,
  circuitBreakerActive: false,
  dataDirectory: directory,
  deployment: {
    gitCommit: 'abc123',
    imageVersion: 'phase12-abc123',
    configurationVersion: 'phase12-v1',
  },
});

describe('PlatformHealth', () => {
  it('reports RUNNING only when connectivity, market data and persistence are healthy', () => {
    const health = buildPlatformHealthSnapshot(baseInput(dataDirectory()));

    expect(health.application).toBe('RUNNING');
    expect(health.okxRest.status).toBe('CONNECTED');
    expect(health.okxWebSocket.status).toBe('CONNECTED');
    expect(health.marketData.status).toBe('HEALTHY');
    expect(health.strategy.status).toBe('RUNNING');
    expect(health.persistence.status).toBe('HEALTHY');
    expect(health.liveExecutionAllowed).toBe(false);
  });

  it('detects stale live market data even while the process and WebSocket are connected', () => {
    const directory = dataDirectory();
    const health = buildPlatformHealthSnapshot({
      ...baseInput(directory),
      lastCandleReceivedAt: 700_000,
    });

    expect(health.application).toBe('DEGRADED');
    expect(health.okxWebSocket.status).toBe('CONNECTED');
    expect(health.marketData.status).toBe('STALE');
    expect(health.strategy.status).toBe('PAUSED');
  });

  it('reports a risk lockout as a paused/degraded strategy', () => {
    const directory = dataDirectory();
    const health = buildPlatformHealthSnapshot({
      ...baseInput(directory),
      killSwitchActive: true,
    });

    expect(health.application).toBe('DEGRADED');
    expect(health.strategy.status).toBe('PAUSED');
    expect(health.risk.killSwitchActive).toBe(true);
  });

  it('fails closed when paper persistence reports an error', () => {
    const directory = dataDirectory();
    const health = buildPlatformHealthSnapshot({
      ...baseInput(directory),
      persistenceHealthy: false,
      persistenceError: 'disk write failed',
    });

    expect(health.application).toBe('FAILED');
    expect(health.persistence).toMatchObject({
      status: 'FAILED',
      lastError: 'disk write failed',
    });
  });
});
