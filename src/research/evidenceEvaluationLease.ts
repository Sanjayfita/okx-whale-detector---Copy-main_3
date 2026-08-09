import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';

import { isErrorWithCode } from '../core/errorGuards';

export const EVIDENCE_EVALUATION_LEASE_SCHEMA_VERSION = 1 as const;

export type EvidenceEvaluationLeasePurpose = 'COLLECTION' | 'FINALIZATION';

export interface EvidenceEvaluationLeaseRecord {
  readonly schemaVersion: typeof EVIDENCE_EVALUATION_LEASE_SCHEMA_VERSION;
  readonly leaseId: string;
  readonly evaluationId: string;
  readonly sourceCommit: string;
  readonly configurationFingerprint: string;
  readonly purpose: EvidenceEvaluationLeasePurpose;
  readonly host: string;
  readonly processId: number;
  readonly acquiredAt: number;
  readonly liveOrderExecutionAllowed: false;
}

export interface EvidenceEvaluationLeaseOptions {
  readonly evaluationDirectory: string;
  readonly evaluationId: string;
  readonly sourceCommit: string;
  readonly configurationFingerprint: string;
  readonly purpose: EvidenceEvaluationLeasePurpose;
  readonly clock?: () => number;
  readonly processId?: number;
  readonly host?: string;
  readonly leaseIdFactory?: () => string;
  readonly isProcessAlive?: (processId: number) => boolean;
}

export interface EvidenceEvaluationLeaseLike {
  acquire(): Promise<unknown>;
  release(): Promise<void>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPurpose = (value: unknown): value is EvidenceEvaluationLeasePurpose =>
  value === 'COLLECTION' || value === 'FINALIZATION';

export const parseEvidenceEvaluationLeaseRecord = (
  value: unknown,
): EvidenceEvaluationLeaseRecord | undefined => {
  if (
    !isRecord(value) ||
    value.schemaVersion !== EVIDENCE_EVALUATION_LEASE_SCHEMA_VERSION ||
    typeof value.leaseId !== 'string' ||
    !/^[a-zA-Z0-9-]{8,128}$/u.test(value.leaseId) ||
    typeof value.evaluationId !== 'string' ||
    value.evaluationId.trim().length === 0 ||
    typeof value.sourceCommit !== 'string' ||
    value.sourceCommit.trim().length === 0 ||
    typeof value.configurationFingerprint !== 'string' ||
    value.configurationFingerprint.trim().length === 0 ||
    !isPurpose(value.purpose) ||
    typeof value.host !== 'string' ||
    value.host.trim().length === 0 ||
    typeof value.processId !== 'number' ||
    !Number.isSafeInteger(value.processId) ||
    value.processId <= 0 ||
    typeof value.acquiredAt !== 'number' ||
    !Number.isSafeInteger(value.acquiredAt) ||
    value.acquiredAt < 0 ||
    value.liveOrderExecutionAllowed !== false
  ) {
    return undefined;
  }
  return Object.freeze({
    schemaVersion: EVIDENCE_EVALUATION_LEASE_SCHEMA_VERSION,
    leaseId: value.leaseId,
    evaluationId: value.evaluationId,
    sourceCommit: value.sourceCommit,
    configurationFingerprint: value.configurationFingerprint,
    purpose: value.purpose,
    host: value.host,
    processId: value.processId,
    acquiredAt: value.acquiredAt,
    liveOrderExecutionAllowed: false,
  });
};

const defaultIsProcessAlive = (processId: number): boolean => {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error: unknown) {
    return !isErrorWithCode(error, 'ESRCH');
  }
};

export class EvidenceEvaluationLease implements EvidenceEvaluationLeaseLike {
  private readonly lockPath: string;
  private readonly historyDirectory: string;
  private readonly clock: () => number;
  private readonly processId: number;
  private readonly host: string;
  private readonly leaseIdFactory: () => string;
  private readonly isProcessAlive: (processId: number) => boolean;
  private active?: EvidenceEvaluationLeaseRecord;

  public constructor(private readonly options: EvidenceEvaluationLeaseOptions) {
    this.lockPath = join(options.evaluationDirectory, 'evaluation.lock');
    this.historyDirectory = join(options.evaluationDirectory, 'lease-history');
    this.clock = options.clock ?? Date.now;
    this.processId = options.processId ?? process.pid;
    this.host = options.host ?? hostname();
    this.leaseIdFactory = options.leaseIdFactory ?? randomUUID;
    this.isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  }

  public async acquire(): Promise<EvidenceEvaluationLeaseRecord> {
    if (this.active !== undefined) {
      throw new Error('Evidence evaluation lease is already active');
    }
    const acquiredAt = this.clock();
    if (!Number.isSafeInteger(acquiredAt) || acquiredAt < 0) {
      throw new Error('Evidence evaluation lease clock is invalid');
    }
    const record = parseEvidenceEvaluationLeaseRecord({
      schemaVersion: EVIDENCE_EVALUATION_LEASE_SCHEMA_VERSION,
      leaseId: this.leaseIdFactory(),
      evaluationId: this.options.evaluationId,
      sourceCommit: this.options.sourceCommit,
      configurationFingerprint: this.options.configurationFingerprint,
      purpose: this.options.purpose,
      host: this.host,
      processId: this.processId,
      acquiredAt,
      liveOrderExecutionAllowed: false,
    });
    if (record === undefined) {
      throw new Error('Evidence evaluation lease identity is invalid');
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const file = await open(this.lockPath, 'wx');
        try {
          await file.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
          await file.sync();
        } finally {
          await file.close();
        }
        this.active = record;
        return record;
      } catch (error: unknown) {
        if (!isErrorWithCode(error, 'EEXIST')) throw error;
        const recovered = await this.archiveStaleLease();
        if (!recovered) {
          throw new Error('Another process owns this evidence evaluation');
        }
      }
    }
    throw new Error('Unable to acquire evidence evaluation lease');
  }

  public async release(): Promise<void> {
    const active = this.active;
    if (active === undefined) return;
    const persisted = parseEvidenceEvaluationLeaseRecord(
      JSON.parse(await readFile(this.lockPath, 'utf8')) as unknown,
    );
    if (persisted?.leaseId !== active.leaseId) {
      throw new Error('Evidence evaluation lease ownership changed');
    }
    await unlink(this.lockPath);
    this.active = undefined;
  }

  private async archiveStaleLease(): Promise<boolean> {
    let persisted: EvidenceEvaluationLeaseRecord | undefined;
    try {
      persisted = parseEvidenceEvaluationLeaseRecord(
        JSON.parse(await readFile(this.lockPath, 'utf8')) as unknown,
      );
    } catch (error: unknown) {
      if (isErrorWithCode(error, 'ENOENT')) return true;
      throw new Error('Existing evidence evaluation lease is unreadable', {
        cause: error,
      });
    }
    if (
      persisted === undefined ||
      persisted.evaluationId !== this.options.evaluationId ||
      persisted.sourceCommit !== this.options.sourceCommit ||
      persisted.configurationFingerprint !==
        this.options.configurationFingerprint ||
      persisted.host !== this.host ||
      this.isProcessAlive(persisted.processId)
    ) {
      return false;
    }
    await mkdir(this.historyDirectory, { recursive: true });
    try {
      await rename(
        this.lockPath,
        join(this.historyDirectory, `${persisted.leaseId}.stale.json`),
      );
      return true;
    } catch (error: unknown) {
      if (isErrorWithCode(error, 'ENOENT')) return true;
      throw error;
    }
  }
}
