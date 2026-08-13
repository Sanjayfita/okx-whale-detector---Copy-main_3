import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

import type { OKXOrderBookUpdate } from '../../clients/okx/OKXWebSocketClient';
import { isOrderBookLevel } from '../../clients/okx/okxValidation';

export interface HistoricalL2Record {
  readonly update: OKXOrderBookUpdate;
  readonly sourceFile: string;
  readonly sourceLine: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseSafeInteger = (value: unknown): number | undefined => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isSafeInteger(number) ? number : undefined;
};

const parseLevels = (value: unknown): OKXOrderBookUpdate['bids'] | undefined =>
  Array.isArray(value) && value.every(isOrderBookLevel)
    ? value.map((level) => [level[0], level[1], level[2], level[3]])
    : undefined;

const parseOne = (
  value: unknown,
  inherited?: Readonly<{ instId?: string; action?: 'snapshot' | 'update' }>,
): readonly OKXOrderBookUpdate[] => {
  if (!isRecord(value)) return Object.freeze([]);

  if (isRecord(value.arg) && Array.isArray(value.data)) {
    const channel = value.arg.channel;
    if (typeof channel === 'string' && !channel.toLowerCase().includes('book')) {
      return Object.freeze([]);
    }
    const instId = typeof value.arg.instId === 'string' ? value.arg.instId : inherited?.instId;
    const action = value.action === 'snapshot' || value.action === 'update' ? value.action : inherited?.action;
    if (!instId || !action) throw new Error('Historical OKX envelope is missing explicit instId/action');
    return Object.freeze(value.data.flatMap((item) => parseOne(item, { instId, action })));
  }

  const instId = typeof value.instId === 'string' ? value.instId.trim() : inherited?.instId;
  const action = value.action === 'snapshot' || value.action === 'update' ? value.action : inherited?.action;
  const asks = parseLevels(value.asks);
  const bids = parseLevels(value.bids);
  const timestamp = parseSafeInteger(value.ts ?? value.timestamp);
  const seqId = parseSafeInteger(value.seqId);
  const prevSeqId = parseSafeInteger(value.prevSeqId);

  if (!instId || !action || !asks || !bids || timestamp === undefined || seqId === undefined || prevSeqId === undefined) {
    throw new Error('Historical L2 record requires explicit instId, action, asks, bids, ts, seqId and prevSeqId');
  }
  return Object.freeze([{ instId, action, asks, bids, timestamp, seqId, prevSeqId }]);
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
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      result.push(current);
      current = '';
    } else current += char;
  }
  if (quoted) throw new Error('Unterminated CSV quote');
  result.push(current);
  return result;
};

const parseCsvRow = (header: readonly string[], line: string): unknown => {
  const fields = splitCsv(line);
  if (fields.length !== header.length) throw new Error('Historical CSV row column count does not match header');
  const row = Object.fromEntries(header.map((name, index) => [name, fields[index]]));
  const asksText = row.asks ?? row.ask ?? row.asksJson;
  const bidsText = row.bids ?? row.bid ?? row.bidsJson;
  if (typeof asksText !== 'string' || typeof bidsText !== 'string') {
    throw new Error('Historical CSV must expose explicit JSON asks and bids columns; lower-quality reconstruction is refused');
  }
  return {
    instId: row.instId ?? row.inst_id ?? row.instrument,
    action: row.action,
    ts: row.ts ?? row.timestamp,
    seqId: row.seqId ?? row.seq_id,
    prevSeqId: row.prevSeqId ?? row.prev_seq_id,
    asks: JSON.parse(asksText) as unknown,
    bids: JSON.parse(bidsText) as unknown,
  };
};

const lineStream = (filePath: string) => {
  const raw = createReadStream(filePath);
  const input = filePath.toLowerCase().endsWith('.gz') ? raw.pipe(createGunzip()) : raw;
  return createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
};

