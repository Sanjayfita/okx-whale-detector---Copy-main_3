import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  createAlertAlignmentEvaluationConfiguration,
  createAlignmentConfiguration,
  generateAlertAlignmentEvaluations,
  prepareAlertAlignmentMarketRecording,
  toAlignmentConfiguration,
  type AlertAlignmentEvaluationConfiguration,
} from '../evaluation';
import type { PriceSource } from '../evaluation/alignmentTypes';
import { CorrelatedAlertLogReader } from '../recording/CorrelatedAlertLogReader';
import { AlertAlignmentEvaluationRecorder } from '../recording/AlertAlignmentEvaluationRecorder';

interface GeneratorOptions {
  alertsPath: string;
  marketDataPath: string;
  outputPath: string;
  horizonsMs?: readonly number[];
  requestedSources?: readonly PriceSource[];
  evaluationRunId: string;
  now: number;
}

export interface AlertAlignmentGeneratorCliDependencies {
  log?: (...values: unknown[]) => void;
  warn?: (...values: unknown[]) => void;
  error?: (...values: unknown[]) => void;
  clock?: () => number;
  runIdFactory?: () => string;
}

const sourceAliases: Readonly<Record<string, PriceSource>> = {
  midpoint: 'ORDER_BOOK_MIDPOINT',
  'bid-ask': 'ORDER_BOOK_BID_ASK',
  'candle-close': 'CONFIRMED_CANDLE_CLOSE',
};

const parseDuration = (value: string): number => {
  const match = /^([1-9]\d*)(ms|s|m|h)$/.exec(value);
  if (!match) {
    throw new Error(`Invalid horizon: ${value}`);
  }
  const amount = Number(match[1]);
  const scale = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[
    match[2] as 'ms' | 's' | 'm' | 'h'
  ];
  const duration = amount * scale;
  if (!Number.isSafeInteger(duration)) {
    throw new Error(`Invalid horizon: ${value}`);
  }
  return duration;
};

const requireValue = (
  args: readonly string[],
  index: number,
  flag: string,
): string => {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
};

const parseOptions = (
  args: readonly string[],
  dependencies: AlertAlignmentGeneratorCliDependencies,
): GeneratorOptions => {
  let alertsPath: string | undefined;
  let marketDataPath: string | undefined;
  let outputPath: string | undefined;
  let horizonsMs: number[] | undefined;
  let requestedSources: PriceSource[] | undefined;
  let evaluationRunId =
    dependencies.runIdFactory?.() ?? `alignment-run:${randomUUID()}`;
  let now = dependencies.clock?.() ?? Date.now();

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = requireValue(args, index, flag ?? 'option');

    if (flag === '--alerts') {
      alertsPath = path.resolve(value);
    } else if (flag === '--market-data') {
      marketDataPath = path.resolve(value);
    } else if (flag === '--output') {
      outputPath = path.resolve(value);
    } else if (flag === '--horizons') {
      horizonsMs = value
        .split(',')
        .map(parseDuration)
        .sort((a, b) => a - b);
    } else if (flag === '--sources') {
      requestedSources = value.split(',').map((source) => {
        const resolved = sourceAliases[source];
        if (!resolved) {
          throw new Error(`Invalid alignment source: ${source}`);
        }
        return resolved;
      });
    } else if (flag === '--evaluation-run-id') {
      evaluationRunId = value;
    } else if (flag === '--now') {
      now = Number(value);
    } else {
      throw new Error(`Unknown alignment evaluation option: ${flag}`);
    }
    index += 1;
  }

  if (!alertsPath || !marketDataPath || !outputPath) {
    throw new Error(
      'Usage: alerts:evaluate:alignment -- --alerts <alerts.jsonl> --market-data <recording.jsonl> --output <evaluations.jsonl>',
    );
  }
  const normalized = [alertsPath, marketDataPath, outputPath].map((filePath) =>
    process.platform === 'win32' ? filePath.toLowerCase() : filePath,
  );
  if (normalized[2] === normalized[0] || normalized[2] === normalized[1]) {
    throw new Error('Alignment evaluation output must differ from both inputs');
  }

  return {
    alertsPath,
    marketDataPath,
    outputPath,
    horizonsMs,
    requestedSources,
    evaluationRunId,
    now,
  };
};

