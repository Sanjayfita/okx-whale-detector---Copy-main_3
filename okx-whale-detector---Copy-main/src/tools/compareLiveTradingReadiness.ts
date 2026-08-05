import { compareLiveTradingReadinessDocuments } from '../safety/liveTradingReadinessComparison';
import { readLiveTradingReadinessDocument } from '../safety/liveTradingReadinessPersistence';

export interface CompareLiveTradingReadinessCliDependencies {
  readDocument?: typeof readLiveTradingReadinessDocument;
  log?: (message: string) => void;
  error?: (message: string) => void;
}

const readArgument = (args: readonly string[], name: string): string | null => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1]! : null;
};

export const runCompareLiveTradingReadinessCli = async (
  args: readonly string[],
  dependencies: CompareLiveTradingReadinessCliDependencies = {},
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
      'Usage: safety:compare-readiness -- --baseline <baseline.json> --candidate <candidate.json>',
    );
    return 2;
  }

  try {
    const readDocument = dependencies.readDocument ?? readLiveTradingReadinessDocument;
    const [baseline, candidate] = await Promise.all([
      readDocument(baselinePath),
      readDocument(candidatePath),
    ]);
    const comparison = compareLiveTradingReadinessDocuments({ baseline, candidate });

    log('LIVE TRADING READINESS COMPARISON');
    log(`Baseline: ${baselinePath}`);
    log(`Candidate: ${candidatePath}`);
    log(`Outcome: ${comparison.outcome}`);
    log(`Status: ${comparison.baselineStatus} -> ${comparison.candidateStatus}`);
    log(`Completed checks delta: ${comparison.completedChecksDelta}`);
    log(`Newly completed: ${comparison.newlyCompletedChecks.join(', ') || 'none'}`);
    log(`Regressed: ${comparison.regressedChecks.join(', ') || 'none'}`);
    log(
      `Unchanged completed: ${comparison.unchangedCompletedChecks.join(', ') || 'none'}`,
    );
    log(`Order execution authorized: ${comparison.orderExecutionAuthorized}`);

    for (const reason of comparison.reasons) {
      log(`REASON | ${reason}`);
    }

    return comparison.outcome === 'WORSENED' ? 1 : 0;
  } catch (cause) {
    error(
      `Live trading readiness comparison failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    return 2;
  }
};

if (require.main === module) {
  void runCompareLiveTradingReadinessCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
