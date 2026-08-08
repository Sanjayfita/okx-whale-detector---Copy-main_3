import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { TradingTimeframe } from '../config/tradingTimeframes';
import type { TradingRiskPersistedState } from '../risk/TradingRiskManager';
import type { PaperAccountPersistedState } from './PaperAccountLedger';

export interface PaperRecoveryContext {
  readonly activeStrategyId: string;
  readonly timeframe: TradingTimeframe;
  readonly lastConfirmedCandleByInstrument: Readonly<Record<string, number>>;
}

export interface PersistedPaperRuntimeState {
  readonly schemaVersion: 1;
  readonly savedAt: number;
  readonly account: PaperAccountPersistedState;
  readonly risk: TradingRiskPersistedState;
  readonly context: PaperRecoveryContext;
}

export interface PaperStateRepositoryOptions {
  readonly filePath?: string;
  /** Test hook used to simulate a crash after fsync but before atomic rename. */
  readonly beforeCommit?: () => void;
}

export interface PaperPersistenceHealth {
  readonly healthy: boolean;
  readonly lastSuccessfulSaveAt: number | null;
  readonly lastError: string | null;
  readonly fileSizeBytes: number | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireTopLevelState = (value: unknown): PersistedPaperRuntimeState => {
  if (!isRecord(value)) throw new Error('paper state file must contain a JSON object');
  if (value.schemaVersion !== 1) throw new Error('unsupported paper state schema');
  if (!Number.isSafeInteger(value.savedAt) || Number(value.savedAt) < 0) {
    throw new Error('paper state savedAt must be a non-negative safe integer');
  }
  if (!isRecord(value.account)) throw new Error('paper state account must be an object');
  if (!isRecord(value.risk)) throw new Error('paper state risk must be an object');
  if (!isRecord(value.context)) throw new Error('paper state context must be an object');
  return value as unknown as PersistedPaperRuntimeState;
};

/**
 * Crash-safe persistence for the paper account runtime.
 *
 * The repository writes a complete, explicit versioned state document to a
 * temporary sibling file, fsyncs it, and atomically renames it over the last
 * known-good state. A crash before rename therefore leaves the previous state
 * intact and recoverable.
 */
export class PaperStateRepository {
  private readonly filePath: string;
  private readonly beforeCommit?: () => void;
  private lastSuccessfulSaveAt: number | null = null;
  private lastError: string | null = null;

  public constructor(options: PaperStateRepositoryOptions = {}) {
    this.filePath = options.filePath ?? 'data/platform/paper-state.json';
    this.beforeCommit = options.beforeCommit;
  }

  public load(): PersistedPaperRuntimeState | null {
    if (!existsSync(this.filePath)) {
      this.lastError = null;
      return null;
    }
    try {
      const parsed = requireTopLevelState(
        JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown,
      );
      this.lastSuccessfulSaveAt = parsed.savedAt;
      this.lastError = null;
      return parsed;
    } catch (error: unknown) {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  public save(state: PersistedPaperRuntimeState): void {
    if (state.schemaVersion !== 1) throw new Error('unsupported paper state schema');
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    try {
      const descriptor = openSync(temporaryPath, 'w');
      try {
        writeFileSync(descriptor, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }

      this.beforeCommit?.();
      renameSync(temporaryPath, this.filePath);
      this.lastSuccessfulSaveAt = state.savedAt;
      this.lastError = null;
    } catch (error: unknown) {
      this.lastError = error instanceof Error ? error.message : String(error);
      try {
        if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
      } catch {
        // Preserve the original write/commit error. Temporary cleanup is best effort.
      }
      throw error;
    }
  }

  public getFilePath(): string {
    return this.filePath;
  }

  public getHealth(): PaperPersistenceHealth {
    let fileSizeBytes: number | null = null;
    try {
      if (existsSync(this.filePath)) fileSizeBytes = statSync(this.filePath).size;
    } catch {
      // File-size telemetry is best effort and does not by itself invalidate state.
    }
    return {
      healthy: this.lastError === null,
      lastSuccessfulSaveAt: this.lastSuccessfulSaveAt,
      lastError: this.lastError,
      fileSizeBytes,
    };
  }
}
