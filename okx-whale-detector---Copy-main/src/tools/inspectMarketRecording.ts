import path from 'node:path';

import { MarketRecordingReader } from '../recording/MarketRecordingReader';
import type { MarketRecordingSummary } from '../recording/marketRecordingFormat';

export interface MarketRecordingInspectionLogger {
  log: (...values: unknown[]) => void;
  error: (...values: unknown[]) => void;
}

const parseFilePath = (args: readonly string[]): string => {
  if (args.length !== 2 || args[0] !== '--file' || !args[1]) {
    throw new Error('Usage: recording:inspect -- --file <recording.ndjson>');
  }

  return path.resolve(args[1]);
};

const formatTimestamp = (value: number | undefined): string =>
  value === undefined ? 'unavailable' : new Date(value).toISOString();

export const printMarketRecordingSummary = (
  filePath: string,
  summary: MarketRecordingSummary,
  log: (...values: unknown[]) => void,
): void => {
  log('MARKET RECORDING INSPECTION');
  log(`File: ${filePath}`);
  log(`Format: ${summary.formatType}`);
  log(`Schema version: ${summary.schemaVersion ?? 'unversioned'}`);
  log(`Source session ID: ${summary.sourceSessionId ?? 'unavailable'}`);
  log(`Recording ID: ${summary.recordingId ?? 'unavailable'}`);
  log(`Started: ${formatTimestamp(summary.startedAt)}`);
  log(`Ended: ${formatTimestamp(summary.endedAt)}`);
  log(`Termination: ${summary.termination}`);
  log(
    `Instruments: ${
      summary.instruments
        .map((instrument) => `${instrument.instId} (${instrument.instType})`)
        .join(', ') || 'none'
    }`,
  );
  log(
    `Candle intervals: ${
      summary.subscriptions?.candleIntervals.join(', ') ?? 'unknown'
    }`,
  );
  log(
    `Records: instruments=${summary.counts.instrumentRecords}, ` +
      `orderBooks=${summary.counts.orderBookRecords}, ` +
      `candles=${summary.counts.candleRecords}, ` +
      `fileTotal=${summary.finalFileRecordCount}`,
  );
  log('Validation errors: none');
};

export const runMarketRecordingInspectorCli = async (
  args: readonly string[],
  logger: MarketRecordingInspectionLogger = console,
): Promise<number> => {
  try {
    const filePath = parseFilePath(args);
    const summary = await new MarketRecordingReader().read(filePath);
    printMarketRecordingSummary(filePath, summary, logger.log);
    return 0;
  } catch (error: unknown) {
    logger.error(
      'Market recording inspection failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  }
};

if (require.main === module) {
  void runMarketRecordingInspectorCli(process.argv.slice(2)).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
  );
}
