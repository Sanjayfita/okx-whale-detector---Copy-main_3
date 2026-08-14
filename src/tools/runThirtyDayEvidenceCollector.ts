import { resolve } from 'node:path';

import { createAppRuntime } from '../index';
import { loadEvidenceCollectBootstrap } from '../research/evidenceCollectBootstrap';
import { EvidenceCollectorCheckpointStore } from '../research/evidenceCollectorCheckpoint';
import { planEvidenceCollectorDeadline } from '../research/evidenceCollectorDeadline';
import { EvidenceCoverageGapStore } from '../research/evidenceCoverageGap';
import { EvidenceQuarantineStore } from '../research/evidenceQuarantine';
import { PersistentOutcomeScheduler } from '../research/persistentOutcomeScheduler';
import { runEvidenceCollectCommand } from './collectEvidence';

const formatDuration = (milliseconds: number): string => {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60_000));
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  return `${days}d ${hours}h ${minutes}m`;
};

const finalizeExpiredPeriodOffline = async (input: {
  evaluationDirectory: string;
  evaluationId: string;
  horizonsMinutes: readonly number[];
  targetEndAt: number;
  now: number;
  gapStore: EvidenceCoverageGapStore;
}): Promise<number> => {
  const quarantineStore = new EvidenceQuarantineStore(input.evaluationDirectory);
  await quarantineStore.initialize();
  const scheduler = new PersistentOutcomeScheduler(input.evaluationDirectory, input.horizonsMinutes);
  scheduler.setQuarantinedAlertIds(quarantineStore.getAll().map((record) => record.alertId));
  await scheduler.initialize();
  const pending = [...scheduler.getPendingJobs()]
    .filter((job) => job.status === 'PENDING')
    .sort((left, right) => left.dueAt - right.dueAt);
  const handled = new Set<string>();
  for (const job of pending) {
    if (handled.has(job.alertId)) continue;
    handled.add(job.alertId);
    const missedInsidePeriod = job.dueAt <= input.targetEndAt;
    await quarantineStore.quarantine({
      evaluationId: job.evaluationId,
      alertId: job.alertId,
      instrumentId: job.instrumentId,
      detectedAt: job.detectedAt,
      quarantinedAt: input.now,
      reason: missedInsidePeriod ? 'DATA_SOURCE_UNAVAILABLE' : 'COLLECTION_PERIOD_ENDED',
      failedHorizonMinutes: job.horizonMinutes,
      dueAt: job.dueAt,
      gapStartAt: Math.min(job.dueAt, input.targetEndAt),
      gapEndAt: input.now,
      details: missedInsidePeriod
        ? 'Collector was not running when a required in-period outcome became due'
        : 'Fixed 30-day admission period ended before this future horizon',
    });
    if (missedInsidePeriod) {
      await input.gapStore.record({
        gapId: `period-offline:${job.alertId}:${job.dueAt}:${input.now}`,
        evaluationId: input.evaluationId,
        kind: 'OBSERVATION_UNAVAILABLE',
        startedAt: job.dueAt,
        endedAt: input.now,
        instrumentIds: [job.instrumentId],
        alertIds: [job.alertId],
        reason: 'COLLECTOR_OFFLINE_AT_REQUIRED_HORIZON',
        source: 'LIVE',
        recordedAt: input.now,
      });
    }
    await scheduler.quarantineAlert(job.alertId);
  }
  return handled.size;
};

