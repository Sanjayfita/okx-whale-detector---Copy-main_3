import type { OKXOrderBookUpdate } from '../clients/okx/OKXWebSocketClient';
import { appConfig } from '../config/appConfig';
import { performanceConfig } from '../config/performanceConfig';
import { MarketState } from '../core/MarketState';
import { PipelineProfiler } from '../core/PipelineProfiler';
import { ProcessingMonitor } from '../core/ProcessingMonitor';
import { SummaryThrottle } from '../core/SummaryThrottle';
import { MarketEngine } from '../market/MarketEngine';
import { MarketReporter } from '../reporting/MarketReporter';
import type { OrderBookLevel } from '../types/orderbook';

export type WhaleTrackerBenchmarkPattern =
  | 'irrelevant'
  | 'exact-whale'
  | 'removal'
  | 'nearby-movement'
  | 'many-movements'
  | 'snapshot';

export type WhaleTrackerBenchmarkActiveState = 'few' | 'many';

export interface WhaleTrackerBenchmarkMetric {
  readonly samples: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maximumMs: number;
  readonly throughputPerSecond: number;
}

export interface WhaleTrackerBenchmarkResult {
  readonly depthPerSide: number;
  readonly activeState: WhaleTrackerBenchmarkActiveState;
  readonly pattern: WhaleTrackerBenchmarkPattern;
  readonly wallDetector: WhaleTrackerBenchmarkMetric;
  readonly whaleTracker: WhaleTrackerBenchmarkMetric;
  readonly combinedDetectors: WhaleTrackerBenchmarkMetric;
  readonly marketEngine: WhaleTrackerBenchmarkMetric;
}

export interface WhaleTrackerBenchmarkOptions {
  readonly depths?: readonly number[];
  readonly activeStates?: readonly WhaleTrackerBenchmarkActiveState[];
  readonly patterns?: readonly WhaleTrackerBenchmarkPattern[];
  readonly samples?: number;
  readonly warmups?: number;
}

const DEFAULT_DEPTHS = [50, 100, 200, 400] as const;
const DEFAULT_ACTIVE_STATES = ['few', 'many'] as const;
const DEFAULT_PATTERNS: readonly WhaleTrackerBenchmarkPattern[] = [
  'irrelevant',
  'exact-whale',
  'removal',
  'nearby-movement',
  'many-movements',
  'snapshot',
];
const DEFAULT_SAMPLES = 50;
const DEFAULT_WARMUPS = 10;
const SYMBOL = 'WHALE-BENCH-USDT';

interface BenchmarkSides {
  readonly bids: OrderBookLevel[];
  readonly asks: OrderBookLevel[];
}

interface MutableTimings {
  wallDetector: number[];
  whaleTracker: number[];
  combinedDetectors: number[];
  marketEngine: number[];
}

const level = (price: number, size: number): OrderBookLevel => [
  String(price),
  String(size),
  '0',
  '1',
];

const isQualifyingIndex = (
  index: number,
  depth: number,
  activeState: WhaleTrackerBenchmarkActiveState,
): boolean => (activeState === 'many' ? index < depth - 1 : index === 0);

const createSides = (
  depth: number,
  activeState: WhaleTrackerBenchmarkActiveState,
  tick: number,
  qualifyingPriceShift = 0,
): BenchmarkSides => {
  const bids: OrderBookLevel[] = [];
  const asks: OrderBookLevel[] = [];

  for (let index = 0; index < depth; index += 1) {
    const qualifying = isQualifyingIndex(index, depth, activeState);
    const size = qualifying ? 6_000 + (tick % 3) : 100 + (tick % 2);
    const shift = qualifying ? qualifyingPriceShift : 0;

    bids.push(level(100 - index * 0.01 + shift, size));
    asks.push(level(100.01 + index * 0.01 + shift, size));
  }

  return { bids, asks };
};

const percentile = (sorted: readonly number[], quantile: number): number => {
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);

  return sorted[index] ?? 0;
};

const summarize = (values: readonly number[]): WhaleTrackerBenchmarkMetric => {
  const sorted = [...values].sort((left, right) => left - right);
  const totalMs = values.reduce((total, value) => total + value, 0);

  return {
    samples: values.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    maximumMs: sorted[sorted.length - 1] ?? 0,
    throughputPerSecond:
      values.length / Math.max(totalMs / 1_000, Number.EPSILON),
  };
};

