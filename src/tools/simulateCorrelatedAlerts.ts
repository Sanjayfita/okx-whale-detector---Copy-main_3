import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CorrelatedAlertEngine } from '../alerts/CorrelatedAlertEngine';
import { appConfig } from '../config/appConfig';
import { performanceConfig } from '../config/performanceConfig';
import { MarketState } from '../core/MarketState';
import { ProcessingMonitor } from '../core/ProcessingMonitor';
import { SummaryThrottle } from '../core/SummaryThrottle';
import { ExternalSignalCorrelationService } from '../external/core/ExternalSignalCorrelationService';
import type { ExternalWhaleSignal } from '../external/types/ExternalWhaleSignal';
import { MarketEngine } from '../market/MarketEngine';
import {
  CorrelatedAlertLogReader,
  type CorrelatedAlertLogReadResult,
} from '../recording/CorrelatedAlertLogReader';
import {
  CORRELATED_ALERT_SCHEMA_VERSION,
  CorrelatedAlertRecorder,
  type CorrelatedAlertRecord,
} from '../recording/CorrelatedAlertRecorder';
import { CorrelatedAlertReporter } from '../reporting/CorrelatedAlertReporter';
import type { OKXOrderBookUpdate } from '../clients/okx/OKXWebSocketClient';
import type { CorrelatedAlert } from '../types/correlatedAlert';
import type { MarketInstrumentConfig } from '../types/instrument';

const SIMULATION_TIME = Date.UTC(2026, 6, 28, 12, 0, 0);
const SIMULATION_SESSION_ID = 'deterministic-alert-simulation';
const SIMULATION_FILE_NAME = 'correlated-alerts.jsonl';
const TEMPORARY_DIRECTORY_PREFIX = 'okx-correlated-alert-simulation-';

interface CorrelatedAlertSimulationOptions {
  filePath?: string;
  keepFile: boolean;
}

export interface CorrelatedAlertSimulationDependencies {
  log?: (...values: unknown[]) => void;
  warn?: (...values: unknown[]) => void;
  error?: (...values: unknown[]) => void;
}

export interface CorrelatedAlertSimulationResult {
  outputPath: string;
  records: CorrelatedAlertRecord[];
  malformedRecordCount: number;
  fileRetained: boolean;
}

const EXPECTED_SCENARIOS = {
  'BTC-USDT': 'AGREEMENT',
  'ETH-USDT': 'CONTRADICTION',
} as const;