const countMalformedJsonLines = (contents: string): number => {
  let malformed = 0;
  for (const line of contents.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      JSON.parse(line);
    } catch {
      malformed += 1;
    }
  }
  return malformed;
};

const printSummary = (
  records: ReturnType<typeof generateAlertAlignmentEvaluations>,
  configuration: AlertAlignmentEvaluationConfiguration,
  malformedAlerts: number,
  malformedRecordingLines: number,
  log: (...values: unknown[]) => void,
): void => {
  const counts = new Map<string, number>();
  for (const record of records) {
    for (const alignment of record.alignments) {
      counts.set(
        alignment.completeness,
        (counts.get(alignment.completeness) ?? 0) + 1,
      );
    }
  }

  log('ALERT ALIGNMENT EVALUATION');
  log(`Evaluation records: ${records.length}`);
  log(`Malformed alert lines: ${malformedAlerts}`);
  log(`Malformed market-recording lines: ${malformedRecordingLines}`);
  log(`Configuration fingerprint: ${configuration.fingerprint}`);
  log(
    `Alignment cells: ${records.reduce((sum, record) => sum + record.alignments.length, 0)}`,
  );
  for (const completeness of [
    'COMPLETE',
    'PARTIAL',
    'MISSING',
    'AMBIGUOUS',
    'INVALID',
  ]) {
    log(`${completeness}: ${counts.get(completeness) ?? 0}`);
  }
  log('Returns/outcomes: not calculated');
};

export const runAlertAlignmentGeneratorCli = async (
  args: readonly string[],
  dependencies: AlertAlignmentGeneratorCliDependencies = {},
): Promise<number> => {
  const log = dependencies.log ?? console.log;
  const warn = dependencies.warn ?? console.warn;
  const errorLog = dependencies.error ?? console.error;

  try {
    const options = parseOptions(args, dependencies);
    const alertRead = await new CorrelatedAlertLogReader().read(
      options.alertsPath,
    );
    for (const malformed of alertRead.malformedLines) {
      warn(
        `Malformed alert line ${malformed.lineNumber}: ${malformed.message}`,
      );
    }
    if (alertRead.records.length === 0) {
      throw new Error('No valid correlated alert records were supplied');
    }

    const marketContents = readFileSync(options.marketDataPath, 'utf8');
    const malformedRecordingLines = countMalformedJsonLines(marketContents);
    if (malformedRecordingLines > 0) {
      throw new Error(
        `Market recording contains ${malformedRecordingLines} malformed JSON line(s)`,
      );
    }
    const configuration = createAlertAlignmentEvaluationConfiguration({
      alignment:
        options.horizonsMs === undefined
          ? undefined
          : createAlignmentConfiguration({
              horizonsMs: options.horizonsMs,
            }),
      requestedSources: options.requestedSources,
    });
    const marketRecording = prepareAlertAlignmentMarketRecording(
      marketContents.split(/\r?\n/),
      {
        configuration: {
          alignment: toAlignmentConfiguration(configuration),
          requestedSources: configuration.requestedSources,
          floatingPointTolerance: configuration.floatingPointTolerance,
        },
        now: options.now,
      },
    );
    const records = generateAlertAlignmentEvaluations({
      alerts: alertRead.records,
      marketRecording,
      configuration,
      evaluationRunId: options.evaluationRunId,
      now: options.now,
    });
    const recorder = new AlertAlignmentEvaluationRecorder(options.outputPath);
    try {
      for (const record of records) {
        recorder.record(record);
      }
    } finally {
      recorder.close();
    }

    printSummary(
      records,
      configuration,
      alertRead.malformedLines.length,
      malformedRecordingLines,
      log,
    );
    log(`Output: ${options.outputPath}`);
    return 0;
  } catch (error: unknown) {
    errorLog(
      'Alert alignment evaluation failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  }
};

if (require.main === module) {
  void runAlertAlignmentGeneratorCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
