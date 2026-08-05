import { Console } from 'node:console';
import { Writable } from 'node:stream';

import type { OKXOrderBookUpdate } from '../clients/okx/OKXWebSocketClient';
import { appConfig } from '../config/appConfig';
import { performanceConfig } from '../config/performanceConfig';
import { MarketState } from '../core/MarketState';
import { PipelineProfiler } from '../core/PipelineProfiler';
import { ProcessingMonitor } from '../core/ProcessingMonitor';
import { SummaryThrottle } from '../core/SummaryThrottle';
import {
  MarketEngine,
  prepareMarketSummaryAggregates,
} from '../market/MarketEngine';
import {
  MarketReporter,
  type MarketSummaryInput,
} from '../reporting/MarketReporter';
import type { WhaleScore } from '../core/WhaleScoreEngine';
import type { MarketInstrumentConfig } from '../types/instrument';
import type { OrderBookLevel } from '../types/orderbook';
import { WallSide, WallStatus, type Wall } from '../types/wall';
import type { Whale } from '../types/whale';

interface ScenarioResult {
  name: string;
  updates: number;
  elapsedMs: number;
  throughput: number;
  profile: PipelineProfiler;
  emittedCharacters: number;
}

export interface FormattingBenchmarkResult {
  readonly scoredWhales: number;
  readonly samples: number;
  readonly medianMs: number;
  readonly p95Ms: number;
}

export interface SummaryEmissionBenchmarkMetric {
  readonly samples: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maximumMs: number;
}

export interface SummaryEmissionBenchmarkResult {
  readonly scoredWhales: number;
  readonly logger: 'buffered' | 'captured-console';
  readonly legacyCalls: number;
  readonly blockCalls: number;
  readonly legacyBytes: number;
  readonly blockBytes: number;
  readonly legacy: SummaryEmissionBenchmarkMetric;
  readonly block: SummaryEmissionBenchmarkMetric;
}

const SYMBOLS = ['PERF-A-USDT', 'PERF-B-USDT', 'PERF-C-USDT'] as const;
const DEPTH = 100;
const FORMATTING_BENCHMARK_COUNTS = [0, 10, 100, 200] as const;
const FORMATTING_BENCHMARK_SAMPLES = 100;
const FORMATTING_BENCHMARK_WARMUPS = 20;

class SilentMarketReporter extends MarketReporter {
  public override reportSequenceGap(): void {}
  public override reportBehavior(): void {}
  public override reportSpoof(): void {}
  public override reportWhaleEvent(): void {}
  public override reportRefill(): void {}
  public override reportMovedWhale(): void {}
  public override reportWhaleScore(): void {}
  public override reportSummary(): void {}
}

class BenchmarkMarketReporter extends MarketReporter {
  public getSummaryLines(input: MarketSummaryInput): readonly string[] {
    return this.formatSummary(input);
  }
}

class CapturedConsoleStream extends Writable {
  public emittedBytes = 0;

  public override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.emittedBytes += Buffer.byteLength(chunk);
    callback();
  }
}

const level = (price: number, size: number): OrderBookLevel => [
  String(price),
  String(size),
  '0',
  '1',
];

const instrument = (instId: string): MarketInstrumentConfig => ({
  instId,
  instType: 'SPOT',
  quoteCurrency: 'USDT',
  baseUnitsPerSize: 1,
});

const benchmarkWhale = (index: number): Whale => ({
  wallId: `benchmark-wall-${index}`,
  side: index % 2 === 0 ? 'BID' : 'ASK',
  price: 64_000.12345 + index * 0.01,
  size: 10 + index,
  notionalQuote: 1_000_000 + index * 1_000,
  quoteCurrency: 'USDT',
  detectedAt: 1_700_000_000_000,
});

const benchmarkScore = (index: number): WhaleScore => ({
  whale: benchmarkWhale(index),
  totalScore: 75,
  strength: 'STRONG',
  components: {
    sizeScore: 25,
    distanceScore: 20,
    persistenceScore: 15,
    stabilityScore: 15,
  },
  explanation: ['Deterministic formatting benchmark'],
});

