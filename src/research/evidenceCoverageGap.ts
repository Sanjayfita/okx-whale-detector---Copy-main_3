import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isErrorWithCode } from '../core/errorGuards';
import { recoverTrailingPartialEvidenceLine } from './evidenceNdjson';

export const EVIDENCE_COVERAGE_GAP_SCHEMA_VERSION = 1 as const;

export type EvidenceCoverageGapKind =
  | 'OBSERVATION_UNAVAILABLE'
  | 'PROCESS_DOWNTIME'
  | 'MARKET_DATA_GAP'
  | 'HISTORICAL_SOURCE_GAP';

export interface EvidenceCoverageGap {
  readonly schemaVersion: typeof EVIDENCE_COVERAGE_GAP_SCHEMA_VERSION;
  readonly gapId: string;
  readonly evaluationId: string;
  readonly kind: EvidenceCoverageGapKind;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs: number;
  readonly instrumentIds: readonly string[];
  readonly alertIds: readonly string[];
  readonly reason: string;
  readonly source: 'LIVE' | 'HISTORICAL_REPLAY';
  readonly recordedAt: number;
  readonly liveOrderExecutionAllowed: false;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const timestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim().length > 0);

export const parseEvidenceCoverageGap = (
  value: unknown,
): EvidenceCoverageGap | undefined => {
  if (
    !isRecord(value) ||
    value.schemaVersion !== EVIDENCE_COVERAGE_GAP_SCHEMA_VERSION ||
    value.liveOrderExecutionAllowed !== false ||
    typeof value.gapId !== 'string' ||
    value.gapId.trim().length === 0 ||
    typeof value.evaluationId !== 'string' ||
    value.evaluationId.trim().length === 0 ||
    (value.kind !== 'OBSERVATION_UNAVAILABLE' &&
      value.kind !== 'PROCESS_DOWNTIME' &&
      value.kind !== 'MARKET_DATA_GAP' &&
      value.kind !== 'HISTORICAL_SOURCE_GAP') ||
    !timestamp(value.startedAt) ||
    !timestamp(value.endedAt) ||
    value.endedAt < value.startedAt ||
    typeof value.durationMs !== 'number' ||
    value.durationMs !== value.endedAt - value.startedAt ||
    !strings(value.instrumentIds) ||
    !strings(value.alertIds) ||
    typeof value.reason !== 'string' ||
    value.reason.trim().length === 0 ||
    (value.source !== 'LIVE' && value.source !== 'HISTORICAL_REPLAY') ||
    !timestamp(value.recordedAt)
  ) return undefined;

  return Object.freeze({
    schemaVersion: EVIDENCE_COVERAGE_GAP_SCHEMA_VERSION,
    gapId: value.gapId.trim(),
    evaluationId: value.evaluationId.trim(),
    kind: value.kind,
    startedAt: value.startedAt,
    endedAt: value.endedAt,
    durationMs: value.durationMs,
    instrumentIds: Object.freeze([...new Set(value.instrumentIds)].sort()),
    alertIds: Object.freeze([...new Set(value.alertIds)].sort()),
    reason: value.reason.trim(),
    source: value.source,
    recordedAt: value.recordedAt,
    liveOrderExecutionAllowed: false,
  });
};

export class EvidenceCoverageGapStore {
  private readonly byGapId = new Map<string, EvidenceCoverageGap>();
  private writeChain: Promise<void> = Promise.resolve();

  public constructor(private readonly evaluationDirectory: string) {}

  private get filePath(): string {
    return join(this.evaluationDirectory, 'coverage-gaps.ndjson');
  }

  public async initialize(): Promise<void> {
    await recoverTrailingPartialEvidenceLine(this.filePath, parseEvidenceCoverageGap);
    let text = '';
    try {
      text = await readFile(this.filePath, 'utf8');
    } catch (error: unknown) {
      if (!isErrorWithCode(error, 'ENOENT')) throw error;
      return;
    }
    this.byGapId.clear();
    for (const line of text.split(/\r?\n/u)) {
      if (line.trim().length === 0) continue;
      const parsed = parseEvidenceCoverageGap(JSON.parse(line) as unknown);
      if (parsed === undefined) throw new Error('coverage-gaps.ndjson contains invalid evidence');
      const existing = this.byGapId.get(parsed.gapId);
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(parsed)) {
          throw new Error(`Conflicting coverage gap ${parsed.gapId}`);
        }
        throw new Error(`Duplicate coverage gap ${parsed.gapId}`);
      }
      this.byGapId.set(parsed.gapId, parsed);
    }
  }

  public async record(
    input: Omit<
      EvidenceCoverageGap,
      'schemaVersion' | 'durationMs' | 'liveOrderExecutionAllowed'
    >,
  ): Promise<void> {
    const record = parseEvidenceCoverageGap({
      ...input,
      schemaVersion: EVIDENCE_COVERAGE_GAP_SCHEMA_VERSION,
      durationMs: input.endedAt - input.startedAt,
      liveOrderExecutionAllowed: false,
    });
    if (record === undefined) throw new Error('Invalid coverage-gap record');

    const existing = this.byGapId.get(record.gapId);
    if (existing !== undefined) {
      if (JSON.stringify(existing) !== JSON.stringify(record)) {
        throw new Error(`Conflicting coverage gap ${record.gapId}`);
      }
      return;
    }

    const operation = async (): Promise<void> => {
      const current = this.byGapId.get(record.gapId);
      if (current !== undefined) {
        if (JSON.stringify(current) !== JSON.stringify(record)) {
          throw new Error(`Conflicting coverage gap ${record.gapId}`);
        }
        return;
      }
      await appendFile(this.filePath, `${JSON.stringify(record)}\n`, {
        encoding: 'utf8',
        flush: true,
      });
      this.byGapId.set(record.gapId, record);
    };
    const next = this.writeChain.then(operation, operation);
    this.writeChain = next.catch(() => undefined);
    await next;
  }
}

