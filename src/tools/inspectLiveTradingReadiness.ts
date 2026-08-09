import { readLiveTradingReadinessDocument } from '../safety/liveTradingReadinessPersistence';

export interface InspectLiveTradingReadinessCliDependencies {
  readDocument?: typeof readLiveTradingReadinessDocument;
  log?: (message: string) => void;
  error?: (message: string) => void;
}

const readArgument = (args: readonly string[], name: string): string | null => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1]! : null;
};

export const runInspectLiveTradingReadinessCli = async (
  args: readonly string[],
  dependencies: InspectLiveTradingReadinessCliDependencies = {},
): Promise<number> => {
  const filePath = readArgument(args, '--file');
  const log = dependencies.log ?? console.log;
  const error = dependencies.error ?? console.error;

  if (filePath === null || filePath.trim() === '') {
    error('Usage: safety:inspect-readiness -- --file <readiness.json>');
    return 2;
  }

  try {
    const document = await (dependencies.readDocument ?? readLiveTradingReadinessDocument)(filePath);
    const { assessment, checklist } = document;

    log('LIVE TRADING READINESS REPORT');
    log(`File: ${filePath}`);
    log(`Schema version: ${document.schemaVersion}`);
    log(`Generator version: ${document.generatorVersion}`);
    log(`Generated at: ${document.generatedAt}`);
    log(`Status: ${assessment.status}`);
    log(`Completed checks: ${assessment.completedChecks}/${assessment.totalChecks}`);
    log(`Order execution authorized: ${assessment.orderExecutionAuthorized}`);

    for (const [name, completed] of Object.entries(checklist)) {
      log(`CHECK | ${name}=${completed ? 'PASS' : 'MISSING'}`);
    }

    for (const missingCheck of assessment.missingChecks) {
      log(`MISSING | ${missingCheck}`);
    }

    for (const reason of assessment.reasons) {
      log(`REASON | ${reason}`);
    }

    if (assessment.status === 'NOT_READY') return 1;
    return 0;
  } catch (cause) {
    error(
      `Live trading readiness inspection failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    return 2;
  }
};

if (require.main === module) {
  void runInspectLiveTradingReadinessCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