const benchmarkWall = (index: number): Wall => ({
  wallId: `benchmark-wall-${index}`,
  side: index % 2 === 0 ? WallSide.BUY : WallSide.SELL,
  initialPrice: 64_000 + index * 0.01,
  currentPrice: 64_000 + index * 0.01,
  initialNotional: 1_000_000 + index * 1_000,
  currentNotional: 1_000_000 + index * 1_000,
  highestNotional: 1_000_000 + index * 1_000,
  lowestNotional: 1_000_000 + index * 1_000,
  firstSeen: 1_700_000_000_000,
  lastSeen: 1_700_000_000_000,
  ageMs: 0,
  priceMovementPercent: 0,
  notionalChangePercent: 0,
  status: [
    WallStatus.NEW,
    WallStatus.ACTIVE,
    WallStatus.PERSISTENT,
    WallStatus.STRONG,
  ][index % 4] as WallStatus,
});

const formattingBenchmarkInput = (
  scoredWhaleCount: number,
): MarketSummaryInput => {
  const scoredWhales = Array.from({ length: scoredWhaleCount }, (_, index) =>
    benchmarkScore(index),
  );
  const activeWhales = scoredWhales.map((score) => score.whale);
  const walls = Array.from({ length: scoredWhaleCount }, (_, index) =>
    benchmarkWall(index),
  );

  return {
    symbol: 'BTC-USDT',
    currentPrice: 64_000.125,
    bestBidPrice: 64_000.12,
    bestAskPrice: 64_000.13,
    aggregates: prepareMarketSummaryAggregates(
      {
        active: activeWhales,
        totalBidNotionalQuote: activeWhales
          .filter((whale) => whale.side === 'BID')
          .reduce((total, whale) => total + whale.notionalQuote, 0),
        totalAskNotionalQuote: activeWhales
          .filter((whale) => whale.side === 'ASK')
          .reduce((total, whale) => total + whale.notionalQuote, 0),
      },
      walls,
    ),
    scoredWhales,
    marketSignal: {
      bias: 'NEUTRAL',
      confidence: 0,
      reason: 'Deterministic formatting benchmark',
      bidPressure: 0,
      askPressure: 0,
    },
  };
};

export const runFormattingBenchmark =
  (): readonly FormattingBenchmarkResult[] => {
    const reporter = new MarketReporter(() => undefined);

    return FORMATTING_BENCHMARK_COUNTS.map((scoredWhales) => {
      const input = formattingBenchmarkInput(scoredWhales);

      for (let sample = 0; sample < FORMATTING_BENCHMARK_WARMUPS; sample += 1) {
        reporter.reportSummary(input);
      }

      const profiler = new PipelineProfiler({
        enabled: true,
        maximumSamplesPerStage: FORMATTING_BENCHMARK_SAMPLES,
      });

      for (let sample = 0; sample < FORMATTING_BENCHMARK_SAMPLES; sample += 1) {
        reporter.reportSummary(input, profiler);
      }

      const formatting = profiler.getRecentStage('summary.formatting');

      if (!formatting) {
        throw new Error('Summary formatting benchmark did not record timings');
      }

      return {
        scoredWhales,
        samples: formatting.count,
        medianMs: formatting.p50Ms,
        p95Ms: formatting.p95Ms,
      };
    });
  };

const percentile = (sorted: readonly number[], quantile: number): number => {
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);

  return sorted[index] ?? 0;
};

const summarizeEmission = (
  samples: readonly number[],
): SummaryEmissionBenchmarkMetric => {
  const sorted = [...samples].sort((left, right) => left - right);

  return {
    samples: samples.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maximumMs: sorted[sorted.length - 1] ?? 0,
  };
};

