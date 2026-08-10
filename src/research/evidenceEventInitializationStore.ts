import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isErrorWithCode } from '../core/errorGuards';
import type { AlphaResearchEventSnapshot } from './alphaFeatureTypes';
import { parseAlphaResearchEventSnapshot } from './alphaSnapshotParser';
import { writeEvidenceJsonAtomically } from './evidenceAtomicFile';
import type { QualifiedAlertEvidenceRecord } from './qualifiedAlertEvidence';
import { parseQualifiedAlertEvidenceRecord } from './qualifiedAlertEvidence';

export interface PendingEvidenceEventInitialization {
  readonly alertId: string;
  readonly evidence: QualifiedAlertEvidenceRecord;
  readonly snapshot: AlphaResearchEventSnapshot;
  readonly startedAt: number;
}

interface EvidenceEventInitializationState {
  readonly schemaVersion: 1;
  readonly pending: readonly PendingEvidenceEventInitialization[];
  readonly committedAlertIds: readonly string[];
  readonly liveOrderExecutionAllowed: false;
}

const emptyState = (): EvidenceEventInitializationState => ({
  schemaVersion: 1,
  pending: [],
  committedAlertIds: [],
  liveOrderExecutionAllowed: false,
});

export class EvidenceEventInitializationStore {
  private readonly statePath: string;
  private state: EvidenceEventInitializationState = emptyState();
  private writeChain: Promise<void> = Promise.resolve();

  public constructor(evaluationDirectory: string) {
    this.statePath = join(evaluationDirectory, 'event-initializations.json');
  }

  public async initialize(): Promise<void> {
    let value: unknown;
    try {
      value = JSON.parse(await readFile(this.statePath, 'utf8')) as unknown;
    } catch (error: unknown) {
      if (!isErrorWithCode(error, 'ENOENT')) throw error;
      await this.persist(emptyState());
      return;
    }
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      !('schemaVersion' in value) ||
      value.schemaVersion !== 1 ||
      !('pending' in value) ||
      !Array.isArray(value.pending) ||
      !('committedAlertIds' in value) ||
      !Array.isArray(value.committedAlertIds) ||
      value.committedAlertIds.some(
        (alertId) => typeof alertId !== 'string' || alertId.trim().length === 0,
      ) ||
      new Set(value.committedAlertIds).size !==
        value.committedAlertIds.length ||
      !('liveOrderExecutionAllowed' in value) ||
      value.liveOrderExecutionAllowed !== false
    ) {
      throw new Error('Event initialization state is invalid');
    }
    const pending = value.pending.map((entry: unknown) =>
      this.parsePending(entry),
    );
    const pendingIds = new Set(pending.map((entry) => entry.alertId));
    if (
      pendingIds.size !== pending.length ||
      value.committedAlertIds.some((alertId) => pendingIds.has(alertId))
    ) {
      throw new Error('Event initialization identities are inconsistent');
    }
    this.state = Object.freeze({
      schemaVersion: 1,
      pending: Object.freeze(pending),
      committedAlertIds: Object.freeze([...value.committedAlertIds]),
      liveOrderExecutionAllowed: false,
    });
  }

  public getPending(): readonly PendingEvidenceEventInitialization[] {
    return Object.freeze([...this.state.pending]);
  }

  public isCommitted(alertId: string): boolean {
    return this.state.committedAlertIds.includes(alertId);
  }

  public async begin(
    evidence: QualifiedAlertEvidenceRecord,
    snapshot: AlphaResearchEventSnapshot,
    startedAt: number,
  ): Promise<boolean> {
    const parsedEvidence = parseQualifiedAlertEvidenceRecord(evidence);
    const parsedSnapshot = parseAlphaResearchEventSnapshot(snapshot);
    if (
      parsedEvidence === undefined ||
      parsedSnapshot === undefined ||
      parsedSnapshot.evidence.alertId !== parsedEvidence.alertId ||
      JSON.stringify(parsedSnapshot.evidence) !==
        JSON.stringify(parsedEvidence) ||
      !Number.isSafeInteger(startedAt) ||
      startedAt < parsedEvidence.detectedAt
    ) {
      throw new Error('Event initialization candidate is invalid');
    }
    let created = false;
    await this.enqueue(async () => {
      if (this.isCommitted(parsedEvidence.alertId)) return;
      const existing = this.state.pending.find(
        (entry) => entry.alertId === parsedEvidence.alertId,
      );
      if (existing !== undefined) {
        if (
          JSON.stringify(existing.evidence) !==
            JSON.stringify(parsedEvidence) ||
          JSON.stringify(existing.snapshot) !== JSON.stringify(parsedSnapshot)
        ) {
          throw new Error('Conflicting pending event initialization');
        }
        return;
      }
      created = true;
      await this.persist({
        ...this.state,
        pending: [
          ...this.state.pending,
          Object.freeze({
            alertId: parsedEvidence.alertId,
            evidence: parsedEvidence,
            snapshot: parsedSnapshot,
            startedAt,
          }),
        ],
      });
    });
    return created;
  }

  public async commit(alertId: string): Promise<void> {
    await this.enqueue(async () => {
      if (this.isCommitted(alertId)) return;
      if (!this.state.pending.some((entry) => entry.alertId === alertId)) {
        throw new Error('Cannot commit an unknown event initialization');
      }
      await this.persist({
        ...this.state,
        pending: this.state.pending.filter(
          (entry) => entry.alertId !== alertId,
        ),
        committedAlertIds: [...this.state.committedAlertIds, alertId],
      });
    });
  }

  private parsePending(value: unknown): PendingEvidenceEventInitialization {
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      !('alertId' in value) ||
      typeof value.alertId !== 'string' ||
      !('startedAt' in value) ||
      typeof value.startedAt !== 'number' ||
      !Number.isSafeInteger(value.startedAt) ||
      !('evidence' in value) ||
      !('snapshot' in value)
    ) {
      throw new Error('Pending event initialization is invalid');
    }
    const evidence = parseQualifiedAlertEvidenceRecord(value.evidence);
    const snapshot = parseAlphaResearchEventSnapshot(value.snapshot);
    if (
      evidence === undefined ||
      snapshot === undefined ||
      value.alertId !== evidence.alertId ||
      JSON.stringify(snapshot.evidence) !== JSON.stringify(evidence)
    ) {
      throw new Error('Pending event initialization payload is invalid');
    }
    return Object.freeze({
      alertId: value.alertId,
      evidence,
      snapshot,
      startedAt: value.startedAt,
    });
  }

  private async persist(
    state: EvidenceEventInitializationState,
  ): Promise<void> {
    const normalized = Object.freeze({
      schemaVersion: 1 as const,
      pending: Object.freeze([...state.pending]),
      committedAlertIds: Object.freeze([...state.committedAlertIds]),
      liveOrderExecutionAllowed: false as const,
    });
    await writeEvidenceJsonAtomically(this.statePath, normalized);
    this.state = normalized;
  }

  private async enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.writeChain.then(operation, operation);
    this.writeChain = next.catch(() => undefined);
    await next;
  }
}
