import path from 'node:path';

import { appConfig } from '../config/appConfig';
import {
  CorrelatedAlertLogReader,
  type CorrelatedAlertLogReadOptions,
  type CorrelatedAlertLogReadResult,
} from '../recording/CorrelatedAlertLogReader';
import { CORRELATED_ALERT_SCHEMA_VERSION } from '../recording/CorrelatedAlertRecorder';
import {
  aggregateCorrelatedAlerts,
  parseCorrelatedAlertInspectOptions,
} from '../recording/correlatedAlertInspection';

export interface CorrelatedAlertInspectionReader {
  read(
    filePath: string,
    options?: CorrelatedAlertLogReadOptions,
  ): Promise<CorrelatedAlertLogReadResult>;
}

export interface CorrelatedAlertInspectionCliDependencies {
  defaultFilePath?: string;
  reader?: CorrelatedAlertInspectionReader;
  log?: (...values: unknown[]) => void;
  warn?: (...values: unknown[]) => void;
  error?: (...values: unknown[]) => void;
}

const isMissingFileError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'ENOENT';

export const inspectCorrelatedAlerts = async (
  args: readonly string[],
  dependencies: CorrelatedAlertInspectionCliDependencies = {},
): Promise<void> => {
  const defaultFilePath =
    dependencies.defaultFilePath ??
    appConfig.correlatedAlertRecording.outputPath;
  const reader = dependencies.reader ?? new CorrelatedAlertLogReader();
  const log = dependencies.log ?? console.log;
  const warn = dependencies.warn ?? console.warn;
  const options = parseCorrelatedAlertInspectOptions(args, defaultFilePath);
  let result: CorrelatedAlertLogReadResult;

  try {
    result = await reader.read(options.filePath, {
      maximumRecords: options.limit,
    });
  } catch (error: unknown) {
    if (!isMissingFileError(error)) {
      throw error;
    }

    log('CORRELATED ALERT LOG\n');
    log('No correlated alert log exists yet.');
    log(`Expected file: ${path.resolve(options.filePath)}`);
    log(
      'The file is created lazily after the first correlated alert is emitted.',
    );
    return;
  }

  const inspection = aggregateCorrelatedAlerts(result.records, options.latest);

  log('CORRELATED ALERT LOG\n');
  log(`File: ${options.filePath}`);
  log(`Valid alerts: ${inspection.totalValidAlerts}`);
  log(`Malformed lines: ${result.malformedLines.length}`);
  log(
    `Average alert importance: ${
      inspection.averageAlertImportance === undefined
        ? 'N/A'
        : `${inspection.averageAlertImportance.toFixed(1)}%`
    }`,
  );
  log(
    `Highest alert importance: ${
      inspection.highestAlertImportance === undefined
        ? 'N/A'
        : `${inspection.highestAlertImportance.toFixed(1)}%`
    }`,
  );

  for (const malformed of result.malformedLines) {
    warn(`Malformed line ${malformed.lineNumber}: ${malformed.message}`);
  }

  log('\nBy severity:');
  for (const [severity, count] of Object.entries(inspection.countsBySeverity)) {
    log(`${severity}: ${count}`);
  }

  log('\nBy event:');
  for (const [eventType, count] of Object.entries(
    inspection.countsByEventType,
  )) {
    log(`${eventType}: ${count}`);
  }

  log('\nTop symbols:');
  const symbols = Object.entries(inspection.countsBySymbol).sort(
    ([leftSymbol, leftCount], [rightSymbol, rightCount]) =>
      rightCount - leftCount || leftSymbol.localeCompare(rightSymbol),
  );

  for (const [symbol, count] of symbols) {
    log(`${symbol}: ${count}`);
  }

  log(
    `\nLatest alert timestamp: ${
      inspection.latestAlertTimestamp === undefined
        ? 'N/A'
        : new Date(inspection.latestAlertTimestamp).toISOString()
    }`,
  );
  log('\nLatest alerts:');

  for (const record of inspection.latestAlerts) {
    const { alert } = record;
    log(
      `${new Date(alert.createdAt).toISOString()} | ${alert.symbol} | ` +
        `${alert.severity} | ${alert.eventType} | ` +
        `Direction ${alert.combinedConfidence.toFixed(1)}% | ` +
        `Importance ${alert.alertImportance.toFixed(1)}%`,
    );

    if (record.schemaVersion !== CORRELATED_ALERT_SCHEMA_VERSION) {
      log(
        `Schema v${record.schemaVersion} | Alert ID: ${alert.id} | ` +
          'Evaluation context: unavailable',
      );
      continue;
    }

    const context = record.evaluationContext;
    log(
      `Schema v${record.schemaVersion} | Alert ID: ${alert.id} | ` +
        `Session: ${record.sourceSessionId} | Sequence: ${record.alertSequence}`,
    );
    log(
      `Instrument: ${context.instId} (${context.instType}) | ` +
        `OKX Bias: ${context.okxBias} | External Bias: ${context.externalBias} | ` +
        `Provenance: ${record.provenance}`,
    );
    log(
      `Reference: midpoint ${context.referenceMidpoint} | ` +
        `bid ${context.referenceBestBid} | ask ${context.referenceBestAsk} | ` +
        `Evaluation context: available`,
    );
  }
};

export const runCorrelatedAlertInspectionCli = async (
  args: readonly string[],
  dependencies: CorrelatedAlertInspectionCliDependencies = {},
): Promise<number> => {
  try {
    await inspectCorrelatedAlerts(args, dependencies);
    return 0;
  } catch (error: unknown) {
    const errorLog = dependencies.error ?? console.error;
    errorLog(
      'Correlated alert inspection failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  }
};

if (require.main === module) {
  void runCorrelatedAlertInspectionCli(process.argv.slice(2)).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
  );
}
