import { compareTestnetOrderIntentDocuments } from '../safety/testnetOrderIntentComparison';
import { readTestnetOrderIntentDocument } from '../safety/testnetOrderIntentPersistence';

export interface CompareTestnetOrderIntentsCliDependencies {
  readDocument?: typeof readTestnetOrderIntentDocument;
  log?: (message: string) => void;
  error?: (message: string) => void;
}

const readArgument = (args: readonly string[], name: string): string | null => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1]! : null;
};

export const runCompareTestnetOrderIntentsCli = async (
  args: readonly string[],
  dependencies: CompareTestnetOrderIntentsCliDependencies = {},
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
      'Usage: safety:compare-testnet-intents -- --baseline <baseline.json> --candidate <candidate.json>',
    );
    return 2;
  }

  try {
    const readDocument = dependencies.readDocument ?? readTestnetOrderIntentDocument;
    const [baseline, candidate] = await Promise.all([
      readDocument(baselinePath),
      readDocument(candidatePath),
    ]);
    const comparison = compareTestnetOrderIntentDocuments({ baseline, candidate });

    log('TESTNET ORDER INTENT COMPARISON');
    log(`Baseline: ${baselinePath}`);
    log(`Candidate: ${candidatePath}`);
    log(`Outcome: ${comparison.outcome}`);
    log(`Status: ${comparison.baselineStatus} -> ${comparison.candidateStatus}`);
    log(`Estimated notional delta: ${comparison.estimatedNotionalDelta}`);
    log(`Maximum notional delta: ${comparison.maximumNotionalDelta}`);
    log(`Quantity delta: ${comparison.quantityDelta}`);
    log(`Reference price delta: ${comparison.referencePriceDelta}`);
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
      `Testnet order intent comparison failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    return 2;
  }
};

if (require.main === module) {
  void runCompareTestnetOrderIntentsCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
