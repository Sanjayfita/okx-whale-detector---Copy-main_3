import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isErrorWithCode } from '../core/errorGuards';
import { writeEvidenceJsonAtomically } from './evidenceAtomicFile';
import type { EvidenceCoverageGapStore } from './evidenceCoverageGap';

export const EVIDENCE_COLLECTOR_CHECKPOINT_SCHEMA_VERSION = 1 as const;
export const THIRTY_DAYS_MS = 30 * 86_400_000;

export interface EvidenceCollectorCheckpoint {
  readonly schemaVersion: typeof EVIDENCE_COLLECTOR_CHECKPOINT_SCHEMA_VERSION;
  readonly evaluationId: string;
  readonly firstStartedAt: number;
  readonly targetEndAt: number;
  readonly lastStartedAt: number;
  readonly lastHeartbeatAt: number;
  readonly lastCleanStopAt: number | null;
  readonly sessionSequence: number;
  readonly completed: boolean;
  readonly liveOrderExecutionAllowed: false;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const safeTs = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export const parseEvidenceCollectorCheckpoint = (
  value: unknown,
): EvidenceCollectorCheckpoint | undefined => {
  if (
    !isRecord(value) ||
    value.schemaVersion !== EVIDENCE_COLLECTOR_CHECKPOINT_SCHEMA_VERSION ||
    value.liveOrderExecutionAllowed !== false ||
    typeof value.evaluationId !== 'string' || value.evaluationId.trim().length === 0 ||
    !safeTs(value.firstStartedAt) || !safeTs(value.targetEndAt) ||
    value.targetEndAt !== value.firstStartedAt + THIRTY_DAYS_MS ||
    !safeTs(value.lastStartedAt) || !safeTs(value.lastHeartbeatAt) ||
    (value.lastCleanStopAt !== null && !safeTs(value.lastCleanStopAt)) ||
    typeof value.sessionSequence !== 'number' || !Number.isSafeInteger(value.sessionSequence) || value.sessionSequence <= 0 ||
    typeof value.completed !== 'boolean'
  ) return undefined;
  return Object.freeze({
    schemaVersion: EVIDENCE_COLLECTOR_CHECKPOINT_SCHEMA_VERSION,
    evaluationId: value.evaluationId.trim(),
    firstStartedAt: value.firstStartedAt,
    targetEndAt: value.targetEndAt,
    lastStartedAt: value.lastStartedAt,
    lastHeartbeatAt: value.lastHeartbeatAt,
    lastCleanStopAt: value.lastCleanStopAt,
    sessionSequence: value.sessionSequence,
    completed: value.completed,
    liveOrderExecutionAllowed: false,
  });
};

export class EvidenceCollectorCheckpointStore {
  private checkpoint?: EvidenceCollectorCheckpoint;
  public constructor(
    private readonly evaluationDirectory: string,
    private readonly evaluationId: string,
    private readonly gapStore?: EvidenceCoverageGapStore,
  ) {}

  private get filePath(): string { return join(this.evaluationDirectory, 'collector-checkpoint.json'); }

  public async initialize(now: number): Promise<EvidenceCollectorCheckpoint> {
    let existing: EvidenceCollectorCheckpoint | undefined;
    try {
      existing = parseEvidenceCollectorCheckpoint(
        JSON.parse(await readFile(this.filePath, 'utf8')) as unknown,
      );
      if (existing === undefined) throw new Error('collector-checkpoint.json is invalid');
    } catch (error: unknown) {
      if (!isErrorWithCode(error, 'ENOENT')) throw error;
    }

    if (existing === undefined) {
      this.checkpoint = Object.freeze({
        schemaVersion: EVIDENCE_COLLECTOR_CHECKPOINT_SCHEMA_VERSION,
        evaluationId: this.evaluationId,
        firstStartedAt: now,
        targetEndAt: now + THIRTY_DAYS_MS,
        lastStartedAt: now,
        lastHeartbeatAt: now,
        lastCleanStopAt: null,
        sessionSequence: 1,
        completed: false,
        liveOrderExecutionAllowed: false,
      });
    } else {
      if (existing.evaluationId !== this.evaluationId) throw new Error('Collector checkpoint evaluation ID mismatch');
      const downtimeStartedAt = existing.lastCleanStopAt ?? existing.lastHeartbeatAt;
      if (!existing.completed && now > downtimeStartedAt) {
        await this.gapStore?.record({
          gapId: `downtime:${existing.sessionSequence}:${downtimeStartedAt}:${now}`,
          evaluationId: this.evaluationId,
          kind: 'PROCESS_DOWNTIME',
          startedAt: downtimeStartedAt,
          endedAt: now,
          instrumentIds: [],
          alertIds: [],
          reason: existing.lastCleanStopAt === null
            ? 'COLLECTOR_PROCESS_NOT_RUNNING_UNEXPECTEDLY'
            : 'COLLECTOR_INTENTIONALLY_STOPPED',
          source: 'LIVE',
          recordedAt: now,
        });
      }
      this.checkpoint = Object.freeze({
        ...existing,
        lastStartedAt: now,
        lastHeartbeatAt: now,
        lastCleanStopAt: null,
        sessionSequence: existing.sessionSequence + 1,
        completed: existing.completed,
      });
    }
    await this.persist();
    return this.get();
  }

  public get(): EvidenceCollectorCheckpoint {
    if (this.checkpoint === undefined) throw new Error('Collector checkpoint is not initialized');
    return this.checkpoint;
  }

  public async heartbeat(now: number): Promise<void> {
    const current = this.get();
    if (now < current.lastHeartbeatAt) throw new Error('Collector checkpoint clock cannot move backwards');
    this.checkpoint = Object.freeze({ ...current, lastHeartbeatAt: now });
    await this.persist();
  }

  public async markCompleted(now: number): Promise<void> {
    const current = this.get();
    if (now < current.targetEndAt) throw new Error('Cannot complete the collector checkpoint before the target end');
    this.checkpoint = Object.freeze({ ...current, lastHeartbeatAt: Math.max(now, current.lastHeartbeatAt), lastCleanStopAt: now, completed: true });
    await this.persist();
  }

  public async cleanStop(now: number): Promise<void> {
    const current = this.get();
    this.checkpoint = Object.freeze({ ...current, lastHeartbeatAt: Math.max(now, current.lastHeartbeatAt), lastCleanStopAt: now });
    await this.persist();
  }

  private async persist(): Promise<void> {
    await writeEvidenceJsonAtomically(this.filePath, this.get());
  }
}
