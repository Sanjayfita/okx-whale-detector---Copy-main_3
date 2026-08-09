import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import { appConfig } from '../config/appConfig';
import { resolveSymbolConfig } from '../config/symbolProfiles';
import { CandleUpdateHandler } from '../core/CandleUpdateHandler';
import { MarketState } from '../core/MarketState';
import { SummaryThrottle } from '../core/SummaryThrottle';
import { MarketEngine } from '../market/MarketEngine';
import { ReplayAnalyticsReporter } from '../recording/ReplayAnalyticsReporter';
import {
  calculateAnchoredReplayDelayMs,
  parseReplayOptions,
} from '../recording/replayOptions';
import {
  formatReplaySpeed,
  resolveReplayReportPath,
  writeReplayReport,
  type ReplaySymbolStats,
} from '../recording/replayReport';
import { MarketRecordingParser } from '../recording/recordingValidation';
import { ReplayClock, clockNow } from '../runtime/Clock';
import type { MarketInstrumentConfig } from '../types/instrument';

const wait = async (milliseconds: number): Promise<void> => {
  if (milliseconds <= 0) {
    return;
  }

  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

export const replayRecording = async (
  args: readonly string[],
): Promise<void> => {
  const options = parseReplayOptions(args);
  const replayClock = new ReplayClock();
  const runAtReplayTime = <T>(operation: () => T): T => {
    const restoreDateNow = replayClock.installDateNow();

    try {
      return operation();
    } finally {
      restoreDateNow();
    }
  };
  const instruments = new Map<string, MarketInstrumentConfig>();
  const marketStates = new Map<string, MarketState>();
  const symbolStats = new Map<string, ReplaySymbolStats>();
  const analyticsReporter = options.report
    ? new ReplayAnalyticsReporter()
    : undefined;
  const engine = new MarketEngine(
    marketStates,
    new SummaryThrottle(appConfig.reporting.summaryIntervalMs),
    analyticsReporter,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    clockNow(replayClock),
    'REPLAY',
  );
  const candleHandler = new CandleUpdateHandler(
    marketStates,
    options.report ? () => undefined : console.log,
  );

  let orderBookCount = 0;
  let candleCount = 0;
  let firstReplayRecordAt: number | undefined;
  let playbackStartedAt: number | undefined;
  const startedAt = performance.now();
  const input = createInterface({
    input: createReadStream(options.filePath, { encoding: 'utf8' }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  const recordingParser = new MarketRecordingParser();
  const initializeInstrument = (instrument: MarketInstrumentConfig): void => {
    if (options.symbol && instrument.instId !== options.symbol) {
      return;
    }

    instruments.set(instrument.instId, instrument);
    marketStates.set(
      instrument.instId,
      new MarketState(resolveSymbolConfig(instrument.instId), instrument),
    );
    symbolStats.set(instrument.instId, {
      orderBookUpdates: 0,
      candleUpdates: 0,
      finalActiveWhales: 0,
    });
  };

  for await (const line of input) {
    if (line.trim().length === 0) {
      continue;
    }

    const record = recordingParser.parseLine(line);
    replayClock.observe(record.recordedAt);

    if ('recordType' in record) {
      if (record.recordType === 'header') {
        for (const instrument of record.instruments) {
          initializeInstrument(instrument);
        }
      }

      continue;
    }

    if (record.type === 'instrument') {
      if (instruments.has(record.instrument.instId)) {
        continue;
      }

      initializeInstrument(record.instrument);
      continue;
    }

    const symbol =
      record.type === 'orderBook' ? record.update.instId : record.candle.instId;

    if (options.symbol && symbol !== options.symbol) {
      continue;
    }

    if (!instruments.has(symbol)) {
      throw new Error(`Recording is missing instrument metadata for ${symbol}`);
    }

    firstReplayRecordAt ??= record.recordedAt;
    playbackStartedAt ??= performance.now();

    const delayMs = calculateAnchoredReplayDelayMs(
      firstReplayRecordAt,
      record.recordedAt,
      performance.now() - playbackStartedAt,
      options.speed,
    );
    await wait(delayMs);

    const stats = symbolStats.get(symbol);
    if (!stats) {
      throw new Error(`Replay statistics were not initialized for ${symbol}`);
    }

    if (record.type === 'orderBook') {
      runAtReplayTime(() => engine.processOrderBookUpdate(record.update));
      orderBookCount += 1;
      stats.orderBookUpdates += 1;
    } else {
      runAtReplayTime(() => candleHandler.handle(record.candle));
      candleCount += 1;
      stats.candleUpdates += 1;
    }
  }

  recordingParser.finish();

  if (options.symbol && !instruments.has(options.symbol)) {
    throw new Error(`Recording does not contain instrument ${options.symbol}`);
  }

  for (const [symbol, state] of marketStates) {
    const stats = symbolStats.get(symbol);
    if (stats) {
      stats.finalActiveWhales = state.whaleTracker.getTrackedWalls().length;
    }
  }

  const elapsedMs = performance.now() - startedAt;
  const totalUpdates = orderBookCount + candleCount;
  const throughput = totalUpdates / Math.max(elapsedMs / 1_000, 0.001);

  console.log('\nREPLAY COMPLETE');
  console.log(`File: ${options.filePath}`);
  console.log(`Markets: ${marketStates.size}`);
  console.log(`Symbol filter: ${options.symbol ?? 'all'}`);
  console.log(`Speed: ${formatReplaySpeed(options.speed)}`);
  console.log(`Order-book updates: ${orderBookCount.toLocaleString('en-US')}`);
  console.log(`Candle updates: ${candleCount.toLocaleString('en-US')}`);
  console.log(`Elapsed: ${elapsedMs.toFixed(2)}ms`);
  console.log(`Replay throughput: ${throughput.toFixed(2)} updates/s`);

  if (options.report && analyticsReporter) {
    const reportPath = resolveReplayReportPath(
      options.filePath,
      options.reportPath,
    );
    writeReplayReport(reportPath, {
      generatedAt: new Date().toISOString(),
      recordingFile: options.filePath,
      symbolFilter: options.symbol ?? null,
      speed: formatReplaySpeed(options.speed),
      markets: marketStates.size,
      orderBookUpdates: orderBookCount,
      candleUpdates: candleCount,
      totalUpdates,
      elapsedMs,
      throughputUpdatesPerSecond: throughput,
      events: analyticsReporter.getTotals(),
      pipeline: engine.getPipelineProfile(),
      symbols: Object.fromEntries(symbolStats),
    });
    console.log(`Report: ${reportPath}`);
  }
};

if (require.main === module) {
  void replayRecording(process.argv.slice(2)).catch((error: unknown) => {
    console.error('Replay failed:', error);
    process.exitCode = 1;
  });
}