export async function* readHistoricalL2File(filePath: string): AsyncGenerator<HistoricalL2Record> {
  const lower = filePath.toLowerCase().replace(/\.gz$/u, '');
  const csv = lower.endsWith('.csv');
  const jsonLines = lower.endsWith('.ndjson') || lower.endsWith('.jsonl') || lower.endsWith('.json');
  if (!csv && !jsonLines) throw new Error(`Unsupported historical archive file: ${filePath}`);

  let header: string[] | undefined;
  let lineNumber = 0;
  for await (const rawLine of lineStream(filePath)) {
    lineNumber += 1;
    const line = rawLine.trim();
    if (line.length === 0) continue;
    try {
      if (csv && header === undefined) {
        header = splitCsv(line).map((value) => value.trim());
        continue;
      }
      const value = csv ? parseCsvRow(header ?? [], line) : JSON.parse(line) as unknown;
      const updates = parseOne(value);
      for (const update of updates) {
        yield Object.freeze({ update, sourceFile: filePath, sourceLine: lineNumber });
      }
    } catch (error: unknown) {
      throw new Error(
        `Historical L2 parse failure at ${filePath}:${lineNumber}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
}

const supportedFile = (name: string): boolean => {
  const lower = name.toLowerCase();
  return ['.ndjson', '.jsonl', '.json', '.csv'].some((suffix) => lower.endsWith(suffix) || lower.endsWith(`${suffix}.gz`));
};

export const discoverHistoricalL2Files = async (inputPath: string): Promise<readonly string[]> => {
  const root = resolve(inputPath);
  const files: string[] = [];
  const visit = async (path: string): Promise<void> => {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile() && supportedFile(entry.name)) files.push(child);
    }
  };
  try {
    const extension = extname(root);
    if (extension || root.toLowerCase().endsWith('.gz')) {
      if (!supportedFile(root)) throw new Error(`Unsupported archive extension: ${root}`);
      files.push(root);
    } else await visit(root);
  } catch (error: unknown) {
    throw new Error(`Unable to discover historical L2 files under ${root}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (files.length === 0) throw new Error(`No supported historical L2 files found under ${root}`);
  return Object.freeze(files.sort());
};

interface HeapItem {
  readonly record: HistoricalL2Record;
  readonly iterator: AsyncIterator<HistoricalL2Record>;
  readonly ordinal: number;
}

const less = (left: HeapItem, right: HeapItem): boolean =>
  left.record.update.timestamp < right.record.update.timestamp ||
  (left.record.update.timestamp === right.record.update.timestamp &&
    (left.record.update.instId.localeCompare(right.record.update.instId) < 0 ||
      (left.record.update.instId === right.record.update.instId && left.ordinal < right.ordinal)));

const heapPush = (heap: HeapItem[], item: HeapItem): void => {
  heap.push(item);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (!less(heap[index]!, heap[parent]!)) break;
    [heap[index], heap[parent]] = [heap[parent]!, heap[index]!];
    index = parent;
  }
};

const heapPop = (heap: HeapItem[]): HeapItem | undefined => {
  const first = heap[0];
  const last = heap.pop();
  if (first === undefined || last === undefined) return first;
  if (heap.length > 0) {
    heap[0] = last;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < heap.length && less(heap[left]!, heap[smallest]!)) smallest = left;
      if (right < heap.length && less(heap[right]!, heap[smallest]!)) smallest = right;
      if (smallest === index) break;
      [heap[index], heap[smallest]] = [heap[smallest]!, heap[index]!];
      index = smallest;
    }
  }
  return first;
};

export async function* mergeHistoricalL2Files(files: readonly string[]): AsyncGenerator<HistoricalL2Record> {
  const heap: HeapItem[] = [];
  for (let ordinal = 0; ordinal < files.length; ordinal += 1) {
    const iterator = readHistoricalL2File(files[ordinal]!)[Symbol.asyncIterator]();
    const first = await iterator.next();
    if (!first.done) heapPush(heap, { record: first.value, iterator, ordinal });
  }
  while (heap.length > 0) {
    const item = heapPop(heap)!;
    yield item.record;
    const next = await item.iterator.next();
    if (!next.done) heapPush(heap, { record: next.value, iterator: item.iterator, ordinal: item.ordinal });
  }
}
