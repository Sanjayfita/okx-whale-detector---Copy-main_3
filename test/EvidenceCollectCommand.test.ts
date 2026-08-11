import { describe, expect, it, vi } from 'vitest';

import { runEvidenceCollectCommand } from '../src/tools/collectEvidence';
import type { EvidenceCollectBootstrap } from '../src/research/evidenceCollectBootstrap';
import type { createEvidenceCollectRuntimeBundle } from '../src/research/evidenceCollectRuntimeFactory';
import type { OKXLivePriceReader } from '../src/research/okxLivePriceReader';

const bootstrap: EvidenceCollectBootstrap = {
  evaluationDirectory: 'data/evaluations/eval-test',
  liveOrderExecutionAllowed: false,
  manifest: {
    schemaVersion: 1,
    evaluationId: 'eval-test',
    sourceCommit: 'abc123',
    configurationFingerprint: 'fingerprint',
    configuration: {},
    instruments: ['BTC-USDT'],
    horizonsMinutes: [1, 5, 15, 30, 60],
    minimumCollectionDays: 30,
    minimumQualifiedAlerts: 1_000,
    createdAt: 1,
    configurationChangesAllowed: false,
    liveOrderExecutionAllowed: false,
    orderExecutionAuthorized: false,
    dryRunOnly: true,
    transportDispatchAllowed: false,
    testnetExecutionAuthorized: false,
  },
};

const createLeaseHarness = () => {
  const acquire = vi.fn(async () => undefined);
  const release = vi.fn(async () => undefined);
  const createEvaluationLease = vi.fn(() => ({ acquire, release }));
  return { acquire, release, createEvaluationLease };
};

