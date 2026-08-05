import { readTestnetOrderIntentTrendDocument } from '../safety/testnetOrderIntentTrendPersistence';

export interface InspectTestnetOrderIntentTrendCliDependencies {
  readDocument?: typeof readTestnetOrderIntentTrendDocument;
  log?: (message: string) => void;
  error?: (message: string) => void;
}

const readArgument = (args: readonly string[], name: string): string | null => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1]! : null;
};

export const runInspectTestnetOrderIntentTrendCli = async (
  args: readonly string[],
  dependencies: InspectTestnetOrderIntentTrendCliDependencies = {},
): Promise<number> => {
  const filePath = readArgument(args, '--file');
  const log = dependencies.log ?? console.log;
  const error = dependencies.error ?? console.error;

  if (filePath === null || filePath.trim() === '') {
    error('Usage: safety:inspect-testnet-intent-trend -- --file <trend.json>');
    return 2;
  }

  try {
    const readDocument =
      dependencies.readDocument ?? readTestnetOrderIntentTrendDocument;
    const document = await readDocument(filePath);
    const trend = document.trend;

    log('TESTNET ORDER INTENT TREND');
    log(`File: ${filePath}`);
    log(`Schema version: ${document.schemaVersion}`);
    log(`Generator version: ${document.generatorVersion}`);
    log(`Generated at: ${document.generatedAt}`);
    log(`Instrument: ${trend.instrumentId}`);
    log(`Side: ${trend.side}`);
    log(`Order type: ${trend.orderType}`);
    log(`Direction: ${trend.direction}`);
    log(`Estimated notional change: ${trend.estimatedNotionalChange}`);
    log(`Maximum notional change: ${trend.maximumNotionalChange}`);
    log(`Risk increases: ${trend.riskIncreases}`);
    log(`Risk reductions: ${trend.riskReductions}`);
    log(`Highest estimated notional: ${trend.highestEstimatedNotional}`);
    log(`Lowest estimated notional: ${trend.lowestEstimatedNotional}`);
    log(`Dry run only: ${trend.dryRunOnly}`);
    log(`Transport dispatch allowed: ${trend.transportDispatchAllowed}`);
    log(`Testnet execution authorized: ${trend.testnetExecutionAuthorized}`);
    log(`Order execution authorized: ${trend.orderExecutionAuthorized}`);

    for (const point of trend.points) {
      log(
        `POINT | ${point.generatedAt} | ${point.status} | estimated=${point.estimatedNotional} | maximum=${point.maximumNotional} | quantity=${point.quantity} | reference=${point.referencePrice}`,
      );
    }

    for (const reason of trend.reasons) {
      log(`REASON | ${reason}`);
    }

    return trend.direction === 'INCREASING_RISK' ? 1 : 0;
  } catch (cause) {
    error(
      `Testnet order intent trend inspection failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    return 2;
  }
};

if (require.main === module) {
  void runInspectTestnetOrderIntentTrendCli(process.argv.slice(2)).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
  );
}
