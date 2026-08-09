import { appConfig } from '../config/appConfig';
import { performanceConfig } from '../config/performanceConfig';
import { BehaviorTransitionTracker } from '../core/BehaviorTransitionTracker';
import { MarketState } from '../core/MarketState';
import { PipelineProfiler } from '../core/PipelineProfiler';
import { ProcessingMonitor } from '../core/ProcessingMonitor';
import { SummaryThrottle } from '../core/SummaryThrottle';
import {
  WhaleBehaviorEngine,
  type WhaleBehavior,
} from '../core/WhaleBehaviorEngine';
import { MarketEngine } from '../market/MarketEngine';
import { MarketReporter } from '../reporting/MarketReporter';
import type { OrderBookLevel } from '../types/orderbook';
import type { Whale } from '../types/whale';

export type BehaviorTransitionBenchmarkPattern =
  | 'no-behaviors'
  | 'persistent-unchanged'
  | 'one-transition'
  | 'many-transitions'
  | 'mass-removals';

export interface BehaviorTransitionBenchmarkMetric {
  readonly samples: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maximumMs: number;
  readonly throughputPerSecond: number;
}

export interface BehaviorTransitionBenchmarkResult {
  readonly activeWhales: number;
  readonly pattern: BehaviorTransitionBenchmarkPattern;
  readonly transitionBookkeeping: BehaviorTransitionBenchmarkMetric;
  readonly fullBehaviorStage: BehaviorTransitionBenchmarkMetric;
}

export interface BehaviorMarketEngineBenchmarkResult {
  readonly activeWhales: number;
  readonly marketEngine: BehaviorTransitionBenchmarkMetric;
}

export interface BehaviorTransitionPerformanceResult {
  readonly behaviorScenarios: readonly BehaviorTransitionBenchmarkResult[];
  readonly marketEngineScenarios: readonly BehaviorMarketEngineBenchmarkResult[];
}

export interface BehaviorTransitionBenchmarkOptions {
  readonly activeWhaleCounts?: readonly number[];
  readonly patterns?: readonly BehaviorTransitionBenchmarkPattern[];
  readonly samples?: number;
  readonly warmups?: number;
}

const DEFAULT_ACTIVE_WHALE_COUNTS = [2, 20, 100, 200, 400, 800] as const;
const DEFAULT_PATTERNS: readonly BehaviorTransitionBenchmarkPattern[] = [
  'no-behaviors',
  'persistent-unchanged',
  'one-transition',
  'many-transitions',
  'mass-removals',
];
const DEFAULT_SAMPLES = 50;
const DEFAULT_WARMUPS = 10;
const SYMBOL = 'BEHAVIOR-BENCH-USDT';
const EMPTY_BEHAVIORS: WhaleBehavior[] = [];

const percentile = (sorted: readonly number[], quantile: number): number => {
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);

  return sorted[index] ?? 0;
};

