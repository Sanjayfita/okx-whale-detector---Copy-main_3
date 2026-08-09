import type { CorrelatedAlertRecord } from './CorrelatedAlertRecorder';
import type {
  CorrelatedAlertEventType,
  CorrelatedAlertSeverity,
} from '../types/correlatedAlert';

export interface CorrelatedAlertInspectOptions {
  filePath: string;
  limit?: number;
  latest: number;
}

export interface CorrelatedAlertInspection {
  totalValidAlerts: number;
  countsBySeverity: Record<CorrelatedAlertSeverity, number>;
  countsByEventType: Record<CorrelatedAlertEventType, number>;
  countsBySymbol: Record<string, number>;
  averageAlertImportance?: number;
  highestAlertImportance?: number;
  latestAlertTimestamp?: number;
  latestAlerts: CorrelatedAlertRecord[];
}

const parsePositiveInteger = (
  flag: string,
  value: string | undefined,
): number => {
  const parsed = value === undefined ? Number.NaN : Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive integer`);
  }

  return parsed;
};

export const parseCorrelatedAlertInspectOptions = (
  args: readonly string[],
  defaultFilePath: string,
): CorrelatedAlertInspectOptions => {
  let filePath = defaultFilePath;
  let limit: number | undefined;
  let latest = 10;

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];

    if (flag === '--file') {
      if (!value || value.startsWith('--')) {
        throw new Error('--file requires a path');
      }
      filePath = value;
      index += 1;
      continue;
    }

    if (flag === '--limit') {
      limit = parsePositiveInteger('--limit', value);
      index += 1;
      continue;
    }

    if (flag === '--latest') {
      latest = parsePositiveInteger('--latest', value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown alert inspection option: ${flag}`);
  }

  return { filePath, limit, latest };
};

export const aggregateCorrelatedAlerts = (
  records: readonly CorrelatedAlertRecord[],
  latestCount = 10,
): CorrelatedAlertInspection => {
  const countsBySeverity: Record<CorrelatedAlertSeverity, number> = {
    INFO: 0,
    WATCH: 0,
    STRONG: 0,
    CRITICAL: 0,
  };
  const countsByEventType: Record<CorrelatedAlertEventType, number> = {
    NEW_SIGNAL: 0,
    CONFIDENCE_INCREASED: 0,
    DIRECTION_CHANGED: 0,
    AGREEMENT: 0,
    CONTRADICTION: 0,
  };
  const countsBySymbol: Record<string, number> = {};
  let totalAlertImportance = 0;
  let highestAlertImportance: number | undefined;
  let latestAlertTimestamp: number | undefined;

  for (const record of records) {
    const { alert } = record;
    countsBySeverity[alert.severity] += 1;
    countsByEventType[alert.eventType] += 1;
    countsBySymbol[alert.symbol] = (countsBySymbol[alert.symbol] ?? 0) + 1;
    totalAlertImportance += alert.alertImportance;
    highestAlertImportance = Math.max(
      highestAlertImportance ?? alert.alertImportance,
      alert.alertImportance,
    );
    latestAlertTimestamp = Math.max(
      latestAlertTimestamp ?? alert.createdAt,
      alert.createdAt,
    );
  }

  const latestAlerts = [...records]
    .sort((left, right) => right.alert.createdAt - left.alert.createdAt)
    .slice(0, latestCount);

  return {
    totalValidAlerts: records.length,
    countsBySeverity,
    countsByEventType,
    countsBySymbol,
    averageAlertImportance:
      records.length === 0 ? undefined : totalAlertImportance / records.length,
    highestAlertImportance,
    latestAlertTimestamp,
    latestAlerts,
  };
};
