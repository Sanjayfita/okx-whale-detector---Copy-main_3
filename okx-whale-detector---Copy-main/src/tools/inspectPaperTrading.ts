import { readPaperTradingDocument } from '../paperTrading/paperTradingPersistence';

export interface InspectPaperTradingCliDependencies {
  readDocument?: typeof readPaperTradingDocument;
  log?: (message: string) => void;
  error?: (message: string) => void;
}

const readArgument = (args: readonly string[], name: string): string | null => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1]! : null;
};

export const runInspectPaperTradingCli = async (
  args: readonly string[],
  dependencies: InspectPaperTradingCliDependencies = {},
): Promise<number> => {
  const filePath = readArgument(args, '--file');
  const log = dependencies.log ?? console.log;
  const error = dependencies.error ?? console.error;

  if (filePath === null || filePath.trim() === '') {
    error('Usage: paper:inspect -- --file <paper-trading.json>');
    return 2;
  }

  try {
    const document = await (dependencies.readDocument ?? readPaperTradingDocument)(filePath);
    const { portfolio, valuation, risk } = document;

    log('PAPER TRADING REPORT');
    log(`File: ${filePath}`);
    log(`Schema version: ${document.schemaVersion}`);
    log(`Generator version: ${document.generatorVersion}`);
    log(`Generated at: ${valuation.generatedAt}`);
    log(`Risk status: ${risk.status}`);
    log(`Initial cash: ${portfolio.initialCash}`);
    log(`Cash: ${valuation.cash}`);
    log(`Equity: ${valuation.equity}`);
    log(`Realized PnL: ${valuation.realizedPnl}`);
    log(`Unrealized PnL: ${valuation.unrealizedPnl}`);
    log(`Fees paid: ${valuation.feesPaid}`);
    log(`Gross exposure: ${valuation.grossExposure}`);
    log(`Net exposure: ${valuation.netExposure}`);
    log(`Drawdown percent: ${risk.drawdownPercent}`);
    log(`Fills: ${portfolio.fills.length}`);
    log(`Open positions: ${valuation.positions.length}`);

    for (const position of valuation.positions) {
      log(
        `${position.instrumentId} | quantity=${position.quantity} | entry=${position.averageEntryPrice} | mark=${position.markPrice} | value=${position.marketValue} | unrealizedPnl=${position.unrealizedPnl} | realizedPnl=${position.realizedPnl}`,
      );
    }

    for (const reason of risk.reasons) {
      log(`RISK | ${reason}`);
    }

    return risk.status === 'BLOCKED' ? 1 : 0;
  } catch (cause) {
    error(`Paper trading inspection failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    return 2;
  }
};

if (require.main === module) {
  void runInspectPaperTradingCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