const summarize = (
  values: readonly number[],
): BehaviorTransitionBenchmarkMetric => {
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

const createWhales = (count: number, ageSeconds: number): Whale[] =>
  Array.from({ length: count }, (_, index) => ({
    wallId: `wall-${index + 1}`,
    side: index % 2 === 0 ? 'BID' : 'ASK',
    price: 100 + index * 0.001,
    size: 10_000,
    notionalQuote: 1_000_000,
    quoteCurrency: 'USDT',
    detectedAt: 1_000,
    firstSeenAt: 1_000,
    lastSeenAt: 1_000,
    ageSeconds,
    updateCount: 1,
    maxNotionalQuote: 1_000_000,
  }));

const createBehavior = (whale: Whale): WhaleBehavior => ({
  type: 'PERSISTENT',
  whale,
  confidence: 80,
  reason: 'Persistent benchmark behavior',
  detectedAt: 1_000,
});

const createBehaviorInputs = (
  activeWhales: readonly Whale[],
): readonly WhaleBehavior[][] =>
  activeWhales.map((whale) => [createBehavior(whale)]);

const runTransitionPass = (
  tracker: BehaviorTransitionTracker,
  activeWhales: readonly Whale[],
  behaviorInputs: readonly WhaleBehavior[][],
  behaviorWhaleCount: number,
): void => {
  for (let index = 0; index < activeWhales.length; index += 1) {
    const currentWhale = activeWhales[index];

    if (!currentWhale) {
      continue;
    }

    tracker.getEnteredBehaviors(
      currentWhale,
      index < behaviorWhaleCount
        ? (behaviorInputs[index] ?? EMPTY_BEHAVIORS)
        : EMPTY_BEHAVIORS,
    );
  }
};

const runFullBehaviorStage = (
  engine: WhaleBehaviorEngine,
  tracker: BehaviorTransitionTracker,
  activeWhales: Whale[],
): void => {
  for (const currentWhale of activeWhales) {
    const currentBehaviors = engine.analyze(currentWhale);
    tracker.getEnteredBehaviors(currentWhale, currentBehaviors);
  }

  engine.prune(activeWhales);
  tracker.prune(activeWhales);
};

const benchmarkTransitionBookkeeping = (
  activeWhaleCount: number,
  pattern: BehaviorTransitionBenchmarkPattern,
  samples: number,
  warmups: number,
): BehaviorTransitionBenchmarkMetric => {
  const activeWhales = createWhales(activeWhaleCount, 30);
  const behaviorInputs = createBehaviorInputs(activeWhales);
  const values: number[] = [];
  const tracker = new BehaviorTransitionTracker();
  let behaviorsActive = false;

  if (pattern === 'persistent-unchanged') {
    runTransitionPass(tracker, activeWhales, behaviorInputs, activeWhaleCount);
  }

  const execute = (): number => {
    if (pattern === 'mass-removals') {
      const removalTracker = new BehaviorTransitionTracker();
      runTransitionPass(
        removalTracker,
        activeWhales,
        behaviorInputs,
        activeWhaleCount,
      );
      const startedAt = performance.now();

      removalTracker.prune([]);

      return performance.now() - startedAt;
    }

    let behaviorWhaleCount = 0;

    if (pattern === 'persistent-unchanged') {
      behaviorWhaleCount = activeWhaleCount;
    } else if (pattern === 'one-transition') {
      behaviorsActive = !behaviorsActive;
      behaviorWhaleCount = behaviorsActive ? 1 : 0;
    } else if (pattern === 'many-transitions') {
      behaviorsActive = !behaviorsActive;
      behaviorWhaleCount = behaviorsActive ? activeWhaleCount : 0;
    }

    const startedAt = performance.now();

    runTransitionPass(
      tracker,
      activeWhales,
      behaviorInputs,
      behaviorWhaleCount,
    );

    return performance.now() - startedAt;
  };

  for (let index = 0; index < warmups; index += 1) {
    execute();
  }

  for (let index = 0; index < samples; index += 1) {
    values.push(execute());
  }

  return summarize(values);
};

const benchmarkFullBehaviorStage = (
  activeWhaleCount: number,
  pattern: BehaviorTransitionBenchmarkPattern,
  samples: number,
  warmups: number,
): BehaviorTransitionBenchmarkMetric => {
  const activeWhales = createWhales(
    activeWhaleCount,
    pattern === 'persistent-unchanged' ? 30 : 0,
  );
  const engine = new WhaleBehaviorEngine();
  const tracker = new BehaviorTransitionTracker();
  const values: number[] = [];
  let behaviorsActive = false;

  runFullBehaviorStage(engine, tracker, activeWhales);

  const execute = (): number => {
    if (pattern === 'mass-removals') {
      const removalEngine = new WhaleBehaviorEngine();
      const removalTracker = new BehaviorTransitionTracker();
      const retained = createWhales(activeWhaleCount, 30);

      runFullBehaviorStage(removalEngine, removalTracker, retained);

      const startedAt = performance.now();

      runFullBehaviorStage(removalEngine, removalTracker, []);

      return performance.now() - startedAt;
    }

    if (pattern === 'one-transition' || pattern === 'many-transitions') {
      behaviorsActive = !behaviorsActive;
      const changedCount = pattern === 'one-transition' ? 1 : activeWhaleCount;

      for (let index = 0; index < changedCount; index += 1) {
        const currentWhale = activeWhales[index];

        if (currentWhale) {
          currentWhale.ageSeconds = behaviorsActive ? 30 : 0;
        }
      }
    }

    const startedAt = performance.now();

    runFullBehaviorStage(engine, tracker, activeWhales);

    return performance.now() - startedAt;
  };

  for (let index = 0; index < warmups; index += 1) {
    execute();
  }

  for (let index = 0; index < samples; index += 1) {
    values.push(execute());
  }

  return summarize(values);
};

const level = (price: number, size: number): OrderBookLevel => [
  String(price),
  String(size),
  '0',
  '1',
];

const benchmarkMarketEngine = (
  activeWhaleCount: number,
  samples: number,
  warmups: number,
): BehaviorTransitionBenchmarkMetric => {
  const bidCount = Math.ceil(activeWhaleCount / 2);
  const askCount = Math.floor(activeWhaleCount / 2);
  const depth = Math.max(bidCount, askCount, 1);
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
  const bids = Array.from({ length: bidCount }, (_, index) =>
    level(100 - index * 0.001, 10_000),
  );
  const asks = Array.from({ length: askCount }, (_, index) =>
    level(100.001 + index * 0.001, 10_000),
  );
  let sequence = 1;
  const values: number[] = [];

  engine.processOrderBookUpdate({
    instId: SYMBOL,
    action: 'snapshot',
    bids,
    asks,
    timestamp: sequence,
    seqId: sequence,
    prevSeqId: -1,
  });

  const execute = (iteration: number): number => {
    sequence += 1;
    const startedAt = performance.now();

    engine.processOrderBookUpdate({
      instId: SYMBOL,
      action: 'update',
      bids: bidCount > 0 ? [level(100, 10_000 + (iteration % 20))] : [],
      asks: askCount > 0 ? [level(100.001, 10_000 + (iteration % 20))] : [],
      timestamp: sequence,
      seqId: sequence,
      prevSeqId: sequence - 1,
    });

    return performance.now() - startedAt;
  };

  for (let index = 0; index < warmups; index += 1) {
    execute(index);
  }

  for (let index = 0; index < samples; index += 1) {
    values.push(execute(index + warmups));
  }

  return summarize(values);
};

export const runBehaviorTransitionBenchmark = (
  options: BehaviorTransitionBenchmarkOptions = {},
): BehaviorTransitionPerformanceResult => {
  const activeWhaleCounts =
    options.activeWhaleCounts ?? DEFAULT_ACTIVE_WHALE_COUNTS;
  const patterns = options.patterns ?? DEFAULT_PATTERNS;
  const samples = options.samples ?? DEFAULT_SAMPLES;
  const warmups = options.warmups ?? DEFAULT_WARMUPS;

  validatePositiveInteger('samples', samples);
  validateNonNegativeInteger('warmups', warmups);

  for (const count of activeWhaleCounts) {
    validatePositiveInteger('active whale count', count);
  }

  const behaviorScenarios: BehaviorTransitionBenchmarkResult[] = [];

  for (const activeWhales of activeWhaleCounts) {
    for (const pattern of patterns) {
      behaviorScenarios.push({
        activeWhales,
        pattern,
        transitionBookkeeping: benchmarkTransitionBookkeeping(
          activeWhales,
          pattern,
          samples,
          warmups,
        ),
        fullBehaviorStage: benchmarkFullBehaviorStage(
          activeWhales,
          pattern,
          samples,
          warmups,
        ),
      });
    }
  }

  return {
    behaviorScenarios,
    marketEngineScenarios: activeWhaleCounts.map((activeWhales) => ({
      activeWhales,
      marketEngine: benchmarkMarketEngine(activeWhales, samples, warmups),
    })),
  };
};

const formatMetric = (metric: BehaviorTransitionBenchmarkMetric): string =>
  `p50=${metric.p50Ms.toFixed(4)}ms ` +
  `p95=${metric.p95Ms.toFixed(4)}ms ` +
  `p99=${metric.p99Ms.toFixed(4)}ms ` +
  `max=${metric.maximumMs.toFixed(4)}ms ` +
  `throughput=${metric.throughputPerSecond.toFixed(2)}/s`;

export const runBehaviorTransitionPerformanceReport = (
  args: readonly string[] = process.argv.slice(2),
): void => {
  const samples = Number(
    args.find((argument) => /^\d+$/.test(argument)) ?? DEFAULT_SAMPLES,
  );
  const result = runBehaviorTransitionBenchmark({ samples });

  console.log('\nBEHAVIOR TRANSITION ALLOCATION PERFORMANCE REPORT');
  console.log(
    `BehaviorScenarios=${result.behaviorScenarios.length} ` +
      `MarketEngineScenarios=${result.marketEngineScenarios.length} ` +
      `samples=${samples} warmups=${DEFAULT_WARMUPS}`,
  );

  for (const scenario of result.behaviorScenarios) {
    console.log(
      `\nactive=${scenario.activeWhales} pattern=${scenario.pattern}`,
    );
    console.log(
      `  transition       ${formatMetric(scenario.transitionBookkeeping)}`,
    );
    console.log(
      `  behavior stage   ${formatMetric(scenario.fullBehaviorStage)}`,
    );
  }

  console.log('\nMARKET ENGINE SCALING');

  for (const scenario of result.marketEngineScenarios) {
    console.log(
      `  active=${scenario.activeWhales.toString().padStart(3)} ` +
        `${formatMetric(scenario.marketEngine)}`,
    );
  }
};

if (require.main === module) {
  try {
    runBehaviorTransitionPerformanceReport();
  } catch (error: unknown) {
    console.error(
      'Behavior transition performance report failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  }
}
