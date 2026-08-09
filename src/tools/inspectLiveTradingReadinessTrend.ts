import { readLiveTradingReadinessTrendDocument } from '../safety/liveTradingReadinessTrendPersistence';

export interface InspectLiveTradingReadinessTrendCliDependencies {
  readDocument?: typeof readLiveTradingReadinessTrendDocument;
  log?: (message: string) => void;
  error?: (message: string) => void;
}

const readArgument = (args: readonly string[], name: string): string | null => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1]! : null;
};

export const runInspectLiveTradingReadinessTrendCli = async (
  args: readonly string[],
  dependencies: InspectLiveTradingReadinessTrendCliDependencies = {},
): Promise<number> => {
  const filePath = readArgument(args, '--file');
  const log = dependencies.log ?? console.log;
  const error = dependencies.error ?? console.error;

  if (filePath === null || filePath.trim() === '') {
    error('Usage: safety:inspect-readiness-trend -- --file <trend.json>');
    return 2;
  }

  try {
    const readDocument =
      dependencies.readDocument ?? readLiveTradingReadinessTrendDocument;
    const document = await readDocument(filePath);
    const trend = document.trend;

    log('LIVE TRADING READINESS TREND');
    log(`File: ${filePath}`);
    log(`Schema version: ${document.schemaVersion}`);
    log(`Generator version: ${document.generatorVersion}`);
    log(`Generated at: ${document.generatedAt}`);
    log(`Direction: ${trend.direction}`);
    log(`Completed checks change: ${trend.completedChecksChange}`);
    log(`Readiness improvements: ${trend.readinessEscalations}`);
    log(`Readiness regressions: ${trend.readinessRegressions}`);
    log(`Best completed checks: ${trend.bestCompletedChecks}`);
    log(`Worst completed checks: ${trend.worstCompletedChecks}`);
    log(`Order execution authorized: ${trend.orderExecutionAuthorized}`);

    for (const point of trend.points) {
      log(
        `POINT | ${point.generatedAt} | ${point.status} | completed=${point.completedChecks} | missing=${point.missingChecks}`,
      );
    }

    for (const reason of trend.reasons) {
      log(`REASON | ${reason}`);
    }

    return trend.direction === 'DETERIORATING' ? 1 : 0;
  } catch (cause) {
    error(
      `Readiness trend inspection failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    return 2;
  }
};

if (require.main === module) {
  void runInspectLiveTradingReadinessTrendCli(process.argv.slice(2)).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
  );
}