const validatePositiveInteger = (name: string, value: number): void => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
};

const validateNonNegativeInteger = (name: string, value: number): void => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
};

const qualifyingRemovals = (
  sides: BenchmarkSides,
  depth: number,
  activeState: WhaleTrackerBenchmarkActiveState,
): BenchmarkSides => ({
  bids: sides.bids
    .filter((_, index) => isQualifyingIndex(index, depth, activeState))
    .map((entry) => level(Number(entry[0]), 0)),
  asks: sides.asks
    .filter((_, index) => isQualifyingIndex(index, depth, activeState))
    .map((entry) => level(Number(entry[0]), 0)),
});

const runScenario = (
  depth: number,
  activeState: WhaleTrackerBenchmarkActiveState,
  pattern: WhaleTrackerBenchmarkPattern,
  samples: number,
  warmups: number,
): WhaleTrackerBenchmarkResult => {
  const state = new MarketState(
    {
      ...appConfig,
      history: {
        ...appConfig.history,
        orderBookLevelLimit: depth,
      },
    },
    {
      instId: SYMBOL,
      instType: 'SPOT',
      quoteCurrency: 'USDT',
      baseUnitsPerSize: 1,
    },
  );
  const engine = new MarketEngine(
    new Map([[SYMBOL, state]]),
    new SummaryThrottle(Number.MAX_SAFE_INTEGER),
    new MarketReporter(() => undefined),
    new ProcessingMonitor(
      {
        ...performanceConfig,
        slowUpdateThresholdMs: Number.MAX_SAFE_INTEGER,
      },
      () => undefined,
    ),
    new PipelineProfiler({ enabled: false }),
  );
  const timings: MutableTimings = {
    wallDetector: [],
    whaleTracker: [],
    combinedDetectors: [],
    marketEngine: [],
  };
  const originalWhaleScan = state.whaleTracker.scan.bind(state.whaleTracker);
  const originalWallDetect = state.wallDetector.detect.bind(state.wallDetector);
  let latestWhaleTrackerMs = 0;
  let latestWallDetectorMs = 0;

  state.whaleTracker.scan = (orderBook) => {
    const startedAt = performance.now();
    const result = originalWhaleScan(orderBook);
    latestWhaleTrackerMs = performance.now() - startedAt;

    return result;
  };
  state.wallDetector.detect = (orderBook) => {
    const startedAt = performance.now();
    const result = originalWallDetect(orderBook);
    latestWallDetectorMs = performance.now() - startedAt;

    return result;
  };

  let sequence = 1;
  let removed = false;
  let priceShift = 0;
  let currentSides = createSides(depth, activeState, 0);

  engine.processOrderBookUpdate({
    instId: SYMBOL,
    action: 'snapshot',
    ...currentSides,
    timestamp: sequence,
    seqId: sequence,
    prevSeqId: -1,
  });

  const processUpdate = (iteration: number, record: boolean): void => {
    sequence += 1;
    let action: OKXOrderBookUpdate['action'] = 'update';
    let bids: OrderBookLevel[] = [];
    let asks: OrderBookLevel[] = [];
    let previousSequence = sequence - 1;

    switch (pattern) {
      case 'irrelevant': {
        const index = depth - 1;
        bids = [level(100 - index * 0.01, 100 + (iteration % 2))];
        break;
      }
      case 'exact-whale':
        bids = [level(100, 6_000 + (iteration % 200))];
        break;
      case 'removal':
        removed = !removed;
        bids = [level(100, removed ? 0 : 6_000)];
        break;
      case 'nearby-movement': {
        const previousPrice = priceShift === 0 ? 100 : 100.005;
        priceShift = priceShift === 0 ? 0.005 : 0;
        bids = [
          level(previousPrice, 0),
          level(100 + priceShift, 6_000 + (iteration % 20)),
        ];
        break;
      }
      case 'many-movements': {
        const previousSides = currentSides;
        priceShift = priceShift === 0 ? 0.001 : 0;
        currentSides = createSides(depth, activeState, iteration, priceShift);
        const removals = qualifyingRemovals(previousSides, depth, activeState);
        bids = [...removals.bids, ...currentSides.bids];
        asks = [...removals.asks, ...currentSides.asks];
        break;
      }
      case 'snapshot':
        action = 'snapshot';
        previousSequence = -1;
        currentSides = createSides(depth, activeState, iteration);
        bids = currentSides.bids;
        asks = currentSides.asks;
        break;
    }

    const startedAt = performance.now();

    engine.processOrderBookUpdate({
      instId: SYMBOL,
      action,
      bids,
      asks,
      timestamp: sequence,
      seqId: sequence,
      prevSeqId: previousSequence,
    });

    const marketEngineMs = performance.now() - startedAt;

    if (!record) {
      return;
    }

    timings.wallDetector.push(latestWallDetectorMs);
    timings.whaleTracker.push(latestWhaleTrackerMs);
    timings.combinedDetectors.push(latestWallDetectorMs + latestWhaleTrackerMs);
    timings.marketEngine.push(marketEngineMs);
  };

  for (let iteration = 0; iteration < warmups; iteration += 1) {
    processUpdate(iteration, false);
  }

  for (let iteration = 0; iteration < samples; iteration += 1) {
    processUpdate(iteration + warmups, true);
  }

  return {
    depthPerSide: depth,
    activeState,
    pattern,
    wallDetector: summarize(timings.wallDetector),
    whaleTracker: summarize(timings.whaleTracker),
    combinedDetectors: summarize(timings.combinedDetectors),
    marketEngine: summarize(timings.marketEngine),
  };
};