const main = async (): Promise<void> => {
  const evaluationId = process.argv[2]?.trim();
  if (!evaluationId) {
    throw new Error('Usage: npm run evidence:30d -- <evaluation-id>');
  }

  process.env.OKX_SKIP_AUTO_START = '1';
  const bootstrap = await loadEvidenceCollectBootstrap(evaluationId);
  const gapStore = new EvidenceCoverageGapStore(bootstrap.evaluationDirectory);
  await gapStore.initialize();
  const checkpointStore = new EvidenceCollectorCheckpointStore(
    bootstrap.evaluationDirectory,
    evaluationId,
    gapStore,
  );
  const checkpoint = await checkpointStore.initialize(Date.now());

  if (checkpoint.completed) {
    console.log('30-DAY FORWARD VALIDATION PERIOD IS COMPLETE');
    console.log(`Evaluation ID: ${evaluationId}`);
    console.log(`Target end: ${new Date(checkpoint.targetEndAt).toISOString()}`);
    console.log('Live order execution remains disabled.');
    return;
  }
  if (Date.now() >= checkpoint.targetEndAt) {
    const now = Date.now();
    const quarantined = await finalizeExpiredPeriodOffline({
      evaluationDirectory: bootstrap.evaluationDirectory,
      evaluationId,
      horizonsMinutes: bootstrap.manifest.horizonsMinutes,
      targetEndAt: checkpoint.targetEndAt,
      now,
      gapStore,
    });
    await checkpointStore.markCompleted(now);
    console.log(
      `30-day target already elapsed; quarantined ${quarantined} incomplete episode(s) and finalized the collection period.`,
    );
    console.log('Live order execution remains disabled.');
    return;
  }

  const timers: {
    heartbeat?: NodeJS.Timeout;
    status?: NodeJS.Timeout;
    completion?: NodeJS.Timeout;
  } = {};
  const handle = await runEvidenceCollectCommand(evaluationId, {
    createAppRuntime,
    registerSignal: () => undefined,
  });

  let stopping = false;
  const stop = async (
    reason: 'SIGINT' | 'SIGTERM' | 'APPLICATION_CLOSE',
  ): Promise<void> => {
    if (stopping) return;
    stopping = true;
    if (timers.heartbeat !== undefined) clearInterval(timers.heartbeat);
    if (timers.status !== undefined) clearInterval(timers.status);
    if (timers.completion !== undefined) clearTimeout(timers.completion);
    try {
      await handle.stop(reason);
    } finally {
      await checkpointStore.cleanStop(Date.now());
    }
  };

  const signalHandler = (signal: NodeJS.Signals): void => {
    void stop(signal === 'SIGTERM' ? 'SIGTERM' : 'SIGINT').catch((error: unknown) => {
      console.error('30-day collector shutdown failed:', error);
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', signalHandler);
  process.once('SIGTERM', signalHandler);

  timers.heartbeat = setInterval(() => {
    void checkpointStore.heartbeat(Date.now()).catch((error: unknown) => {
      console.error('Collector checkpoint heartbeat failed:', error);
      process.exitCode = 1;
    });
  }, 60_000);

  timers.status = setInterval(() => {
    const current = checkpointStore.get();
    const now = Date.now();
    console.log(
      `30-DAY PROGRESS | elapsed=${formatDuration(now - current.firstStartedAt)} | ` +
        `remaining=${formatDuration(current.targetEndAt - now)} | ` +
        `target=${new Date(current.targetEndAt).toISOString()} | ` +
        `session=${current.sessionSequence}`,
    );
  }, 5 * 60_000);

  const finalizePeriod = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    if (timers.heartbeat !== undefined) clearInterval(timers.heartbeat);
    if (timers.status !== undefined) clearInterval(timers.status);
    if (timers.completion !== undefined) clearTimeout(timers.completion);
    console.log(
      '30-day target reached; closing admissions and quarantining only incomplete end-of-period episodes...',
    );
    await handle.finishPeriod();
    await checkpointStore.markCompleted(Date.now());
    console.log('30-day forward-validation admission period completed cleanly.');
  };

  const scheduleCompletionCheck = (): void => {
    if (stopping) return;
    const plan = planEvidenceCollectorDeadline(Date.now(), checkpoint.targetEndAt);
    if (plan.reached) {
      void finalizePeriod().catch((error: unknown) => {
        console.error('Final 30-day collector shutdown failed:', error);
        process.exitCode = 1;
      });
      return;
    }
    timers.completion = setTimeout(scheduleCompletionCheck, plan.delayMs);
  };
  scheduleCompletionCheck();

  console.log('30-DAY FORWARD VALIDATION COLLECTOR STARTED');
  console.log(`Evaluation ID: ${evaluationId}`);
  console.log(`Evaluation directory: ${resolve(bootstrap.evaluationDirectory)}`);
  console.log(`First start: ${new Date(checkpoint.firstStartedAt).toISOString()}`);
  console.log(`Target end: ${new Date(checkpoint.targetEndAt).toISOString()}`);
  console.log(`Session sequence: ${checkpoint.sessionSequence}`);
  console.log('Incomplete episodes are quarantined; unrelated complete episodes remain valid.');
  console.log('Downtime and coverage gaps are persisted. Missing observations are never fabricated.');
  console.log('Live order execution remains disabled.');
};

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(
      `30-day evidence collector failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