const parseOptions = (
  args: readonly string[],
): CorrelatedAlertSimulationOptions => {
  let filePath: string | undefined;
  let keepFile = false;

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];

    if (flag === '--keep-file') {
      keepFile = true;
      continue;
    }

    if (flag === '--file') {
      const value = args[index + 1];

      if (!value || value.startsWith('--')) {
        throw new Error('--file requires a path');
      }

      filePath = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown correlated alert simulation option: ${flag}`);
  }

  return { filePath, keepFile };
};

const normalizePathForComparison = (filePath: string): string => {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const assertSafeOutputPath = (outputPath: string): void => {
  const productionPath = appConfig.correlatedAlertRecording.outputPath;

  if (
    normalizePathForComparison(outputPath) ===
    normalizePathForComparison(productionPath)
  ) {
    throw new Error(
      `Refusing to use the production correlated alert path: ${path.resolve(
        productionPath,
      )}`,
    );
  }

  if (existsSync(outputPath)) {
    throw new Error(
      `Simulation output file already exists; refusing to append to it: ${path.resolve(
        outputPath,
      )}`,
    );
  }
};

const createExternalSignal = (
  symbol: keyof typeof EXPECTED_SCENARIOS,
  direction: ExternalWhaleSignal['direction'],
): ExternalWhaleSignal => ({
  id: `simulation-polymarket:${symbol}`,
  underlyingEventId: `simulation-event:${symbol}`,
  provider: 'POLYMARKET',
  category: 'PREDICTION_POSITION',
  direction,
  occurredAt: SIMULATION_TIME,
  receivedAt: SIMULATION_TIME,
  confidence: 80,
  asset: symbol.split('-')[0],
  notionalUsd: 1_000_000,
  description: `Deterministic ${direction.toLowerCase()} Polymarket signal for ${symbol}`,
  evidence: [
    {
      provider: 'POLYMARKET',
      providerEventId: `simulation-provider-event:${symbol}`,
      receivedAt: SIMULATION_TIME,
    },
  ],
});

const createInstrument = (symbol: string): MarketInstrumentConfig => ({
  instId: symbol,
  instType: 'SPOT',
  quoteCurrency: 'USDT',
  baseUnitsPerSize: 1,
});

const createBullishSnapshot = (
  symbol: string,
  sequenceId: number,
): OKXOrderBookUpdate => ({
  instId: symbol,
  action: 'snapshot',
  bids: [['100', '10000', '0', '1']],
  asks: [['101', '1', '0', '1']],
  timestamp: SIMULATION_TIME,
  seqId: sequenceId,
  prevSeqId: -1,
});

const validateResult = (
  result: CorrelatedAlertLogReadResult,
  reportedAlerts: readonly CorrelatedAlert[],
  recordedAlerts: readonly CorrelatedAlert[],
): void => {
  if (result.records.length !== 2) {
    throw new Error(
      `Expected 2 correlated alert records, received ${result.records.length}`,
    );
  }

  if (result.malformedLines.length !== 0) {
    throw new Error(
      `Expected 0 malformed records, received ${result.malformedLines.length}`,
    );
  }

  if (
    reportedAlerts.length !== 2 ||
    recordedAlerts.length !== 2 ||
    reportedAlerts.some((alert, index) => alert !== recordedAlerts[index])
  ) {
    throw new Error(
      'Reporter and recorder did not receive the same two alert objects',
    );
  }

  for (const record of result.records) {
    if (record.schemaVersion !== CORRELATED_ALERT_SCHEMA_VERSION) {
      throw new Error(
        `Unexpected schemaVersion for ${record.alert.symbol}: ${record.schemaVersion}`,
      );
    }

    if (
      record.provenance !== 'SIMULATION' ||
      record.sourceSessionId !== SIMULATION_SESSION_ID ||
      record.evaluationContext.instType !== 'SPOT' ||
      record.evaluationContext.referenceMidpoint !== 100.5 ||
      record.evaluationContext.referenceBestBid !== 100 ||
      record.evaluationContext.referenceBestAsk !== 101
    ) {
      throw new Error(`Invalid evaluation context for ${record.alert.symbol}`);
    }

    const expectedRelationship =
      EXPECTED_SCENARIOS[
        record.alert.symbol as keyof typeof EXPECTED_SCENARIOS
      ];

    if (expectedRelationship === undefined) {
      throw new Error(`Unexpected alert symbol: ${record.alert.symbol}`);
    }

    if (record.alert.relationship !== expectedRelationship) {
      throw new Error(
        `Expected ${record.alert.symbol} relationship ${expectedRelationship}, received ${record.alert.relationship}`,
      );
    }

    if (
      record.alert.severity !== 'STRONG' &&
      record.alert.severity !== 'CRITICAL'
    ) {
      throw new Error(
        `Expected ${record.alert.symbol} severity STRONG or CRITICAL, received ${record.alert.severity}`,
      );
    }

    if (record.alert.externalSignalsUsed < 1) {
      throw new Error(
        `Expected ${record.alert.symbol} to use an external signal`,
      );
    }

    if (
      record.alert.relationship === 'CONTRADICTION' &&
      record.alert.combinedConfidence >= record.alert.alertImportance
    ) {
      throw new Error(
        'Expected contradiction directional confidence to remain below alert importance',
      );
    }
  }

  for (const [symbol, relationship] of Object.entries(EXPECTED_SCENARIOS)) {
    if (
      !result.records.some(
        (record) =>
          record.alert.symbol === symbol &&
          record.alert.relationship === relationship,
      )
    ) {
      throw new Error(
        `Missing expected ${symbol} ${relationship} simulation record`,
      );
    }
  }
};

const printResult = (
  outputPath: string,
  result: CorrelatedAlertLogReadResult,
  log: (...values: unknown[]) => void,
): void => {
  log('CORRELATED ALERT SIMULATION\n');
  log(`Output file: ${outputPath}`);
  log(`Valid records: ${result.records.length}`);
  log(`Malformed records: ${result.malformedLines.length}`);
  log('\nValidated records:');

  for (const record of result.records) {
    const { alert } = record;
    const contextOutput =
      record.schemaVersion === CORRELATED_ALERT_SCHEMA_VERSION
        ? `Provenance: ${record.provenance} | ` +
          `Midpoint: ${record.evaluationContext.referenceMidpoint}`
        : 'Evaluation context: unavailable';

    log(
      `schemaVersion=${record.schemaVersion} | ${alert.symbol} | ` +
        `${alert.relationship} | ${alert.severity} | Bias: ${alert.bias} | ` +
        `Directional confidence: ${alert.combinedConfidence.toFixed(1)}% | ` +
        `Alert importance: ${alert.alertImportance.toFixed(1)}% | ` +
        `External signals: ${alert.externalSignalsUsed} | ` +
        contextOutput,
    );
  }
};

export const simulateCorrelatedAlerts = async (
  args: readonly string[],
  dependencies: CorrelatedAlertSimulationDependencies = {},
): Promise<CorrelatedAlertSimulationResult> => {
  const options = parseOptions(args);
  const log = dependencies.log ?? console.log;
  const warn = dependencies.warn ?? console.warn;
  const temporaryDirectory =
    options.filePath === undefined
      ? mkdtempSync(path.join(tmpdir(), TEMPORARY_DIRECTORY_PREFIX))
      : undefined;
  const outputPath = path.resolve(
    options.filePath ??
      path.join(temporaryDirectory as string, SIMULATION_FILE_NAME),
  );
  let recorderFailure: string | undefined;
  let cleanupAuthorized = options.filePath === undefined;

  try {
    assertSafeOutputPath(outputPath);
    cleanupAuthorized = true;

    const correlationService = new ExternalSignalCorrelationService({
      correlation: appConfig.correlation,
    });
    correlationService.addSignal(
      createExternalSignal('BTC-USDT', 'BULLISH'),
      SIMULATION_TIME,
    );
    correlationService.addSignal(
      createExternalSignal('ETH-USDT', 'BEARISH'),
      SIMULATION_TIME,
    );

    const alertEngine = new CorrelatedAlertEngine({
      minimumAgreementAlertImportance:
        appConfig.correlatedAlerts.minimumAgreementAlertImportance,
      minimumContradictionAlertImportance:
        appConfig.correlatedAlerts.minimumContradictionAlertImportance,
      externalOnlyAlertsEnabled:
        appConfig.correlatedAlerts.externalOnlyAlertsEnabled,
      minimumExternalOnlyAlertImportance:
        appConfig.correlatedAlerts.minimumExternalOnlyAlertImportance,
      severityThresholds: appConfig.correlatedAlerts.severityThresholds,
      cooldownMs: 0,
      clock: () => SIMULATION_TIME,
      sourceSessionId: SIMULATION_SESSION_ID,
    });
    const alertReporter = new CorrelatedAlertReporter();
    const recorder = new CorrelatedAlertRecorder({
      outputPath,
      flushAfterEachAlert: false,
      clock: () => SIMULATION_TIME + 1_000,
      warn: (message) => {
        recorderFailure ??= message;
        warn(message);
      },
    });
    const reportedAlerts: CorrelatedAlert[] = [];
    const recordedAlerts: CorrelatedAlert[] = [];
    const reportAlert = alertReporter.report.bind(alertReporter);
    const recordAlert = recorder.record.bind(recorder);

    alertReporter.report = (alert) => {
      reportedAlerts.push(alert);
      reportAlert(alert);
    };
    recorder.record = (alert, context, trace) => {
      recordedAlerts.push(alert);
      return recordAlert(alert, context, trace);
    };

    const states = new Map(
      (
        Object.keys(EXPECTED_SCENARIOS) as Array<
          keyof typeof EXPECTED_SCENARIOS
        >
      ).map((symbol) => [
        symbol,
        new MarketState(appConfig, createInstrument(symbol)),
      ]),
    );
    const marketEngine = new MarketEngine(
      states,
      new SummaryThrottle(0),
      undefined,
      new ProcessingMonitor(performanceConfig, () => undefined),
      undefined,
      correlationService,
      alertEngine,
      alertReporter,
      recorder,
      () => SIMULATION_TIME,
      'SIMULATION',
    );

    try {
      marketEngine.processOrderBookUpdate(createBullishSnapshot('BTC-USDT', 1));
      marketEngine.processOrderBookUpdate(createBullishSnapshot('ETH-USDT', 2));
    } finally {
      recorder.close();
    }

    if (recorderFailure !== undefined) {
      throw new Error(`Correlated alert recorder failed: ${recorderFailure}`);
    }

    const result = await new CorrelatedAlertLogReader().read(outputPath);
    validateResult(result, reportedAlerts, recordedAlerts);
    printResult(outputPath, result, log);

    if (options.keepFile) {
      log(`\nRetained simulation file: ${outputPath}`);
    } else {
      log('\nTemporary simulation file cleaned up.');
    }

    return {
      outputPath,
      records: result.records,
      malformedRecordCount: result.malformedLines.length,
      fileRetained: options.keepFile,
    };
  } finally {
    if (!options.keepFile && cleanupAuthorized) {
      if (temporaryDirectory !== undefined) {
        rmSync(temporaryDirectory, { recursive: true, force: true });
      } else {
        rmSync(outputPath, { force: true });
      }
    }
  }
};

export const runCorrelatedAlertSimulationCli = async (
  args: readonly string[],
  dependencies: CorrelatedAlertSimulationDependencies = {},
): Promise<number> => {
  try {
    await simulateCorrelatedAlerts(args, dependencies);
    return 0;
  } catch (error: unknown) {
    const errorLog = dependencies.error ?? console.error;
    errorLog(
      'Correlated alert simulation failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  }
};

if (require.main === module) {
  void runCorrelatedAlertSimulationCli(process.argv.slice(2)).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
  );
}
