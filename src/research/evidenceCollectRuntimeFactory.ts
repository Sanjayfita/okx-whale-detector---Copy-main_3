import { CorrelatedAlertEvidenceBridge } from './correlatedAlertEvidenceBridge';
import type { EvidenceCollectBootstrap } from './evidenceCollectBootstrap';
import { EvidenceCollectionRuntime } from './evidenceCollectionRuntime';
import {
  LiveEvidenceCollector,
  type LivePriceSnapshot,
} from './liveEvidenceCollector';
import { PersistentOutcomeScheduler } from './persistentOutcomeScheduler';
import { QualifiedAlertRecorder } from './qualifiedAlertRecorder';
import { AlphaResearchSnapshotRecorder } from './alphaResearchSnapshotRecorder';
import { EvidenceEventInitializationStore } from './evidenceEventInitializationStore';
import { EvidenceCollectionHealthStore } from './evidenceCollectionHealthStore';

export interface EvidenceCollectRuntimeFactoryOptions {
  bootstrap: EvidenceCollectBootstrap;
  readPrice: (
    instrumentId: string,
    dueAt: number,
  ) => Promise<LivePriceSnapshot>;
  intervalMs?: number;
  clock?: () => number;
  onError?: (error: unknown) => void;
  onCriticalFailure?: (error: Error) => void;
}

export interface EvidenceCollectRuntimeBundle {
  runtime: EvidenceCollectionRuntime;
  recorder: QualifiedAlertRecorder;
  scheduler: PersistentOutcomeScheduler;
  collector: LiveEvidenceCollector;
  alphaSnapshotRecorder: AlphaResearchSnapshotRecorder;
  bridge: CorrelatedAlertEvidenceBridge;
  liveOrderExecutionAllowed: false;
}

export const createEvidenceCollectRuntimeBundle = (
  options: EvidenceCollectRuntimeFactoryOptions,
): EvidenceCollectRuntimeBundle => {
  const { bootstrap } = options;

  if (
    bootstrap.liveOrderExecutionAllowed !== false ||
    bootstrap.manifest.liveOrderExecutionAllowed !== false ||
    bootstrap.manifest.orderExecutionAuthorized !== false ||
    bootstrap.manifest.dryRunOnly !== true ||
    bootstrap.manifest.transportDispatchAllowed !== false ||
    bootstrap.manifest.testnetExecutionAuthorized !== false
  ) {
    throw new Error('Evidence collection safety locks are invalid');
  }

  const clock = options.clock ?? Date.now;
  const recorder = new QualifiedAlertRecorder({
    evaluationDirectory: bootstrap.evaluationDirectory,
  });
  const scheduler = new PersistentOutcomeScheduler(
    bootstrap.evaluationDirectory,
    bootstrap.manifest.horizonsMinutes,
  );
  const healthStore = new EvidenceCollectionHealthStore(
    bootstrap.evaluationDirectory,
    bootstrap.manifest.evaluationId,
  );
  const collector = new LiveEvidenceCollector({
    recorder,
    scheduler,
    readPrice: options.readPrice,
    clock,
    onObservationError: (error) => options.onError?.(error),
    onObservationMissed: async (job, missedAt) => {
      const error = new Error(
        `Observation window irrecoverably missed: ${job.alertId}/${job.horizonMinutes}m at ${missedAt}`,
      );
      await runtime.failCollectionIntegrity(
        error,
        'OBSERVATION_WINDOW_MISSED',
        job.alertId,
        job.instrumentId,
      );
    },
  });
  const alphaSnapshotRecorder = new AlphaResearchSnapshotRecorder({
    evaluationDirectory: bootstrap.evaluationDirectory,
  });
  const eventInitializationStore = new EvidenceEventInitializationStore(
    bootstrap.evaluationDirectory,
  );
  const bridge = new CorrelatedAlertEvidenceBridge({
    evaluationId: bootstrap.manifest.evaluationId,
    sourceCommit: bootstrap.manifest.sourceCommit,
    configurationFingerprint: bootstrap.manifest.configurationFingerprint,
    alertAdmissionPolicy: 'OKX_ONLY',
  });
  const runtime = new EvidenceCollectionRuntime({
    bridge,
    collector,
    alphaSnapshotRecorder,
    intervalMs: options.intervalMs ?? 1_000,
    clock,
    onError: options.onError,
    onCriticalFailure: options.onCriticalFailure,
    allowedInstrumentIds: bootstrap.manifest.instruments,
    eventInitializationStore,
    healthStore,
  });

  return Object.freeze({
    runtime,
    recorder,
    scheduler,
    collector,
    alphaSnapshotRecorder,
    bridge,
    liveOrderExecutionAllowed: false,
  });
};
