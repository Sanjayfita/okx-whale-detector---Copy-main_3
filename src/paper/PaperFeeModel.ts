export type PaperLiquidityRole = 'MAKER' | 'TAKER';

export interface PaperFeePolicy {
  readonly makerFeeBps: number;
  readonly takerFeeBps: number;
}

export const DEFAULT_PAPER_FEE_POLICY: PaperFeePolicy = Object.freeze({
  makerFeeBps: 2,
  takerFeeBps: 5,
});

const requireNonNegativeFinite = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be finite and non-negative`);
  }
};

export const calculatePaperFee = (input: {
  readonly notional: number;
  readonly liquidityRole: PaperLiquidityRole;
  readonly policy?: PaperFeePolicy;
}): number => {
  const policy = input.policy ?? DEFAULT_PAPER_FEE_POLICY;
  requireNonNegativeFinite(input.notional, 'notional');
  requireNonNegativeFinite(policy.makerFeeBps, 'makerFeeBps');
  requireNonNegativeFinite(policy.takerFeeBps, 'takerFeeBps');
  const bps =
    input.liquidityRole === 'MAKER'
      ? policy.makerFeeBps
      : policy.takerFeeBps;
  return input.notional * (bps / 10_000);
};
