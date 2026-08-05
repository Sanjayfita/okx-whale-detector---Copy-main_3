import { createPaperPortfolioSnapshot } from '../paperTrading/paperPortfolio';
import { valuePaperPortfolio } from '../paperTrading/paperPortfolioValuation';
import { assessPaperTradingRisk } from '../paperTrading/paperRiskControls';

export interface PaperTradingSimulationResult {
  generatedAt: number;
  fillCount: number;
  openPositionCount: number;
  cash: number;
  equity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  feesPaid: number;
  grossExposure: number;
  netExposure: number;
  allowedStatus: 'ALLOWED' | 'WARNING' | 'BLOCKED';
  warningStatus: 'ALLOWED' | 'WARNING' | 'BLOCKED';
  blockedStatus: 'ALLOWED' | 'WARNING' | 'BLOCKED';
}

export const runPaperTradingSimulation = (): PaperTradingSimulationResult => {
  const generatedAt = 1_800_000_000_000;
  const portfolio = createPaperPortfolioSnapshot({
    generatedAt,
    initialCash: 10_000,
    fills: [
      {
        fillId: 'paper-fill:1',
        instrumentId: 'BTC-USDT',
        side: 'BUY',
        quantity: 0.1,
        price: 50_000,
        fee: 5,
        executedAt: generatedAt - 3_000,
      },
      {
        fillId: 'paper-fill:2',
        instrumentId: 'BTC-USDT',
        side: 'SELL',
        quantity: 0.04,
        price: 52_000,
        fee: 2,
        executedAt: generatedAt - 2_000,
      },
      {
        fillId: 'paper-fill:3',
        instrumentId: 'ETH-USDT',
        side: 'SELL',
        quantity: 1,
        price: 3_000,
        fee: 3,
        executedAt: generatedAt - 1_000,
      },
    ],
  });

  const valuation = valuePaperPortfolio({
    generatedAt,
    portfolio,
    marks: [
      { instrumentId: 'BTC-USDT', price: 51_000, observedAt: generatedAt },
      { instrumentId: 'ETH-USDT', price: 2_900, observedAt: generatedAt },
    ],
  });

  const allowed = assessPaperTradingRisk({
    valuation,
    initialEquity: 10_000,
    limits: {
      maxGrossExposure: 20_000,
      maxAbsoluteNetExposure: 20_000,
      maxPositionExposure: 10_000,
      maxDrawdownPercent: 20,
      warningThresholdPercent: 80,
    },
  });
  const warning = assessPaperTradingRisk({
    valuation,
    initialEquity: 10_000,
    limits: {
      maxGrossExposure: valuation.grossExposure / 0.8,
      maxAbsoluteNetExposure: 20_000,
      maxPositionExposure: 10_000,
      maxDrawdownPercent: 20,
      warningThresholdPercent: 80,
    },
  });
  const blocked = assessPaperTradingRisk({
    valuation,
    initialEquity: 10_000,
    limits: {
      maxGrossExposure: valuation.grossExposure - 1,
      maxAbsoluteNetExposure: 20_000,
      maxPositionExposure: 10_000,
      maxDrawdownPercent: 20,
      warningThresholdPercent: 80,
    },
  });

  const result = Object.freeze({
    generatedAt,
    fillCount: portfolio.fills.length,
    openPositionCount: valuation.positions.length,
    cash: portfolio.cash,
    equity: valuation.equity,
    realizedPnl: valuation.realizedPnl,
    unrealizedPnl: valuation.unrealizedPnl,
    feesPaid: valuation.feesPaid,
    grossExposure: valuation.grossExposure,
    netExposure: valuation.netExposure,
    allowedStatus: allowed.status,
    warningStatus: warning.status,
    blockedStatus: blocked.status,
  });

  console.log('PAPER TRADING SIMULATION');
  console.log(`Generated at: ${result.generatedAt}`);
  console.log(`Fills: ${result.fillCount}`);
  console.log(`Open positions: ${result.openPositionCount}`);
  console.log(`Cash: ${result.cash}`);
  console.log(`Equity: ${result.equity}`);
  console.log(`Realized PnL: ${result.realizedPnl}`);
  console.log(`Unrealized PnL: ${result.unrealizedPnl}`);
  console.log(`Fees paid: ${result.feesPaid}`);
  console.log(`Gross exposure: ${result.grossExposure}`);
  console.log(`Net exposure: ${result.netExposure}`);
  console.log(`Allowed scenario: ${result.allowedStatus}`);
  console.log(`Warning scenario: ${result.warningStatus}`);
  console.log(`Blocked scenario: ${result.blockedStatus}`);
  console.log('Offline paper trading only. No real order endpoints are used.');

  return result;
};

if (require.main === module) {
  runPaperTradingSimulation();
}
