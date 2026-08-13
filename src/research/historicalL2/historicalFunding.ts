import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { createGunzip } from 'node:zlib';

export interface HistoricalFundingRecord {
  readonly instrumentId: string;
  readonly fundingTime: number;
  /** Decimal rate, e.g. 0.0001 = 1 bp. */
  readonly fundingRate: number;
}

const parseSafeInteger = (value: unknown): number | undefined => {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const parseFinite = (value: unknown): number | undefined => {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseFundingRecord = (value: unknown): HistoricalFundingRecord | undefined => {
  if (!isRecord(value)) return undefined;
  const instrumentId =
    typeof (value.instId ?? value.instrumentId ?? value.instrument) === 'string'
      ? String(value.instId ?? value.instrumentId ?? value.instrument).trim()
      : '';
  const fundingTime = parseSafeInteger(
    value.fundingTime ?? value.funding_time ?? value.ts ?? value.timestamp,
  );
  const fundingRate = parseFinite(value.fundingRate ?? value.funding_rate ?? value.rate);
  if (instrumentId.length === 0 || fundingTime === undefined || fundingRate === undefined) {
    return undefined;
  }
  return Object.freeze({ instrumentId, fundingTime, fundingRate });
};

const splitCsv = (line: string): string[] => {
  const result: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (quoted) throw new Error('Unterminated CSV quote');
  result.push(current);
  return result;
};

const createLineReader = (filePath: string) => {
  const raw = createReadStream(filePath);
  const input = filePath.toLowerCase().endsWith('.gz') ? raw.pipe(createGunzip()) : raw;
  return createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
};

/**
 * Reads an explicit funding companion file. Supported normalized columns are
 * instId/instrumentId, fundingTime/timestamp and fundingRate. A malformed row
 * fails the replay instead of silently dropping funding evidence.
 */
export const loadHistoricalFundingFile = async (
  inputPath: string,
): Promise<readonly HistoricalFundingRecord[]> => {
  const filePath = resolve(inputPath);
  const lower = filePath.toLowerCase().replace(/\.gz$/u, '');
  const csv = lower.endsWith('.csv');
  if (!csv && !lower.endsWith('.ndjson') && !lower.endsWith('.jsonl')) {
    throw new Error('Historical funding companion must be CSV, NDJSON or JSONL (optionally .gz)');
  }

  const records: HistoricalFundingRecord[] = [];
  let header: string[] | undefined;
  let lineNumber = 0;
  for await (const rawLine of createLineReader(filePath)) {
    lineNumber += 1;
    const line = rawLine.trim();
    if (line.length === 0) continue;
    try {
      let raw: unknown;
      if (csv) {
        if (header === undefined) {
          header = splitCsv(line).map((value) => value.trim());
          continue;
        }
        const values = splitCsv(line);
        if (values.length !== header.length) throw new Error('CSV column count mismatch');
        raw = Object.fromEntries(header.map((name, index) => [name, values[index]]));
      } else {
        raw = JSON.parse(line) as unknown;
      }
      const parsed = parseFundingRecord(raw);
      if (parsed === undefined) {
        throw new Error('Funding row requires explicit instrument, funding timestamp and finite funding rate');
      }
      records.push(parsed);
    } catch (error: unknown) {
      throw new Error(
        `Historical funding parse failure at ${filePath}:${lineNumber}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  records.sort(
    (left, right) =>
      left.instrumentId.localeCompare(right.instrumentId) ||
      left.fundingTime - right.fundingTime,
  );
  return Object.freeze(records);
};

export class HistoricalFundingIndex {
  private readonly byInstrument = new Map<string, readonly HistoricalFundingRecord[]>();

  public constructor(records: readonly HistoricalFundingRecord[]) {
    const mutable = new Map<string, HistoricalFundingRecord[]>();
    for (const record of records) {
      const group = mutable.get(record.instrumentId) ?? [];
      group.push(record);
      mutable.set(record.instrumentId, group);
    }
    for (const [instrumentId, group] of mutable.entries()) {
      this.byInstrument.set(
        instrumentId,
        Object.freeze([...group].sort((left, right) => left.fundingTime - right.fundingTime)),
      );
    }
  }

  /** Sum of decimal funding rates strictly after entry and through exit. */
  public sumRates(instrumentId: string, entryAt: number, exitAt: number): number {
    const rows = this.byInstrument.get(instrumentId) ?? [];
    let total = 0;
    for (const row of rows) {
      if (row.fundingTime <= entryAt) continue;
      if (row.fundingTime > exitAt) break;
      total += row.fundingRate;
    }
    return total;
  }

  public get recordCount(): number {
    let count = 0;
    for (const rows of this.byInstrument.values()) count += rows.length;
    return count;
  }
}
