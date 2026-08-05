import type { PaperRiskStatus } from './paperRiskControls';
import type { PaperTradingDocument } from './paperTradingPersistence';

export type PaperTradingComparisonOutcome = 'IMPROVED' | 'UNCHANGED' | 'WORSENED';

export interface PaperTradingComparison {
  baselineGeneratedAt: number;
  candidateGeneratedAt: number;
  outcome: PaperTradingComparisonOutcome;
  baselineRiskStatus: PaperRiskStatus;
  candidateRiskStatus: PaperRiskStatus;
  equityDelta: number;
  realizedPnlDelta: number;
  unrealizedPnlDelta: number;
  feesPaidDelta: number;
  grossExposureDelta: number;
  absoluteNetExposureDelta: number;
  drawdownPercentDelta: number;
  addedPositionIds: readonly string[];
  closedPositionIds: readonly string[];
  retainedPositionIds: readonly string[];
  reasons: readonly string[];
}

const RISK_RANK: Readonly<Record<PaperRiskStatus, number>> = Object.freeze({
  ALLOWED: 0,
  WARNING: 1,
  BLOCKED: 2,
});

const compareIdentifiers = (
  baseline: readonly { instrumentId: string }[],
  candidate: readonly { instrumentId: string }[],
): Pick<
  PaperTradingComparison,
  'addedPositionIds' | 'closedPositionIds' | 'retainedPositionIds'
> => {
  const baselineIds = new Set(baseline.map((position) => position.instrumentId));
  const candidateIds = new Set(candidate.map((position) => position.instrumentId));
  const sort = (values: string[]): readonly string[] =>
    Object.freeze(values.sort((left, right) => left.localeCompare(right)));

  return {
    addedPositionIds: sort([...candidateIds].filter((id) => !baselineIds.has(id))),
    closedPositionIds: sort([...baselineIds].filter((id) => !candidateIds.has(id))),
    retainedPositionIds: sort([...candidateIds].filter((id) => baselineIds.has(id))),
  };
};

export const comparePaperTradingDocuments = (input: {
  baseline: PaperTradingDocument;
  candidate: PaperTradingDocument;
}): PaperTradingComparison => {
  const { baseline, candidate } = input;
  if (candidate.valuation.generatedAt < baseline.valuation.generatedAt) {
    throw new Error('Candidate paper trading document cannot be older than baseline');
  }
  if (candidate.portfolio.initialCash !== baseline.portfolio.initialCash) {
    throw new Error('Paper trading documents must use the same initial cash');
  }

  const baselineRiskRank = RISK_RANK[baseline.risk.status];
  const candidateRiskRank = RISK_RANK[candidate.risk.status];
  const equityDelta = candidate.valuation.equity - baseline.valuation.equity;
  const drawdownPercentDelta = candidate.risk.drawdownPercent - baseline.risk.drawdownPercent;
  const reasons: string[] = [];

  let outcome: PaperTradingComparisonOutcome;
  if (candidateRiskRank < baselineRiskRank) {
    outcome = 'IMPROVED';
    reasons.push(`Risk status improved from ${baseline.risk.status} to ${candidate.risk.status}`);
  } else if (candidateRiskRank > baselineRiskRank) {
    outcome = 'WORSENED';
    reasons.push(`Risk status worsened from ${baseline.risk.status} to ${candidate.risk.status}`);
  } else if (equityDelta > 0 && drawdownPercentDelta <= 0) {
    outcome = 'IMPROVED';
    reasons.push('Equity increased without increasing drawdown');
  } else if (equityDelta < 0 && drawdownPercentDelta >= 0) {
    outcome = 'WORSENED';
    reasons.push('Equity decreased without reducing drawdown');
  } else {
    outcome = 'UNCHANGED';
    reasons.push('Risk status and portfolio quality did not change decisively');
  }

  return Object.freeze({
    baselineGeneratedAt: baseline.valuation.generatedAt,
    candidateGeneratedAt: candidate.valuation.generatedAt,
    outcome,
    baselineRiskStatus: baseline.risk.status,
    candidateRiskStatus: candidate.risk.status,
    equityDelta,
    realizedPnlDelta: candidate.valuation.realizedPnl - baseline.valuation.realizedPnl,
    unrealizedPnlDelta: candidate.valuation.unrealizedPnl - baseline.valuation.unrealizedPnl,
    feesPaidDelta: candidate.valuation.feesPaid - baseline.valuation.feesPaid,
    grossExposureDelta: candidate.valuation.grossExposure - baseline.valuation.grossExposure,
    absoluteNetExposureDelta:
      Math.abs(candidate.valuation.netExposure) - Math.abs(baseline.valuation.netExposure),
    drawdownPercentDelta,
    ...compareIdentifiers(baseline.valuation.positions, candidate.valuation.positions),
    reasons: Object.freeze(reasons),
  });
};
