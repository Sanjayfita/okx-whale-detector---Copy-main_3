import { describe, expect, it } from 'vitest';
import { calculatePaperFee } from '../src/paper/PaperFeeModel';

describe('calculatePaperFee', () => {
  it('distinguishes maker and taker fee schedules', () => {
    expect(
      calculatePaperFee({ notional: 10_000, liquidityRole: 'MAKER' }),
    ).toBe(2);
    expect(
      calculatePaperFee({ notional: 10_000, liquidityRole: 'TAKER' }),
    ).toBe(5);
  });
});