const createEmissionLogger = (
  logger: SummaryEmissionBenchmarkResult['logger'],
): {
  emit: (message: string) => void;
  getCalls: () => number;
  getEmittedBytes: () => number;
} => {
  let calls = 0;

  if (logger === 'buffered') {
    let emittedBytes = 0;

    return {
      emit: (message) => {
        calls += 1;
        emittedBytes += Buffer.byteLength(message) + 1;
      },
      getCalls: () => calls,
      getEmittedBytes: () => emittedBytes,
    };
  }

  const stream = new CapturedConsoleStream();
  const capturedConsole = new Console({
    stdout: stream,
    stderr: stream,
    colorMode: false,
  });

  return {
    emit: (message) => {
      calls += 1;
      capturedConsole.log(message);
    },
    getCalls: () => calls,
    getEmittedBytes: () => stream.emittedBytes,
  };
};

const benchmarkEmission = (
  operation: (emit: (message: string) => void) => void,
  logger: SummaryEmissionBenchmarkResult['logger'],
): {
  callsPerSummary: number;
  bytesPerSummary: number;
  metric: SummaryEmissionBenchmarkMetric;
} => {
  const sink = createEmissionLogger(logger);

  for (let sample = 0; sample < FORMATTING_BENCHMARK_WARMUPS; sample += 1) {
    operation(sink.emit);
  }

  const callsAfterWarmup = sink.getCalls();
  const bytesAfterWarmup = sink.getEmittedBytes();
  const samples: number[] = [];

  for (let sample = 0; sample < FORMATTING_BENCHMARK_SAMPLES; sample += 1) {
    const startedAt = performance.now();

    operation(sink.emit);
    samples.push(performance.now() - startedAt);
  }

  return {
    callsPerSummary:
      (sink.getCalls() - callsAfterWarmup) / FORMATTING_BENCHMARK_SAMPLES,
    bytesPerSummary:
      (sink.getEmittedBytes() - bytesAfterWarmup) /
      FORMATTING_BENCHMARK_SAMPLES,
    metric: summarizeEmission(samples),
  };
};

export const runSummaryEmissionBenchmark =
  (): readonly SummaryEmissionBenchmarkResult[] => {
    const reporter = new BenchmarkMarketReporter(() => undefined);
    const results: SummaryEmissionBenchmarkResult[] = [];

    for (const scoredWhales of FORMATTING_BENCHMARK_COUNTS) {
      const lines = reporter.getSummaryLines(
        formattingBenchmarkInput(scoredWhales),
      );

      for (const logger of ['buffered', 'captured-console'] as const) {
        const legacy = benchmarkEmission((emit) => {
          for (const line of lines) {
            emit(line);
          }
        }, logger);
        const block = benchmarkEmission(
          (emit) => emit(lines.join('\n')),
          logger,
        );

        results.push({
          scoredWhales,
          logger,
          legacyCalls: legacy.callsPerSummary,
          blockCalls: block.callsPerSummary,
          legacyBytes: legacy.bytesPerSummary,
          blockBytes: block.bytesPerSummary,
          legacy: legacy.metric,
          block: block.metric,
        });
      }
    }

    return results;
  };

const snapshot = (symbol: string, basePrice: number): OKXOrderBookUpdate => ({
  instId: symbol,
  action: 'snapshot',
  bids: Array.from({ length: DEPTH }, (_, index) =>
    level(basePrice - index * 0.01, index % 10 === 0 ? 6_000 : 100),
  ),
  asks: Array.from({ length: DEPTH }, (_, index) =>
    level(basePrice + 0.01 + index * 0.01, index % 10 === 0 ? 6_000 : 100),
  ),
  timestamp: 1,
  seqId: 1,
  prevSeqId: -1,
});

const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

