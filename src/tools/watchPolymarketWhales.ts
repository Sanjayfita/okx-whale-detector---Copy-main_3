import { PolymarketLiveSignalRuntime } from '../external/providers/polymarket/PolymarketLiveSignalRuntime';

interface WatchOptions {
  minimumSignalUsd: number;
  minimumLiquidityUsd: number;
  marketLimit: number;
  watchMarkets: number;
  windowSeconds: number;
  minimumDominance: number;
  signalCooldownSeconds: number;
  statusSeconds: number;
  showExecutions: boolean;
}

const parsePositiveNumber = (
  value: string | undefined,
  flag: string,
): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive number`);
  }
  return parsed;
};

const parseRatio = (value: string | undefined, flag: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${flag} requires a number from 0 to 1`);
  }
  return parsed;
};

const parseOptions = (args: readonly string[]): WatchOptions => {
  const options: WatchOptions = {
    minimumSignalUsd: 5_000,
    minimumLiquidityUsd: 5_000,
    marketLimit: 2_000,
    watchMarkets: 100,
    windowSeconds: 60,
    minimumDominance: 0.15,
    signalCooldownSeconds: 15,
    statusSeconds: 30,
    showExecutions: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];

    if (flag === '--min-trade') {
      options.minimumSignalUsd = parsePositiveNumber(value, flag);
      index += 1;
    } else if (flag === '--min-liquidity') {
      options.minimumLiquidityUsd = parsePositiveNumber(value, flag);
      index += 1;
    } else if (flag === '--market-limit') {
      options.marketLimit = parsePositiveNumber(value, flag);
      index += 1;
    } else if (flag === '--watch-markets') {
      options.watchMarkets = parsePositiveNumber(value, flag);
      index += 1;
    } else if (flag === '--window-seconds') {
      options.windowSeconds = parsePositiveNumber(value, flag);
      index += 1;
    } else if (flag === '--min-dominance') {
      options.minimumDominance = parseRatio(value, flag);
      index += 1;
    } else if (flag === '--signal-cooldown-seconds') {
      options.signalCooldownSeconds = parsePositiveNumber(value, flag);
      index += 1;
    } else if (flag === '--status-seconds') {
      options.statusSeconds = parsePositiveNumber(value, flag);
      index += 1;
    } else if (flag === '--show-executions') {
      options.showExecutions = true;
    } else {
      throw new Error(`Unknown Polymarket live option: ${flag}`);
    }
  }

  return options;
};

const main = async (): Promise<void> => {
  const options = parseOptions(process.argv.slice(2));
  const runtime = new PolymarketLiveSignalRuntime(
    {
      minimumSignalUsd: options.minimumSignalUsd,
      minimumLiquidityUsd: options.minimumLiquidityUsd,
      marketLimit: options.marketLimit,
      watchMarkets: options.watchMarkets,
      windowSeconds: options.windowSeconds,
      minimumDominance: options.minimumDominance,
      signalCooldownSeconds: options.signalCooldownSeconds,
      statusSeconds: options.statusSeconds,
      showExecutions: options.showExecutions,
      enabled: true,
    },
    {
      logger: console,
    },
  );

  const shutdown = (): void => {
    console.log('\nStopping Polymarket live watcher...');
    runtime.stop();
    process.exitCode = 0;
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await runtime.start();
};

void main().catch((error: unknown) => {
  console.error('Polymarket live watcher failed:', error);
  process.exitCode = 1;
});