describe('runEvidenceCollectCommand', () => {
  it('starts research evidence collection and shuts down both runtimes once', async () => {
    const runtimeStart = vi.fn(async () => undefined);
    const runtimeStop = vi.fn(async () => undefined);
    const appShutdown = vi.fn(async () => undefined);
    const polymarketStart = vi.fn(async () => undefined);
    const signalHandlers = new Map<NodeJS.Signals, () => void>();
    const lease = createLeaseHarness();

    const createRuntimeBundle = vi.fn(() => ({
      runtime: {
        start: runtimeStart,
        stop: runtimeStop,
        onPersistedLiveAlert: vi.fn(),
      },
      liveOrderExecutionAllowed: false,
    })) as unknown as typeof createEvidenceCollectRuntimeBundle;

    const handle = await runEvidenceCollectCommand('eval-test', {
      loadBootstrap: vi.fn(async () => bootstrap),
      createPriceReader: () =>
        ({ readPrice: vi.fn() }) as unknown as OKXLivePriceReader,
      createRuntimeBundle,
      createEvaluationLease: lease.createEvaluationLease,
      createAppRuntime: vi.fn(async () => ({
        polymarketRuntime: { start: polymarketStart },
        shutdown: appShutdown,
      })),
      registerSignal: (signal, handler) => {
        signalHandlers.set(signal, handler);
      },
      log: vi.fn(),
      error: vi.fn(),
    });

    expect(runtimeStart).toHaveBeenCalledOnce();
    expect(lease.acquire).toHaveBeenCalledOnce();
    expect(
      lease.acquire.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    ).toBeLessThan(
      runtimeStart.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(polymarketStart).toHaveBeenCalledOnce();
    expect(handle.evaluationId).toBe('eval-test');
    expect(handle.liveOrderExecutionAllowed).toBe(false);
    expect(signalHandlers.has('SIGINT')).toBe(true);
    expect(signalHandlers.has('SIGTERM')).toBe(true);

    await handle.stop('SIGTERM');
    await handle.stop('SIGTERM');

    expect(runtimeStop).toHaveBeenCalledOnce();
    expect(lease.release).toHaveBeenCalledOnce();
    expect(appShutdown).toHaveBeenCalledOnce();
    expect(appShutdown).toHaveBeenCalledWith('SIGTERM');
    expect(
      appShutdown.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    ).toBeLessThan(
      runtimeStop.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it('still drains evidence when application shutdown fails', async () => {
    const runtimeStop = vi.fn(async () => undefined);
    const appShutdown = vi.fn(async () => {
      throw new Error('application shutdown failed');
    });
    const lease = createLeaseHarness();
    const createRuntimeBundle = vi.fn(() => ({
      runtime: {
        start: vi.fn(async () => undefined),
        stop: runtimeStop,
        onPersistedLiveAlert: vi.fn(),
      },
      liveOrderExecutionAllowed: false,
    })) as unknown as typeof createEvidenceCollectRuntimeBundle;
    const handle = await runEvidenceCollectCommand('eval-test', {
      loadBootstrap: vi.fn(async () => bootstrap),
      createPriceReader: () =>
        ({ readPrice: vi.fn() }) as unknown as OKXLivePriceReader,
      createRuntimeBundle,
      createEvaluationLease: lease.createEvaluationLease,
      createAppRuntime: vi.fn(async () => ({
        polymarketRuntime: { start: vi.fn() },
        shutdown: appShutdown,
      })),
      registerSignal: vi.fn(),
      log: vi.fn(),
      error: vi.fn(),
    });

    await expect(handle.stop()).rejects.toThrow('application shutdown failed');
    expect(runtimeStop).toHaveBeenCalledOnce();
    expect(lease.release).toHaveBeenCalledOnce();
  });

  it('retains the lease when queued evidence cannot drain safely', async () => {
    const lease = createLeaseHarness();
    const runtimeStop = vi.fn(async () => {
      throw new Error('evidence drain failed');
    });
    const createRuntimeBundle = vi.fn(() => ({
      runtime: {
        start: vi.fn(async () => undefined),
        stop: runtimeStop,
        onPersistedLiveAlert: vi.fn(),
      },
      liveOrderExecutionAllowed: false,
    })) as unknown as typeof createEvidenceCollectRuntimeBundle;
    const handle = await runEvidenceCollectCommand('eval-test', {
      loadBootstrap: vi.fn(async () => bootstrap),
      createPriceReader: () =>
        ({ readPrice: vi.fn() }) as unknown as OKXLivePriceReader,
      createRuntimeBundle,
      createEvaluationLease: lease.createEvaluationLease,
      createAppRuntime: vi.fn(async () => ({
        polymarketRuntime: { start: vi.fn() },
        shutdown: vi.fn(async () => undefined),
      })),
      registerSignal: vi.fn(),
      log: vi.fn(),
      error: vi.fn(),
    });

    await expect(handle.stop()).rejects.toThrow('evidence drain failed');
    expect(runtimeStop).toHaveBeenCalledOnce();
    expect(lease.release).not.toHaveBeenCalled();
  });

  it('stops the evidence runtime when application startup fails', async () => {
    const runtimeStop = vi.fn(async () => undefined);
    const lease = createLeaseHarness();
    const createRuntimeBundle = vi.fn(() => ({
      runtime: {
        start: vi.fn(async () => undefined),
        stop: runtimeStop,
        onPersistedLiveAlert: vi.fn(),
      },
      liveOrderExecutionAllowed: false,
    })) as unknown as typeof createEvidenceCollectRuntimeBundle;

    await expect(
      runEvidenceCollectCommand('eval-test', {
        loadBootstrap: vi.fn(async () => bootstrap),
        createPriceReader: () =>
          ({ readPrice: vi.fn() }) as unknown as OKXLivePriceReader,
        createRuntimeBundle,
        createEvaluationLease: lease.createEvaluationLease,
        createAppRuntime: vi.fn(async () => {
          throw new Error('startup failed');
        }),
        registerSignal: vi.fn(),
        log: vi.fn(),
        error: vi.fn(),
      }),
    ).rejects.toThrow('startup failed');

    expect(runtimeStop).toHaveBeenCalledOnce();
    expect(lease.release).toHaveBeenCalledOnce();
  });

  it('releases the lease when the evidence runtime cannot start', async () => {
    const lease = createLeaseHarness();
    const runtimeStop = vi.fn(async () => undefined);
    const createAppRuntime = vi.fn();
    const createRuntimeBundle = vi.fn(() => ({
      runtime: {
        start: vi.fn(async () => {
          throw new Error('runtime start failed');
        }),
        stop: runtimeStop,
        onPersistedLiveAlert: vi.fn(),
      },
      liveOrderExecutionAllowed: false,
    })) as unknown as typeof createEvidenceCollectRuntimeBundle;

    await expect(
      runEvidenceCollectCommand('eval-test', {
        loadBootstrap: vi.fn(async () => bootstrap),
        createPriceReader: () =>
          ({ readPrice: vi.fn() }) as unknown as OKXLivePriceReader,
        createRuntimeBundle,
        createEvaluationLease: lease.createEvaluationLease,
        createAppRuntime,
        registerSignal: vi.fn(),
        log: vi.fn(),
        error: vi.fn(),
      }),
    ).rejects.toThrow('runtime start failed');

    expect(createAppRuntime).not.toHaveBeenCalled();
    expect(runtimeStop).toHaveBeenCalledOnce();
    expect(lease.release).toHaveBeenCalledOnce();
  });

  it('uses the in-memory OKX order-book stream as the default outcome price source', async () => {
    const lease = createLeaseHarness();
    let readPrice:
      | ((instrumentId: string, dueAt: number) => Promise<unknown>)
      | undefined;
    let livePriceObserver:
      | ((input: {
          instrumentId: string;
          observedAt: number;
          sourceMarketTimestamp: number;
          price: number;
        }) => void)
      | undefined;
    const createRuntimeBundle = vi.fn((options) => {
      readPrice = options.readPrice;
      return {
        runtime: {
          start: vi.fn(async () => undefined),
          stop: vi.fn(async () => undefined),
          onQualifiedMarketContext: vi.fn(),
        },
        liveOrderExecutionAllowed: false as const,
      };
    }) as unknown as typeof createEvidenceCollectRuntimeBundle;

    const handle = await runEvidenceCollectCommand('eval-test', {
      loadBootstrap: vi.fn(async () => bootstrap),
      createRuntimeBundle,
      createEvaluationLease: lease.createEvaluationLease,
      createAppRuntime: vi.fn(async (dependencies) => {
        livePriceObserver = dependencies.liveMarketPriceObserver;
        return {
          polymarketRuntime: { start: vi.fn() },
          shutdown: vi.fn(async () => undefined),
        };
      }),
      registerSignal: vi.fn(),
      log: vi.fn(),
      error: vi.fn(),
    });

    const observedAt = Date.now();
    if (livePriceObserver === undefined || readPrice === undefined) {
      throw new Error('Streaming price reader was not wired into the runtime');
    }
    livePriceObserver({
      instrumentId: 'BTC-USDT',
      observedAt,
      sourceMarketTimestamp: observedAt,
      price: 100.5,
    });
    await expect(readPrice('BTC-USDT', observedAt)).resolves.toMatchObject({
      instrumentId: 'BTC-USDT',
      observedAt,
      price: 100.5,
    });

    await handle.stop();
  });

  it('forwards the streaming market-price observer into the application runtime', async () => {
    const lease = createLeaseHarness();
    const observe = vi.fn();
    const readPrice = vi.fn(async () => ({
      instrumentId: 'BTC-USDT',
      observedAt: 1_000,
      price: 100,
    }));
    let forwardedObserver: unknown;
    const createRuntimeBundle = vi.fn(() => ({
      runtime: {
        start: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
        onQualifiedMarketContext: vi.fn(),
      },
      liveOrderExecutionAllowed: false,
    })) as unknown as typeof createEvidenceCollectRuntimeBundle;

    const handle = await runEvidenceCollectCommand('eval-test', {
      loadBootstrap: vi.fn(async () => bootstrap),
      createPriceReader: () => ({ readPrice, observe }),
      createRuntimeBundle,
      createEvaluationLease: lease.createEvaluationLease,
      createAppRuntime: vi.fn(async (dependencies) => {
        forwardedObserver = dependencies.liveMarketPriceObserver;
        return {
          polymarketRuntime: { start: vi.fn() },
          shutdown: vi.fn(async () => undefined),
        };
      }),
      registerSignal: vi.fn(),
      log: vi.fn(),
      error: vi.fn(),
    });

    expect(forwardedObserver).toBe(observe);
    await handle.stop();
  });
});
