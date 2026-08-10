import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isErrorWithCode } from '../core/errorGuards';
import { writeEvidenceJsonAtomically } from './evidenceAtomicFile';

export interface EvidenceCollectionFailureRecord {
  readonly schemaVersion: 1;
  readonly evaluationId: string;
  readonly failedAt: number;
  readonly category: string;
  readonly message: string;
  readonly alertId: string | null;
  readonly instrumentId: string | null;
  readonly liveOrderExecutionAllowed: false;
}

export class EvidenceCollectionHealthStore {
  private readonly healthPath: string;
  private readonly failuresPath: string;
  private unhealthy = false;
  private writeChain: Promise<void> = Promise.resolve();

  public constructor(
    evaluationDirectory: string,
    private readonly evaluationId: string,
  ) {
    this.healthPath = join(evaluationDirectory, 'collection-health.json');
    this.failuresPath = join(evaluationDirectory, 'evidence-failures.ndjson');
  }

  public async initialize(): Promise<void> {
    try {
      const value = JSON.parse(await readFile(this.healthPath, 'utf8')) as {
        status?: unknown;
      };
      if (value.status !== 'HEALTHY' && value.status !== 'UNHEALTHY') {
        throw new Error('Collection health state is invalid');
      }
      this.unhealthy = value.status === 'UNHEALTHY';
    } catch (error: unknown) {
      if (!isErrorWithCode(error, 'ENOENT')) throw error;
      await this.persistHealth('HEALTHY', Date.now(), null);
    }
  }

  public isUnhealthy(): boolean {
    return this.unhealthy;
  }

  public async fail(input: {
    failedAt: number;
    category: string;
    message: string;
    alertId?: string;
    instrumentId?: string;
  }): Promise<void> {
    await this.enqueue(async () => {
      const failure: EvidenceCollectionFailureRecord = Object.freeze({
        schemaVersion: 1,
        evaluationId: this.evaluationId,
        failedAt: input.failedAt,
        category: input.category,
        message: input.message,
        alertId: input.alertId ?? null,
        instrumentId: input.instrumentId ?? null,
        liveOrderExecutionAllowed: false,
      });
      await appendFile(this.failuresPath, `${JSON.stringify(failure)}\n`, {
        encoding: 'utf8',
        flush: true,
      });
      await this.persistHealth('UNHEALTHY', input.failedAt, failure);
      this.unhealthy = true;
    });
  }

  private async persistHealth(
    status: 'HEALTHY' | 'UNHEALTHY',
    updatedAt: number,
    lastFailure: EvidenceCollectionFailureRecord | null,
  ): Promise<void> {
    await writeEvidenceJsonAtomically(this.healthPath, {
      schemaVersion: 1,
      evaluationId: this.evaluationId,
      status,
      updatedAt,
      lastFailure,
      liveOrderExecutionAllowed: false,
    });
  }

  private async enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.writeChain.then(operation, operation);
    this.writeChain = next.catch(() => undefined);
    await next;
  }
}
