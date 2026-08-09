import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  PlatformBacktestEngine,
  type HistoricalBacktestCandle,
} from '../backtest/PlatformBacktestEngine';
import { tradingStrategyConfig } from '../config/tradingStrategyConfig';

const parseCandles = (content: string): readonly HistoricalBacktestCandle[] => {
  const trimmed = content.trim();
  if (trimmed.length === 0) return [];
  const parsed: unknown = trimmed.startsWith('[')
    ? (JSON.parse(trimmed) as unknown)
    : trimmed.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as unknown);
  if (!Array.isArray(parsed)) throw new Error('backtest input must be a JSON array or NDJSON records');

  return parsed.map((value, index) => {
    if (typeof value !== 'object' || value === null) {
      throw new Error(`candle ${index} must be an object`);
    }
    const record = value as Record<string, unknown>;
    const numberField = (key: string): number => {
      const field = record[key];
      if (typeof field !== 'number' || !Number.isFinite(field)) {
        throw new Error(`candle ${index}.${key} must be a finite number`);
      }
      return field;
    };
    const fundingRatePercent = record.fundingRatePercent;
    return {
      timestamp: numberField('timestamp'),
      open: numberField('open'),
      high: numberField('high'),
      low: numberField('low'),
      close: numberField('close'),
      confirm: record.confirm === undefined ? true : record.confirm === true,
      ...(fundingRatePercent === undefined
        ? {}
        : {
            fundingRatePercent:
              typeof fundingRatePercent === 'number' && Number.isFinite(fundingRatePercent)
                ? fundingRatePercent
                : (() => {
                    throw new Error(`candle ${index}.fundingRatePercent must be finite`);
                  })(),
          }),
    };
  });
};

const equityCsv = (
  points: readonly { readonly timestamp: number; readonly equity: number }[],
): string =>
  `timestamp,equity\n${points.map((point) => `${point.timestamp},${point.equity}`).join('\n')}${points.length > 0 ? '\n' : ''}`;

export const runPlatformBacktestCli = async (
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> => {
  const inputPath = argv[0] ?? process.env.BACKTEST_INPUT;
  const instrumentId = argv[1] ?? process.env.BACKTEST_INSTRUMENT ?? 'BTC-USDT-SWAP';
  if (inputPath === undefined || inputPath.trim().length === 0) {
    throw new Error(
      'Usage: npm run backtest -- <candles.json|candles.ndjson> [instrumentId]',
    );
  }

  const candles = parseCandles(await readFile(inputPath, 'utf8'));
  const engine = new PlatformBacktestEngine();
  const report = engine.run({
    instrumentId,
    candles,
    config: tradingStrategyConfig,
  });
  const outputDirectory = process.env.BACKTEST_OUTPUT_DIR ?? 'artifacts/backtest';
  await mkdir(outputDirectory, { recursive: true });
  const stem = basename(inputPath).replace(/\.[^.]+$/u, '');
  const reportPath = join(outputDirectory, `${stem}-${instrumentId}-report.json`);
  const tradesPath = join(outputDirectory, `${stem}-${instrumentId}-trades.csv`);
  const equityPath = join(outputDirectory, `${stem}-${instrumentId}-equity.csv`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(tradesPath, engine.exportTradesCsv(report), 'utf8');
  await writeFile(equityPath, equityCsv(report.equityCurve), 'utf8');

  console.log('PLATFORM BACKTEST COMPLETE');
  console.log(`Strategy: ${report.strategyId}`);
  console.log(`Instrument: ${report.instrumentId}`);
  console.log(`Candles: ${report.candleCount}`);
  console.log(`Trades: ${report.trades.length}`);
  console.log(`Net return: ${report.netReturnPercent.toFixed(4)}%`);
  console.log(`Buy & hold: ${report.buyAndHold.returnPercent.toFixed(4)}%`);
  console.log(`Max drawdown: ${report.analytics.maximumDrawdownPercent.toFixed(4)}%`);
  console.log(`Report: ${reportPath}`);
  console.log(`Trades CSV: ${tradesPath}`);
  console.log(`Equity CSV: ${equityPath}`);
  console.log('Historical results do not establish future profitability.');
};

if (require.main === module) {
  void runPlatformBacktestCli().catch((error: unknown) => {
    console.error('Platform backtest failed:', error);
    process.exitCode = 1;
  });
}