const runScenario = async (
  name: string,
  updates: number,
  options: {
    instrumentationEnabled: boolean;
    summaryEnabled: boolean;
    consoleEnabled: boolean;
    burstSize: number;
  },
): Promise<ScenarioResult> => {
  const states = new Map(
    SYMBOLS.map((symbol) => [
      symbol,
      new MarketState(appConfig, instrument(symbol)),
    ]),
  );
  const profiler = new PipelineProfiler({
    enabled: options.instrumentationEnabled,
    maximumSamplesPerStage: performanceConfig.maximumSamplesPerStage,
    maximumStages: performanceConfig.maximumProfiledStages,
  });
  let emittedCharacters = 0;
  const logger = options.consoleEnabled
    ? console.log
    : (message: string): void => {
        emittedCharacters += message.length;
      };
  const reporter = options.summaryEnabled
    ? new MarketReporter(logger)
    : new SilentMarketReporter();
  const engine = new MarketEngine(
    states,
    new SummaryThrottle(options.summaryEnabled ? 0 : Number.MAX_SAFE_INTEGER),
    reporter,
    new ProcessingMonitor(
      {
        ...performanceConfig,
        slowUpdateThresholdMs: Number.MAX_SAFE_INTEGER,
      },
      () => undefined,
    ),
    profiler,
  );
  const sequenceBySymbol = new Map<string, number>();

  for (const [index, symbol] of SYMBOLS.entries()) {
    engine.processOrderBookUpdate(snapshot(symbol, 100 + index * 10));
    sequenceBySymbol.set(symbol, 1);
  }

  const startedAt = performance.now();

  for (let index = 0; index < updates; index += 1) {
    const symbol = SYMBOLS[index % SYMBOLS.length] ?? SYMBOLS[0];
    const symbolIndex = SYMBOLS.indexOf(symbol);
    const basePrice = 100 + symbolIndex * 10;
    const previousSequence = sequenceBySymbol.get(symbol) ?? 1;
    const sequence = previousSequence + 1;
    const depthIndex = index % DEPTH;

    engine.processOrderBookUpdate({
      instId: symbol,
      action: 'update',
      bids: [level(basePrice - depthIndex * 0.01, 5_000 + (index % 500))],
      asks: [
        level(basePrice + 0.01 + depthIndex * 0.01, 5_000 + (index % 700)),
      ],
      timestamp: sequence,
      seqId: sequence,
      prevSeqId: previousSequence,
    });
    sequenceBySymbol.set(symbol, sequence);

    if ((index + 1) % options.burstSize === 0) {
      await yieldToEventLoop();
    }
  }

  const elapsedMs = performance.now() - startedAt;

  return {
    name,
    updates,
    elapsedMs,
    throughput: updates / Math.max(elapsedMs / 1_000, 0.001),
    profile: profiler,
    emittedCharacters,
  };
};

const printScenario = (result: ScenarioResult): void => {
  console.log(
    `${result.name}: ${result.throughput.toFixed(2)} updates/s ` +
      `(${result.elapsedMs.toFixed(2)}ms, bufferedChars=${result.emittedCharacters})`,
  );

  for (const stage of result.profile.getRecentSnapshot().slice(0, 10)) {
    console.log(
      `  ${stage.stage.padEnd(42)} n=${stage.count.toString().padStart(3)} ` +
        `avg=${stage.averageMs.toFixed(4)}ms p50=${stage.p50Ms.toFixed(4)}ms ` +
        `p95=${stage.p95Ms.toFixed(4)}ms p99=${stage.p99Ms.toFixed(4)}ms ` +
        `max=${stage.maximumMs.toFixed(4)}ms`,
    );
  }
};

const combineScenarios = (
  name: string,
  results: readonly ScenarioResult[],
): ScenarioResult => {
  const updates = results.reduce((total, result) => total + result.updates, 0);
  const elapsedMs = results.reduce(
    (total, result) => total + result.elapsedMs,
    0,
  );
  const latest = results[results.length - 1];

  if (!latest) {
    throw new Error('At least one scenario result is required');
  }

  return {
    name,
    updates,
    elapsedMs,
    throughput: updates / Math.max(elapsedMs / 1_000, 0.001),
    profile: latest.profile,
    emittedCharacters: results.reduce(
      (total, result) => total + result.emittedCharacters,
      0,
    ),
  };
};

