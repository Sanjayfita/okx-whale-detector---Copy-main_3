import { describe, expect, it, vi } from 'vitest';
import type { CorrelatedAlertEvidenceBridge } from '../../src/research/correlatedAlertEvidenceBridge';
import type { LiveEvidenceCollector } from '../../src/research/liveEvidenceCollector';
import type { EvidenceCollectionHealthStore } from '../../src/research/evidenceCollectionHealthStore';
import { EvidenceCollectionRuntime } from '../../src/research/evidenceCollectionRuntime';

class MockCollector {
  public initialized = false;
  public initCalled = false;
  public processedAt: number[] = [];
  public async initialize() {
    this.initCalled = true;
    this.initialized = true;
  }
  public getMissedObservationCount() {
    return 0;
  }
  public async processDueObservations(now: number) {
    this.processedAt.push(now);
    return 1;
  }
  public async recordQualifiedAlertIdempotent() {}
  public assertCompleteOutcomeBundle() {}
}

class DummyStore implements EvidenceCollectionHealthStore {
  public failed = false;
  public async initialize() {}
  public isUnhealthy() { return false; }
  public async fail() {
    this.failed = true;
  }
}

describe('EvidenceCollectionRuntime startup', () => {
  it('processes due observations immediately after start', async () => {
    const collector = new MockCollector();
    const runtime = new EvidenceCollectionRuntime({
      collector: collector as unknown as LiveEvidenceCollector,
      bridge: {} as unknown as CorrelatedAlertEvidenceBridge,
      intervalMs: 10000,
      healthStore: new DummyStore() as unknown as EvidenceCollectionHealthStore,
    });

    await runtime.start();
    expect(collector.initCalled).toBe(true);
    expect(collector.processedAt.length).toBeGreaterThanOrEqual(1);
    await runtime.stop();
  });

  it('fails closed when initial due observation processing expires jobs', async () => {
    const collector = new MockCollector();
    const failure = new Error('Observation window expired');
    vi.spyOn(collector, 'processDueObservations').mockImplementation(async () => {
      throw failure;
    });
    const healthStore = new DummyStore();
    let criticalFailure: Error | null = null;
    const runtime = new EvidenceCollectionRuntime({
      collector: collector as unknown as LiveEvidenceCollector,
      bridge: {} as unknown as CorrelatedAlertEvidenceBridge,
      intervalMs: 10000,
      healthStore: healthStore as unknown as EvidenceCollectionHealthStore,
      onCriticalFailure: (error) => {
        criticalFailure = error as Error;
      },
    });

    await expect(runtime.start()).rejects.toThrow('Observation window expired');
    expect(healthStore.failed).toBe(true);
    expect(runtime.isFailedClosed()).toBe(true);
    expect(criticalFailure).toBe(failure);
  });
});
