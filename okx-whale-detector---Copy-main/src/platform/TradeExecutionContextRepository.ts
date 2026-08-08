import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { TradingStrategyConfig } from '../config/tradingStrategyConfig';
import type { TradingTimeframe } from '../config/tradingTimeframes';
import type { DeploymentIdentity } from './DeploymentIdentity';

export interface PaperTradeExecutionContext {
  readonly tradeId: string;
  readonly instrumentId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  readonly timeframe: TradingTimeframe;
  readonly strategyConfig: TradingStrategyConfig;
  readonly strategyConfigFingerprint: string;
  readonly deployment: DeploymentIdentity;
  readonly recordedAt: number;
}

interface PersistedTradeExecutionContexts {
  readonly schemaVersion: 1;
  readonly records: readonly PaperTradeExecutionContext[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parsePersisted = (value: unknown): PersistedTradeExecutionContexts => {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.records)) {
    throw new Error('trade execution context file has an unsupported shape');
  }
  return value as unknown as PersistedTradeExecutionContexts;
};

export class TradeExecutionContextRepository {
  private readonly contexts = new Map<string, PaperTradeExecutionContext>();
  private loaded = false;

  public constructor(
    private readonly filePath = 'data/platform/trade-contexts.json',
  ) {}

  public load(): readonly PaperTradeExecutionContext[] {
    if (this.loaded) return this.list();
    this.loaded = true;
    if (!existsSync(this.filePath)) return [];
    const persisted = parsePersisted(
      JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown,
    );
    for (const context of persisted.records) {
      if (context.tradeId.trim().length === 0) {
        throw new Error('trade execution context tradeId must not be empty');
      }
      if (!this.contexts.has(context.tradeId)) this.contexts.set(context.tradeId, context);
    }
    return this.list();
  }

  public record(context: PaperTradeExecutionContext): boolean {
    this.load();
    if (this.contexts.has(context.tradeId)) return false;
    this.contexts.set(context.tradeId, context);
    this.persist();
    return true;
  }

  public get(tradeId: string): PaperTradeExecutionContext | null {
    this.load();
    return this.contexts.get(tradeId) ?? null;
  }

  public list(): readonly PaperTradeExecutionContext[] {
    return [...this.contexts.values()].sort(
      (left, right) => left.recordedAt - right.recordedAt || left.tradeId.localeCompare(right.tradeId),
    );
  }

  public getFilePath(): string {
    return this.filePath;
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    const descriptor = openSync(temporaryPath, 'w');
    try {
      const body: PersistedTradeExecutionContexts = {
        schemaVersion: 1,
        records: this.list(),
      };
      writeFileSync(descriptor, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    try {
      renameSync(temporaryPath, this.filePath);
    } catch (error: unknown) {
      try {
        if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
      } catch {
        // Preserve the commit failure; temporary-file cleanup is best effort.
      }
      throw error;
    }
  }
}
