import { describe, expect, it } from 'vitest';

import {
  aggregateCorrelatedAlerts,
  parseCorrelatedAlertInspectOptions,
} from '../src/recording/correlatedAlertInspection';

import type { CorrelatedAlertRecord } from '../src/recording/CorrelatedAlertRecorder';
import type { CorrelatedAlert } from '../src/types/correlatedAlert';

const createRecord = (
  overrides: Partial<CorrelatedAlert>,
): CorrelatedAlertRecord => ({
  schemaVersion: 1,
  recordedAt: overrides.createdAt ?? 1_000,
  alert: {
    id: 'alert-1',
    symbol: 'BTC-USDT',
    severity: 'STRONG',
    eventType: 'AGREEMENT',
    bias: 'BULLISH',
    relationship: 'AGREEMENT',
    combinedConfidence: 70,
    alertImportance: 70,
    okxConfidence: 75,
    externalEffectiveConfidence: 60,
    externalSignalsUsed: 1,
    ignoredExternalSignals: 0,
    reason: 'Correlated alert',
    createdAt: 1_000,
    ...overrides,
  },
});

describe('correlated alert inspection', () => {
  const records = [
    createRecord({
      id: 'one',
      symbol: 'BTC-USDT',
      severity: 'WATCH',
      eventType: 'AGREEMENT',
      createdAt: 1_000,
    }),
    createRecord({
      id: 'two',
      symbol: 'BTC-USDT',
      severity: 'STRONG',
      eventType: 'CONTRADICTION',
      createdAt: 2_000,
    }),
    createRecord({
      id: 'three',
      symbol: 'ETH-USDT',
      severity: 'STRONG',
      eventType: 'AGREEMENT',
      createdAt: 3_000,
    }),
  ];

  it('counts alerts by severity', () => {
    expect(aggregateCorrelatedAlerts(records).countsBySeverity).toEqual({
      INFO: 0,
      WATCH: 1,
      STRONG: 2,
      CRITICAL: 0,
    });
  });

  it('counts alerts by event type', () => {
    expect(aggregateCorrelatedAlerts(records).countsByEventType).toEqual({
      NEW_SIGNAL: 0,
      CONFIDENCE_INCREASED: 0,
      DIRECTION_CHANGED: 0,
      AGREEMENT: 2,
      CONTRADICTION: 1,
    });
  });

  it('counts alerts by symbol', () => {
    expect(aggregateCorrelatedAlerts(records).countsBySymbol).toEqual({
      'BTC-USDT': 2,
      'ETH-USDT': 1,
    });
  });

  it('summarizes alert importance independently of directional confidence', () => {
    const inspection = aggregateCorrelatedAlerts([
      createRecord({ combinedConfidence: 30, alertImportance: 80 }),
      createRecord({ combinedConfidence: 70, alertImportance: 60 }),
    ]);

    expect(inspection.averageAlertImportance).toBe(70);
    expect(inspection.highestAlertImportance).toBe(80);
  });

  it('returns the requested number of latest alerts', () => {
    const inspection = aggregateCorrelatedAlerts(records, 2);

    expect(inspection.latestAlertTimestamp).toBe(3_000);
    expect(inspection.latestAlerts.map((record) => record.alert.id)).toEqual([
      'three',
      'two',
    ]);
  });

  it('parses file, limit, and latest CLI options', () => {
    expect(
      parseCorrelatedAlertInspectOptions(
        ['--file', 'custom.jsonl', '--limit', '100', '--latest', '5'],
        'default.jsonl',
      ),
    ).toEqual({
      filePath: 'custom.jsonl',
      limit: 100,
      latest: 5,
    });
  });
});
