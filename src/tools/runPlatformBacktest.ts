import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  PlatformBacktestEngine,
  type HistoricalBacktestCandle,
  type PlatformBacktestFundingEvent,
} from '../backtest/PlatformBacktestEngine';
import { createBacktestDatasetManifest } from '../backtest/BacktestDatasetManifest';
import type { BacktestInstrumentSpecification } from '../backtest/BacktestInstrumentSpecification';
import { tradingStrategyConfig } from '../config/tradingStrategyConfig';

export interface ParsedPlatformBacktestInput {
  readonly datasetId: string;
  readonly createdAt: number | null;
  readonly expectedCandleIntervalMs: number | null;
  readonly instrumentSpecification: BacktestInstrumentSpecification | null;
  readonly candles: readonly HistoricalBacktestCandle[];
  readonly fundingEvents: readonly PlatformBacktestFundingEvent[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const finiteNumber = (
  record: Readonly<Record<string, unknown>>,
  key: string,
  context: string,
): number => {
  const field = record[key];
  if (typeof field !== 'number' || !Number.isFinite(field)) {
    throw new Error(`${context}.${key} must be a finite number`);
  }
  return field;
};

const parseCandles = (
  values: readonly unknown[],
): readonly HistoricalBacktestCandle[] =>
  values.map((value, index) => {
    if (!isRecord(value)) throw new Error(`candle ${index} must be an object`);
    if (value.fundingRatePercent !== undefined) {
      throw new Error(
        `candle ${index}.fundingRatePercent is ambiguous; use a timestamped fundingEvents record`,
      );
    }
    return {
      timestamp: finiteNumber(value, 'timestamp', `candle ${index}`),
      open: finiteNumber(value, 'open', `candle ${index}`),
      high: finiteNumber(value, 'high', `candle ${index}`),
      low: finiteNumber(value, 'low', `candle ${index}`),
      close: finiteNumber(value, 'close', `candle ${index}`),
      confirm: value.confirm === undefined ? true : value.confirm === true,
    };
  });

const parseFundingEvents = (
  values: readonly unknown[],
): readonly PlatformBacktestFundingEvent[] =>
  values.map((value, index) => {
    if (!isRecord(value)) {
      throw new Error(`funding event ${index} must be an object`);
    }
    if (
      typeof value.eventId !== 'string' ||
      value.eventId.trim().length === 0
    ) {
      throw new Error(
        `funding event ${index}.eventId must be a non-empty string`,
      );
    }
    return {
      eventId: value.eventId,
      timestamp: finiteNumber(value, 'timestamp', `funding event ${index}`),
      fundingRatePercent: finiteNumber(
        value,
        'fundingRatePercent',
        `funding event ${index}`,
      ),
      markPrice: finiteNumber(value, 'markPrice', `funding event ${index}`),
    };
  });

const parseInstrumentSpecification = (
  value: unknown,
): BacktestInstrumentSpecification => {
  if (!isRecord(value) || typeof value.instrumentId !== 'string') {
    throw new Error('backtest document requires an instrumentSpecification');
  }
  return {
    instrumentId: value.instrumentId,
    tickSize: finiteNumber(value, 'tickSize', 'instrumentSpecification'),
    lotSizeBaseUnits: finiteNumber(
      value,
      'lotSizeBaseUnits',
      'instrumentSpecification',
    ),
    minimumOrderBaseUnits: finiteNumber(
      value,
      'minimumOrderBaseUnits',
      'instrumentSpecification',
    ),
    minimumOrderValue: finiteNumber(
      value,
      'minimumOrderValue',
      'instrumentSpecification',
    ),
    maximumLeverage: finiteNumber(
      value,
      'maximumLeverage',
      'instrumentSpecification',
    ),
  };
};

export const parsePlatformBacktestInput = (
  content: string,
): ParsedPlatformBacktestInput => {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return {
      datasetId: 'legacy-unversioned',
      createdAt: null,
      expectedCandleIntervalMs: null,
      instrumentSpecification: null,
      candles: [],
      fundingEvents: [],
    };
  }

  const parsed: unknown =
    trimmed.startsWith('[') || trimmed.startsWith('{')
      ? (JSON.parse(trimmed) as unknown)
      : trimmed
          .split(/\r?\n/u)
          .filter(Boolean)
          .map((line) => JSON.parse(line) as unknown);

  if (Array.isArray(parsed)) {
    return {
      datasetId: 'legacy-unversioned',
      createdAt: null,
      expectedCandleIntervalMs: null,
      instrumentSpecification: null,
      candles: parseCandles(parsed),
      fundingEvents: [],
    };
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1) {
    throw new Error(
      'backtest input must be a candle array/NDJSON stream or a schemaVersion 1 document',
    );
  }
  if (!Array.isArray(parsed.candles) || !Array.isArray(parsed.fundingEvents)) {
    throw new Error(
      'backtest document requires candles and fundingEvents arrays',
    );
  }
  if (
    typeof parsed.datasetId !== 'string' ||
    parsed.datasetId.trim().length === 0
  ) {
    throw new Error('backtest document requires a non-empty datasetId');
  }
  const expectedCandleIntervalMs = finiteNumber(
    parsed,
    'expectedCandleIntervalMs',
    'backtest document',
  );
  return {
    datasetId: parsed.datasetId,
    createdAt: finiteNumber(parsed, 'createdAt', 'backtest document'),
    expectedCandleIntervalMs,
    instrumentSpecification: parseInstrumentSpecification(
      parsed.instrumentSpecification,
    ),
    candles: parseCandles(parsed.candles),
    fundingEvents: parseFundingEvents(parsed.fundingEvents),
  };
};

const equityCsv = (
  points: readonly { readonly timestamp: number; readonly equity: number }[],
): string =>
  `timestamp,equity\n${points.map((point) => `${point.timestamp},${point.equity}`).join('\n')}${points.length > 0 ? '\n' : ''}`;

export const runPlatformBacktestCli = async (
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> => {
  const inputPath = argv[0] ?? process.env.BACKTEST_INPUT;
  const instrumentId =
    argv[1] ?? process.env.BACKTEST_INSTRUMENT ?? 'BTC-USDT-SWAP';
  if (inputPath === undefined || inputPath.trim().length === 0) {
    throw new Error(
      'Usage: npm run backtest -- <dataset.json|candles.json|candles.ndjson> [instrumentId]',
    );
  }

  const inputContent = await readFile(inputPath, 'utf8');
  const parsedInput = parsePlatformBacktestInput(inputContent);
  if (
    parsedInput.instrumentSpecification === null ||
    parsedInput.createdAt === null
  ) {
    throw new Error(
      'legacy candle-only inputs cannot model instrument constraints; use a versioned dataset document',
    );
  }
  const inputFingerprint = createHash('sha256')
    .update(inputContent, 'utf8')
    .digest('hex');
  const engine = new PlatformBacktestEngine();
  const report = engine.run({
    instrumentId,
    instrumentSpecification: parsedInput.instrumentSpecification,
    candles: parsedInput.candles,
    fundingEvents: parsedInput.fundingEvents,
    inputFingerprint,
    config: tradingStrategyConfig,
  });
  const outputDirectory =
    process.env.BACKTEST_OUTPUT_DIR ?? 'artifacts/backtest';
  await mkdir(outputDirectory, { recursive: true });
  const stem = basename(inputPath).replace(/\.[^.]+$/u, '');
  const reportPath = join(
    outputDirectory,
    `${stem}-${instrumentId}-report.json`,
  );
  const tradesPath = join(
    outputDirectory,
    `${stem}-${instrumentId}-trades.csv`,
  );
  const equityPath = join(
    outputDirectory,
    `${stem}-${instrumentId}-equity.csv`,
  );
  const manifestPath = join(
    outputDirectory,
    `${stem}-${instrumentId}-manifest.json`,
  );
  const manifest = createBacktestDatasetManifest({
    datasetId: parsedInput.datasetId,
    instrumentId,
    sourceSha256: inputFingerprint,
    createdAt: parsedInput.createdAt,
    expectedCandleIntervalMs: parsedInput.expectedCandleIntervalMs,
    candles: parsedInput.candles,
    fundingEvents: parsedInput.fundingEvents,
  });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(tradesPath, engine.exportTradesCsv(report), 'utf8');
  await writeFile(equityPath, equityCsv(report.equityCurve), 'utf8');
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  console.log('PLATFORM BACKTEST COMPLETE');
  console.log(`Strategy: ${report.strategyId}`);
  console.log(`Instrument: ${report.instrumentId}`);
  console.log(`Input SHA-256: ${report.inputFingerprint ?? 'UNAVAILABLE'}`);
  console.log(`Candles: ${report.candleCount}`);
  console.log(`Funding events applied: ${report.appliedFundingEventCount}`);
  console.log(`Dataset quality: ${manifest.qualityStatus}`);
  console.log(`Trades: ${report.trades.length}`);
  console.log(`Net return: ${report.netReturnPercent.toFixed(4)}%`);
  console.log(`Buy & hold: ${report.buyAndHold.returnPercent.toFixed(4)}%`);
  console.log(
    `Max drawdown: ${report.analytics.maximumDrawdownPercent.toFixed(4)}%`,
  );
  console.log(`Report: ${reportPath}`);
  console.log(`Trades CSV: ${tradesPath}`);
  console.log(`Equity CSV: ${equityPath}`);
  console.log(`Dataset manifest: ${manifestPath}`);
  console.log('Historical results do not establish future profitability.');
};

if (require.main === module) {
  void runPlatformBacktestCli().catch((error: unknown) => {
    console.error('Platform backtest failed:', error);
    process.exitCode = 1;
  });
}
