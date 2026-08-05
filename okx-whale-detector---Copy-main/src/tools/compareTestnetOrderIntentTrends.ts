import { compareTestnetOrderIntentTrendDocuments } from '../safety/testnetOrderIntentTrendComparison';
import { readTestnetOrderIntentTrendDocument } from '../safety/testnetOrderIntentTrendPersistence';

export interface CompareTestnetOrderIntentTrendsCliDependencies {
  readDocument?: typeof readTestnetOrderIntentTrendDocument;
  compareDocuments?: typeof compareTestnetOrderIntentTrendDocuments;
  log?: (message: string) => void;
  error?: (message: string) => void;
}

const readArgument = (args: readonly string[], name: string): string | null => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1]! : null;
};

export const runCompareTestnetOrderIntentTrendsCli = async (
  args: readonly string[],
  dependencies: CompareTestnetOrderIntentTrendsCliDependencies = {},
): Promise<number> => {
  const baselinePath = readArgument(args, '--baseline');
  const candidatePath = readArgument(args, '--candidate');
  const log = dependencies.log ?? console.log;
  const error = dependencies.error ?? console.error;

  if (
    baselinePath === null ||
    baselinePath.trim() === '' ||
    candidatePath === null ||
    candidatePath.trim() === ''
  ) {
    error(
      'Usage: safety:compare-testnet-intent-trends -- --baseline <baseline.json> --candidate <candidate.json>',
    );
    return 2;
  }

  try {
    const readDocument =
      dependencies.readDocument ?? readTestnetOrderIntentTrendDocument;
    const compareDocuments =
      dependencies.compareDocuments ?? compareTestnetOrderIntentTrendDocuments;
    const [baseline, candidate] = await Promise.all([
      readDocument(baselinePath),
      readDocument(candidatePath),
    ]);
    const comparison = compareDocuments({ baseline, candidate });

    log('TESTNET ORDER INTENT TREND COMPARISON');
    log(`Baseline file: ${baselinePath}`);
    log(`Candidate file: ${candidatePath}`);
    log(`Baseline generated at: ${comparison.baselineGeneratedAt}`);
    log(`Candidate generated at: ${comparison.candidateGeneratedAt}`);
    log(`Outcome: ${comparison.outcome}`);
    log(`Baseline direction: ${comparison.baselineDirection}`);
    log(`Candidate direction: ${comparison.candidateDirection}`);
    log(
      `Estimated notional change delta: ${comparison.estimatedNotionalChangeDelta}`,
    );
    log(
      `Maximum notional change delta: ${comparison.maximumNotionalChangeDelta}`,
    );
    log(`Risk increases delta: ${comparison.riskIncreasesDelta}`);
    log(`Risk reductions delta: ${comparison.riskReductionsDelta}`);
    log(
      `Highest estimated notional delta: ${comparison.highestEstimatedNotionalDelta}`,
    );
    log(
      `Lowest estimated notional delta: ${comparison.lowestEstimatedNotionalDelta}`,
    );
    log(`Dry run only: ${comparison.dryRunOnly}`);
    log(`Transport dispatch allowed: ${comparison.transportDispatchAllowed}`);
    log(`Testnet execution authorized: ${comparison.testnetExecutionAuthorized}`);
    log(`Order execution authorized: ${comparison.orderExecutionAuthorized}`);

    for (const reason of comparison.reasons) {
      log(`REASON | ${reason}`);
    }

    return comparison.outcome === 'WORSENED' ? 1 : 0;
  } catch (cause) {
    error(
      `Testnet order intent trend comparison failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    return 2;
  }
};

if (require.main === module) {
  void runCompareTestnetOrderIntentTrendsCli(process.argv.slice(2)).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
  );
}
