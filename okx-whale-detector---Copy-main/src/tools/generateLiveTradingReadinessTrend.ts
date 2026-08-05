import { readLiveTradingReadinessDocument } from '../safety/liveTradingReadinessPersistence';
import { summarizeLiveTradingReadinessTrend } from '../safety/liveTradingReadinessTrend';
import {
  createLiveTradingReadinessTrendDocument,
  writeLiveTradingReadinessTrendDocument,
} from '../safety/liveTradingReadinessTrendPersistence';

export interface GenerateLiveTradingReadinessTrendCliDependencies {
  readDocument?: typeof readLiveTradingReadinessDocument;
  writeDocument?: typeof writeLiveTradingReadinessTrendDocument;
  now?: () => number;
  log?: (message: string) => void;
  error?: (message: string) => void;
}

const readRepeatedArgument = (args: readonly string[], name: string): string[] => {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && index + 1 < args.length) {
      values.push(args[index + 1]!);
    }
  }
  return values;
};

const readArgument = (args: readonly string[], name: string): string | null => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1]! : null;
};

export const runGenerateLiveTradingReadinessTrendCli = async (
  args: readonly string[],
  dependencies: GenerateLiveTradingReadinessTrendCliDependencies = {},
): Promise<number> => {
  const inputPaths = readRepeatedArgument(args, '--file').filter((value) => value.trim() !== '');
  const outputPath = readArgument(args, '--output');
  const log = dependencies.log ?? console.log;
  const error = dependencies.error ?? console.error;

  if (inputPaths.length < 2 || outputPath === null || outputPath.trim() === '') {
    error(
      'Usage: safety:generate-readiness-trend -- --file <readiness-1.json> --file <readiness-2.json> [--file <readiness-n.json>] --output <trend.json>',
    );
    return 2;
  }

  try {
    const readDocument = dependencies.readDocument ?? readLiveTradingReadinessDocument;
    const writeDocument = dependencies.writeDocument ?? writeLiveTradingReadinessTrendDocument;
    const documents = await Promise.all(inputPaths.map((filePath) => readDocument(filePath)));
    const trend = summarizeLiveTradingReadinessTrend(documents);
    const generatedAt = (dependencies.now ?? Date.now)();
    const trendDocument = createLiveTradingReadinessTrendDocument({ generatedAt, trend });

    await writeDocument(outputPath, trendDocument);

    log('LIVE TRADING READINESS TREND GENERATED');
    log(`Inputs: ${inputPaths.length}`);
    log(`Output: ${outputPath}`);
    log(`Direction: ${trend.direction}`);
    log(`Completed checks change: ${trend.completedChecksChange}`);
    log(`Order execution authorized: ${trend.orderExecutionAuthorized}`);

    return trend.direction === 'DETERIORATING' ? 1 : 0;
  } catch (cause) {
    error(
      `Live trading readiness trend generation failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    return 2;
  }
};

if (require.main === module) {
  void runGenerateLiveTradingReadinessTrendCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
