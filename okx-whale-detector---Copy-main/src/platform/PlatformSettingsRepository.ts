import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DashboardSettings, PlatformMode } from './PlatformContracts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const numberValue = (
  record: Record<string, unknown>,
  key: string,
): number | undefined => {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const stringValue = (
  record: Record<string, unknown>,
  key: string,
): string | undefined => {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
};

const booleanValue = (
  record: Record<string, unknown>,
  key: string,
): boolean | undefined => {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
};

const modeValue = (record: Record<string, unknown>): PlatformMode | undefined => {
  const mode = stringValue(record, 'mode');
  return mode === 'PAPER' || mode === 'LIVE' ? mode : undefined;
};

/**
 * Small atomic JSON repository for user-editable platform settings.
 * Database evidence remains immutable; mutable UI preferences are intentionally
 * kept separate so editing a dashboard setting cannot rewrite research records.
 */
export class PlatformSettingsRepository {
  public constructor(
    private readonly filePath = 'data/platform/settings.json',
  ) {}

  public async load(): Promise<Partial<DashboardSettings> | null> {
    let content: string;
    try {
      content = await readFile(this.filePath, 'utf8');
    } catch (error: unknown) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : '';
      if (code === 'ENOENT') return null;
      throw error;
    }
    const parsed: unknown = JSON.parse(content) as unknown;
    if (!isRecord(parsed)) {
      throw new Error('platform settings file must contain a JSON object');
    }

    return {
      ...(modeValue(parsed) === undefined ? {} : { mode: modeValue(parsed) }),
      ...(stringValue(parsed, 'activeStrategyId') === undefined
        ? {}
        : { activeStrategyId: stringValue(parsed, 'activeStrategyId') }),
      ...(numberValue(parsed, 'fastEmaLength') === undefined
        ? {}
        : { fastEmaLength: numberValue(parsed, 'fastEmaLength') }),
      ...(numberValue(parsed, 'slowEmaLength') === undefined
        ? {}
        : { slowEmaLength: numberValue(parsed, 'slowEmaLength') }),
      ...(numberValue(parsed, 'rsiPeriod') === undefined
        ? {}
        : { rsiPeriod: numberValue(parsed, 'rsiPeriod') }),
      ...(numberValue(parsed, 'atrPeriod') === undefined
        ? {}
        : { atrPeriod: numberValue(parsed, 'atrPeriod') }),
      ...(numberValue(parsed, 'atrMultiplier') === undefined
        ? {}
        : { atrMultiplier: numberValue(parsed, 'atrMultiplier') }),
      ...(numberValue(parsed, 'minimumAtrPercent') === undefined
        ? {}
        : { minimumAtrPercent: numberValue(parsed, 'minimumAtrPercent') }),
      ...(numberValue(parsed, 'maximumAtrPercent') === undefined
        ? {}
        : { maximumAtrPercent: numberValue(parsed, 'maximumAtrPercent') }),
      ...(numberValue(parsed, 'riskPerTradePercent') === undefined
        ? {}
        : { riskPerTradePercent: numberValue(parsed, 'riskPerTradePercent') }),
      ...(numberValue(parsed, 'stopLossPercent') === undefined
        ? {}
        : { stopLossPercent: numberValue(parsed, 'stopLossPercent') }),
      ...(numberValue(parsed, 'takeProfitPercent') === undefined
        ? {}
        : { takeProfitPercent: numberValue(parsed, 'takeProfitPercent') }),
      ...(booleanValue(parsed, 'trailingStopEnabled') === undefined
        ? {}
        : { trailingStopEnabled: booleanValue(parsed, 'trailingStopEnabled') }),
      ...(numberValue(parsed, 'trailingStopPercent') === undefined
        ? {}
        : { trailingStopPercent: numberValue(parsed, 'trailingStopPercent') }),
      ...(booleanValue(parsed, 'autoSave') === undefined
        ? {}
        : { autoSave: booleanValue(parsed, 'autoSave') }),
    };
  }

  public async save(settings: DashboardSettings): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(
      temporaryPath,
      `${JSON.stringify(settings, null, 2)}\n`,
      'utf8',
    );
    await rename(temporaryPath, this.filePath);
  }
}
