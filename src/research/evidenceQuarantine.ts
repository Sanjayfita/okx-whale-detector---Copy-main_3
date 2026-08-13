import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isErrorWithCode } from '../core/errorGuards';
import { recoverTrailingPartialEvidenceLine } from './evidenceNdjson';

export const EVIDENCE_QUARANTINE_SCHEMA_VERSION = 1 as const;

export type EvidenceQuarantineReason =
  | 'OBSERVATION_WINDOW_MISSED'
  | 'POINT_IN_TIME_CONTEXT_UNAVAILABLE'
  | 'HISTORICAL_RANGE_ENDED'
  | 'COLLECTION_PERIOD_ENDED'
  | 'HISTORICAL_SOURCE_GAP'
  | 'DATA_SOURCE_UNAVAILABLE';

export interface QuarantinedEvidenceEpisode {
  readonly schemaVersion: typeof EVIDENCE_QUARANTINE_SCHEMA_VERSION;
  readonly evaluationId: string;
  readonly alertId: string;
  readonly instrumentId: string;
  readonly detectedAt: number;
  readonly quarantinedAt: number;
  readonly reason: EvidenceQuarantineReason;
  readonly failedHorizonMinutes?: number;
  readonly dueAt?: number;
  readonly gapStartAt?: number;
  readonly gapEndAt?: number;
  readonly details?: string;
  readonly acceptedForResearch: false;
  readonly liveOrderExecutionAllowed: false;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export const parseQuarantinedEvidenceEpisode = (
  value: unknown,
): QuarantinedEvidenceEpisode | undefined => {
  if (
    !isRecord(value) ||
    value.schemaVersion !== EVIDENCE_QUARANTINE_SCHEMA_VERSION ||
    value.acceptedForResearch !== false ||
    value.liveOrderExecutionAllowed !== false ||
    typeof value.evaluationId !== 'string' ||
    value.evaluationId.trim().length === 0 ||
    typeof value.alertId !== 'string' ||
    value.alertId.trim().length === 0 ||
    typeof value.instrumentId !== 'string' ||
    value.instrumentId.trim().length === 0 ||
    !isTimestamp(value.detectedAt) ||
    !isTimestamp(value.quarantinedAt) ||
    value.quarantinedAt < value.detectedAt ||
    (value.reason !== 'OBSERVATION_WINDOW_MISSED' &&
      value.reason !== 'POINT_IN_TIME_CONTEXT_UNAVAILABLE' &&
      value.reason !== 'HISTORICAL_RANGE_ENDED' &&
      value.reason !== 'COLLECTION_PERIOD_ENDED' &&
      value.reason !== 'HISTORICAL_SOURCE_GAP' &&
      value.reason !== 'DATA_SOURCE_UNAVAILABLE') ||
    (value.failedHorizonMinutes !== undefined &&
      (typeof value.failedHorizonMinutes !== 'number' ||
        !Number.isFinite(value.failedHorizonMinutes) ||
        value.failedHorizonMinutes <= 0)) ||
    (value.dueAt !== undefined && !isTimestamp(value.dueAt)) ||
    (value.gapStartAt !== undefined && !isTimestamp(value.gapStartAt)) ||
    (value.gapEndAt !== undefined && !isTimestamp(value.gapEndAt)) ||
    (value.gapStartAt !== undefined &&
      value.gapEndAt !== undefined &&
      value.gapEndAt < value.gapStartAt) ||
    (value.details !== undefined && typeof value.details !== 'string')
  ) {
    return undefined;
  }

  return Object.freeze({
    schemaVersion: EVIDENCE_QUARANTINE_SCHEMA_VERSION,
    evaluationId: value.evaluationId.trim(),
    alertId: value.alertId.trim(),
    instrumentId: value.instrumentId.trim(),
    detectedAt: value.detectedAt,
    quarantinedAt: value.quarantinedAt,
    reason: value.reason,
    ...(typeof value.failedHorizonMinutes === 'number'
      ? { failedHorizonMinutes: value.failedHorizonMinutes }
      : {}),
    ...(typeof value.dueAt === 'number' ? { dueAt: value.dueAt } : {}),
    ...(typeof value.gapStartAt === 'number'
      ? { gapStartAt: value.gapStartAt }
      : {}),
    ...(typeof value.gapEndAt === 'number' ? { gapEndAt: value.gapEndAt } : {}),
    ...(typeof value.details === 'string' && value.details.trim().length > 0
      ? { details: value.details.trim() }
      : {}),
    acceptedForResearch: false,
    liveOrderExecutionAllowed: false,
  });
};

export class EvidenceQuarantineStore {
  private readonly byAlertId = new Map<string, QuarantinedEvidenceEpisode>();
  private writeChain: Promise<void> = Promise.resolve();

  public constructor(private readonly evaluationDirectory: string) {}

  private get filePath(): string {
    return join(this.evaluationDirectory, 'quarantined-episodes.ndjson');
  }

  public async initialize(): Promise<void> {
    await recoverTrailingPartialEvidenceLine(
      this.filePath,
      parseQuarantinedEvidenceEpisode,
    );
    let text = '';
    try {
      text = await readFile(this.filePath, 'utf8');
    } catch (error: unknown) {
      if (!isErrorWithCode(error, 'ENOENT')) throw error;
      return;
    }
    this.byAlertId.clear();
    for (const line of text.split(/\r?\n/u)) {
      if (line.trim().length === 0) continue;
      const parsed = parseQuarantinedEvidenceEpisode(JSON.parse(line) as unknown);
      if (parsed === undefined) {
        throw new Error('quarantined-episodes.ndjson contains invalid evidence');
      }
      const existing = this.byAlertId.get(parsed.alertId);
      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(parsed)) {
        throw new Error(`Conflicting quarantine records for ${parsed.alertId}`);
      }
      this.byAlertId.set(parsed.alertId, parsed);
    }
  }

  public isQuarantined(alertId: string): boolean {
    return this.byAlertId.has(alertId);
  }

  public get(alertId: string): QuarantinedEvidenceEpisode | undefined {
    return this.byAlertId.get(alertId);
  }

  public getAll(): readonly QuarantinedEvidenceEpisode[] {
    return Object.freeze([...this.byAlertId.values()].sort((a, b) =>
      a.quarantinedAt - b.quarantinedAt || a.alertId.localeCompare(b.alertId),
    ));
  }

  public async quarantine(
    input: Omit<
      QuarantinedEvidenceEpisode,
      'schemaVersion' | 'acceptedForResearch' | 'liveOrderExecutionAllowed'
    >,
  ): Promise<QuarantinedEvidenceEpisode> {
    const record = parseQuarantinedEvidenceEpisode({
      ...input,
      schemaVersion: EVIDENCE_QUARANTINE_SCHEMA_VERSION,
      acceptedForResearch: false,
      liveOrderExecutionAllowed: false,
    });
    if (record === undefined) throw new Error('Invalid quarantine record');

    const existing = this.byAlertId.get(record.alertId);
    if (existing !== undefined) return existing;

    const operation = async (): Promise<void> => {
      const current = this.byAlertId.get(record.alertId);
      if (current !== undefined) return;
      await appendFile(this.filePath, `${JSON.stringify(record)}\n`, {
        encoding: 'utf8',
        flush: true,
      });
      this.byAlertId.set(record.alertId, record);
    };
    const next = this.writeChain.then(operation, operation);
    this.writeChain = next.catch(() => undefined);
    await next;
    return this.byAlertId.get(record.alertId) ?? record;
  }
}