export const runWhaleTrackerBenchmark = (
  options: WhaleTrackerBenchmarkOptions = {},
): readonly WhaleTrackerBenchmarkResult[] => {
  const depths = options.depths ?? DEFAULT_DEPTHS;
  const activeStates = options.activeStates ?? DEFAULT_ACTIVE_STATES;
  const patterns = options.patterns ?? DEFAULT_PATTERNS;
  const samples = options.samples ?? DEFAULT_SAMPLES;
  const warmups = options.warmups ?? DEFAULT_WARMUPS;

  validatePositiveInteger('samples', samples);
  validateNonNegativeInteger('warmups', warmups);

  for (const depth of depths) {
    validatePositiveInteger('depth', depth);
  }

  const results: WhaleTrackerBenchmarkResult[] = [];

  for (const depth of depths) {
    for (const activeState of activeStates) {
      for (const pattern of patterns) {
        results.push(
          runScenario(depth, activeState, pattern, samples, warmups),
        );
      }
    }
  }

  return results;
};

const formatMetric = (metric: WhaleTrackerBenchmarkMetric): string =>
  `p50=${metric.p50Ms.toFixed(4)}ms ` +
  `p95=${metric.p95Ms.toFixed(4)}ms ` +
  `p99=${metric.p99Ms.toFixed(4)}ms ` +
  `max=${metric.maximumMs.toFixed(4)}ms ` +
  `throughput=${metric.throughputPerSecond.toFixed(2)}/s`;

export const runWhaleTrackerPerformanceReport = (
  args: readonly string[] = process.argv.slice(2),
): void => {
  const samples = Number(
    args.find((argument) => /^\d+$/.test(argument)) ?? DEFAULT_SAMPLES,
  );
  const results = runWhaleTrackerBenchmark({ samples });

  console.log('\nWHALE TRACKER ALLOCATION PERFORMANCE REPORT');
  console.log(
    `Scenarios=${results.length} samples=${samples} warmups=${DEFAULT_WARMUPS}`,
  );

  for (const result of results) {
    console.log(
      `\ndepth=${result.depthPerSide} active=${result.activeState} ` +
        `pattern=${result.pattern}`,
    );
    console.log(`  whaleTracker     ${formatMetric(result.whaleTracker)}`);
    console.log(`  wallDetector     ${formatMetric(result.wallDetector)}`);
    console.log(`  combined         ${formatMetric(result.combinedDetectors)}`);
    console.log(`  marketEngine     ${formatMetric(result.marketEngine)}`);
  }
};

if (require.main === module) {
  try {
    runWhaleTrackerPerformanceReport();
  } catch (error: unknown) {
    console.error(
      'WhaleTracker performance report failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  }
}
