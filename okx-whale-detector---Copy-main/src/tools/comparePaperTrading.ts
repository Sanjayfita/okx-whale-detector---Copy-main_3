import { comparePaperTradingDocuments } from '../paperTrading/paperTradingComparison';
import { readPaperTradingDocument } from '../paperTrading/paperTradingPersistence';

export interface ComparePaperTradingCliDependencies {
  readDocument?: typeof readPaperTradingDocument;
  log?: (message: string) => void;
  error?: (message: string) => void;
}

const readArgument = (args: readonly string[], name: string): string | null => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1]! : null;
};

export const runComparePaperTradingCli = async (
  args: readonly string[],
  dependencies: ComparePaperTradingCliDependencies = {},
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
      'Usage: paper:compare -- --baseline <baseline.json> --candidate <candidate.json>',
    );
    return 2;
  }

  try {
    const readDocument = dependencies.readDocument ?? readPaperTradingDocument;
    const [baseline, candidate] = await Promise.all([
      readDocument(baselinePath),
      readDocument(candidatePath),
    ]);
    const comparison = comparePaperTradingDocuments({ baseline, candidate });

    log('PAPER TRADING COMPARISON');
    log(`Baseline: ${baselinePath}`);
    log(`Candidate: ${candidatePath}`);
    log(`Outcome: ${comparison.outcome}`);
    log(
      `Risk status: ${comparison.baselineRiskStatus} -> ${comparison.candidateRiskStatus}`,
    );
    log(`Equity delta: ${comparison.equityDelta}`);
    log(`Realized PnL delta: ${comparison.realizedPnlDelta}`);
    log(`Unrealized PnL delta: ${comparison.unrealizedPnlDelta}`);
    log(`Fees delta: ${comparison.feesPaidDelta}`);
    log(`Gross exposure delta: ${comparison.grossExposureDelta}`);
    log(`Absolute net exposure delta: ${comparison.absoluteNetExposureDelta}`);
    log(`Drawdown percent delta: ${comparison.drawdownPercentDelta}`);
    log(`Added positions: ${comparison.addedPositionIds.join(', ') || 'none'}`);
    log(`Closed positions: ${comparison.closedPositionIds.join(', ') || 'none'}`);
    log(`Retained positions: ${comparison.retainedPositionIds.join(', ') || 'none'}`);

    for (const reason of comparison.reasons) {
      log(`REASON | ${reason}`);
    }

    return comparison.outcome === 'WORSENED' ? 1 : 0;
  } catch (cause) {
    error(
      `Paper trading comparison failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    return 2;
  }
};

if (require.main === module) {
  void runComparePaperTradingCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
