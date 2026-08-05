import { compareLiveTradingReadinessTrendDocuments } from '../safety/liveTradingReadinessTrendComparison';
import { readLiveTradingReadinessTrendDocument } from '../safety/liveTradingReadinessTrendPersistence';

export interface CompareLiveTradingReadinessTrendsCliDependencies {
  readDocument?: typeof readLiveTradingReadinessTrendDocument;
  log?: (message: string) => void;
  error?: (message: string) => void;
}

const readArgument = (args: readonly string[], name: string): string | null => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1]! : null;
};

export const runCompareLiveTradingReadinessTrendsCli = async (
  args: readonly string[],
  dependencies: CompareLiveTradingReadinessTrendsCliDependencies = {},
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
      'Usage: safety:compare-readiness-trends -- --baseline <baseline.json> --candidate <candidate.json>',
    );
    return 2;
  }

  try {
    const readDocument =
      dependencies.readDocument ?? readLiveTradingReadinessTrendDocument;
    const [baseline, candidate] = await Promise.all([
      readDocument(baselinePath),
      readDocument(candidatePath),
    ]);
    const comparison = compareLiveTradingReadinessTrendDocuments({
      baseline,
      candidate,
    });

    log('LIVE TRADING READINESS TREND COMPARISON');
    log(`Baseline: ${baselinePath}`);
    log(`Candidate: ${candidatePath}`);
    log(`Outcome: ${comparison.outcome}`);
    log(
      `Direction: ${comparison.baselineDirection} -> ${comparison.candidateDirection}`,
    );
    log(`Completed-check change delta: ${comparison.completedChecksChangeDelta}`);
    log(`Readiness escalations delta: ${comparison.readinessEscalationsDelta}`);
    log(`Readiness regressions delta: ${comparison.readinessRegressionsDelta}`);
    log(`Best completed-check count delta: ${comparison.bestCompletedChecksDelta}`);
    log(`Worst completed-check count delta: ${comparison.worstCompletedChecksDelta}`);
    log(`Order execution authorized: ${comparison.orderExecutionAuthorized}`);

    for (const reason of comparison.reasons) {
      log(`REASON | ${reason}`);
    }

    return comparison.outcome === 'WORSENED' ? 1 : 0;
  } catch (cause) {
    error(
      `Readiness trend comparison failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    return 2;
  }
};

if (require.main === module) {
  void runCompareLiveTradingReadinessTrendsCli(process.argv.slice(2)).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
  );
}
