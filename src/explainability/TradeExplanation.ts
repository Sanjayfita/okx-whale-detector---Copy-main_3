import { createHash } from 'node:crypto';

export interface ScoreComponent {
  readonly name: string;
  readonly value: number;
  readonly weight: number;
  readonly contribution: number;
  readonly explanation: string;
}

export interface TradeDecisionFilter {
  readonly name: string;
  readonly status: 'PASSED' | 'WARNING' | 'BLOCKED';
  readonly explanation: string;
}

export interface TradeRiskExplanation {
  readonly accountEquity: number;
  readonly riskFraction: number;
  readonly riskAmount: number;
  readonly positionContracts: number;
  readonly notional: number;
  readonly leverage: number;
  readonly stopDistancePercent: number;
  readonly portfolioValueAtRisk: number;
  readonly sizingMethod: string;
}

export interface TradeExitPlan {
  readonly stopType: string;
  readonly stopPrice: number;
  readonly stopExplanation: string;
  readonly takeProfitType: string;
  readonly takeProfitPrices: readonly number[];
  readonly takeProfitExplanation: string;
}

export interface TradeExplanationInput {
  readonly explanationId: string;
  readonly tradeId: string;
  readonly signalId: string;
  readonly strategyId: string;
  readonly instrumentId: string;
  readonly generatedAt: number;
  readonly direction: 'LONG' | 'SHORT';
  readonly entryScore: number;
  readonly exitScore: number | null;
  readonly scoreComponents: readonly ScoreComponent[];
  readonly activeConfirmations: readonly string[];
  readonly filters: readonly TradeDecisionFilter[];
  readonly rejectedConditions: readonly string[];
  readonly regime: Readonly<{
    directional: string;
    overlays: readonly string[];
    confidence: number;
    explanations: readonly string[];
  }>;
  readonly risk: TradeRiskExplanation;
  readonly exitPlan: TradeExitPlan;
  readonly exitReason: string | null;
  readonly codeCommit: string;
  readonly configurationHash: string;
  readonly datasetFingerprint: string;
}

export interface MachineReadableTradeExplanation extends TradeExplanationInput {
  readonly schemaVersion: 1;
  readonly decisionStatus: 'APPROVED' | 'BLOCKED' | 'EXITED';
  readonly calculationFingerprint: string;
  readonly liveExecutionAllowed: false;
}

export interface TradeExplanationReport {
  readonly machineReadable: MachineReadableTradeExplanation;
  readonly humanReadable: string;
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
};

const validateFinite = (value: number, name: string): void => {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
};

const validateInput = (input: TradeExplanationInput): void => {
  const ids = [
    input.explanationId,
    input.tradeId,
    input.signalId,
    input.strategyId,
    input.instrumentId,
    input.codeCommit,
    input.configurationHash,
    input.datasetFingerprint,
  ];
  if (ids.some((value) => value.trim().length === 0)) {
    throw new Error('trade explanation identifiers must not be empty');
  }
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) {
    throw new Error('generatedAt must be a non-negative safe integer');
  }
  validateFinite(input.entryScore, 'entryScore');
  if (input.exitScore !== null) {
    validateFinite(input.exitScore, 'exitScore');
  }
  for (const component of input.scoreComponents) {
    if (component.name.trim().length === 0 || component.explanation.trim().length === 0) {
      throw new Error('score component names and explanations are required');
    }
    validateFinite(component.value, `${component.name}.value`);
    validateFinite(component.weight, `${component.name}.weight`);
    validateFinite(component.contribution, `${component.name}.contribution`);
    if (Math.abs(component.value * component.weight - component.contribution) > 1e-9) {
      throw new Error(`score contribution mismatch for ${component.name}`);
    }
  }
  for (const [name, value] of Object.entries(input.risk)) {
    if (typeof value === 'number') {
      validateFinite(value, `risk.${name}`);
    }
  }
  if (
    input.risk.accountEquity <= 0 ||
    input.risk.riskFraction < 0 ||
    input.risk.riskAmount < 0 ||
    input.risk.positionContracts < 0 ||
    input.risk.notional < 0 ||
    input.risk.leverage < 0 ||
    input.risk.stopDistancePercent < 0
  ) {
    throw new Error('trade risk values must be non-negative with positive equity');
  }
  validateFinite(input.exitPlan.stopPrice, 'stopPrice');
  for (const price of input.exitPlan.takeProfitPrices) {
    validateFinite(price, 'takeProfitPrice');
  }
};

const renderLines = (
  explanation: MachineReadableTradeExplanation,
): readonly string[] => [
  `Trade explanation ${explanation.explanationId}`,
  `Status: ${explanation.decisionStatus}`,
  `Strategy: ${explanation.strategyId}`,
  `Instrument: ${explanation.instrumentId}`,
  `Direction: ${explanation.direction}`,
  `Entry score: ${explanation.entryScore.toFixed(4)}`,
  `Exit score: ${explanation.exitScore === null ? 'N/A' : explanation.exitScore.toFixed(4)}`,
  `Regime: ${explanation.regime.directional}${explanation.regime.overlays.length === 0 ? '' : ` + ${explanation.regime.overlays.join(', ')}`}`,
  `Regime confidence: ${explanation.regime.confidence.toFixed(4)}`,
  `Confirmations: ${explanation.activeConfirmations.length === 0 ? 'none' : explanation.activeConfirmations.join('; ')}`,
  `Filters: ${explanation.filters.length === 0 ? 'none' : explanation.filters.map((filter) => `${filter.name}=${filter.status} (${filter.explanation})`).join('; ')}`,
  `Rejected conditions: ${explanation.rejectedConditions.length === 0 ? 'none' : explanation.rejectedConditions.join('; ')}`,
  `Risk: ${explanation.risk.riskAmount.toFixed(4)} (${(explanation.risk.riskFraction * 100).toFixed(3)}% of equity), ${explanation.risk.positionContracts.toFixed(8)} contracts, notional ${explanation.risk.notional.toFixed(4)}, leverage ${explanation.risk.leverage.toFixed(3)}x`,
  `Sizing: ${explanation.risk.sizingMethod}`,
  `Stop: ${explanation.exitPlan.stopType} at ${explanation.exitPlan.stopPrice} — ${explanation.exitPlan.stopExplanation}`,
  `Take profit: ${explanation.exitPlan.takeProfitType} at ${explanation.exitPlan.takeProfitPrices.join(', ')} — ${explanation.exitPlan.takeProfitExplanation}`,
  `Exit reason: ${explanation.exitReason ?? 'position remains open'}`,
  `Fingerprint: ${explanation.calculationFingerprint}`,
  'Live execution allowed: false',
];

export const createTradeExplanation = (
  input: TradeExplanationInput,
): TradeExplanationReport => {
  validateInput(input);
  const blocked = input.filters.some((filter) => filter.status === 'BLOCKED');
  const decisionStatus =
    input.exitReason !== null ? 'EXITED' : blocked ? 'BLOCKED' : 'APPROVED';
  const calculationFingerprint = createHash('sha256')
    .update(JSON.stringify(canonicalize(input)))
    .digest('hex');
  const machineReadable: MachineReadableTradeExplanation = {
    ...input,
    schemaVersion: 1,
    decisionStatus,
    calculationFingerprint,
    liveExecutionAllowed: false,
  };
  return {
    machineReadable,
    humanReadable: renderLines(machineReadable).join('\n'),
  };
};