export const runPerformanceReport = async (
  args: readonly string[] = process.argv.slice(2),
): Promise<void> => {
  const updates = Number(
    args.find((argument) => /^\d+$/.test(argument)) ?? 3_000,
  );
  const consoleEnabled = args.includes('--console');

  if (!Number.isInteger(updates) || updates <= 0) {
    throw new Error(
      'Performance report update count must be a positive integer',
    );
  }

  const coreOptions = {
    summaryEnabled: false,
    consoleEnabled: false,
    burstSize: 100,
  };
  const warmupUpdates = Math.min(updates, 300);

  await runScenario('warmup/no-attribution', warmupUpdates, {
    ...coreOptions,
    instrumentationEnabled: false,
  });
  await runScenario('warmup/attribution', warmupUpdates, {
    ...coreOptions,
    instrumentationEnabled: true,
  });
  const baselineFirst = await runScenario('baseline/first', updates, {
    ...coreOptions,
    instrumentationEnabled: false,
  });
  const attributedFirst = await runScenario('attributed/first', updates, {
    ...coreOptions,
    instrumentationEnabled: true,
  });
  const attributedSecond = await runScenario('attributed/second', updates, {
    ...coreOptions,
    instrumentationEnabled: true,
  });
  const baselineSecond = await runScenario('baseline/second', updates, {
    ...coreOptions,
    instrumentationEnabled: false,
  });
  const baseline = combineScenarios('core/no-attribution', [
    baselineFirst,
    baselineSecond,
  ]);
  const attributed = combineScenarios('core/attribution', [
    attributedFirst,
    attributedSecond,
  ]);
  const summaryUpdates = Math.min(updates, 300);
  const summaries = await runScenario(
    'summary/buffered-console',
    summaryUpdates,
    {
      instrumentationEnabled: true,
      summaryEnabled: true,
      consoleEnabled: false,
      burstSize: 100,
    },
  );
  const terminalSummaries = consoleEnabled
    ? await runScenario(
        'summary/terminal-console',
        Math.min(summaryUpdates, 30),
        {
          instrumentationEnabled: true,
          summaryEnabled: true,
          consoleEnabled: true,
          burstSize: 100,
        },
      )
    : undefined;
  const overheadPercent =
    ((baseline.throughput - attributed.throughput) /
      Math.max(baseline.throughput, 0.001)) *
    100;
  const formattingBenchmark = runFormattingBenchmark();
  const emissionBenchmark = runSummaryEmissionBenchmark();

  console.log('\nLIVE PERFORMANCE ATTRIBUTION REPORT');
  console.log(
    `Symbols=${SYMBOLS.length} updates=${updates} burst=100 with controlled yields`,
  );
  printScenario(baseline);
  printScenario(attributed);
  printScenario(summaries);
  if (terminalSummaries) {
    printScenario(terminalSummaries);
  }
  console.log(
    `Attribution throughput impact: ${overheadPercent.toFixed(2)}% ` +
      '(positive means lower throughput with attribution)',
  );
  console.log('\nSUMMARY FORMATTING BENCHMARK');
  for (const result of formattingBenchmark) {
    console.log(
      `  scoredWhales=${result.scoredWhales.toString().padStart(3)} ` +
        `n=${result.samples} median=${result.medianMs.toFixed(4)}ms ` +
        `p95=${result.p95Ms.toFixed(4)}ms`,
    );
  }
  console.log('\nSUMMARY EMISSION BENCHMARK');
  for (const result of emissionBenchmark) {
    console.log(
      `  scoredWhales=${result.scoredWhales.toString().padStart(3)} ` +
        `logger=${result.logger.padEnd(16)} ` +
        `calls=${result.legacyCalls}->${result.blockCalls} ` +
        `bytes=${result.legacyBytes}=${result.blockBytes} ` +
        `legacy:p50=${result.legacy.p50Ms.toFixed(4)}ms/` +
        `p95=${result.legacy.p95Ms.toFixed(4)}ms/` +
        `p99=${result.legacy.p99Ms.toFixed(4)}ms ` +
        `block:p50=${result.block.p50Ms.toFixed(4)}ms/` +
        `p95=${result.block.p95Ms.toFixed(4)}ms/` +
        `p99=${result.block.p99Ms.toFixed(4)}ms`,
    );
  }
  console.log(
    'Timings are observed elapsed time and may include GC or OS scheduling; they do not prove CPU ownership.',
  );
};

if (require.main === module) {
  void runPerformanceReport().catch((error: unknown) => {
    console.error(
      'Performance report failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  });
}
