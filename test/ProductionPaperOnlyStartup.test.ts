import { describe, expect, it } from 'vitest';
import { resolveTradingPlatformStartupSafety } from '../src/tools/startTradingPlatform';

describe('production paper-only startup safety', () => {
  it('requires the explicit remote paper guard in production', () => {
    expect(() =>
      resolveTradingPlatformStartupSafety({
        NODE_ENV: 'production',
        TRADING_MODE: 'PAPER',
      }),
    ).toThrow('Production startup requires REMOTE_PAPER_ONLY=true');

    expect(() =>
      resolveTradingPlatformStartupSafety({
        NODE_ENV: 'production',
        REMOTE_PAPER_ONLY: 'false',
        TRADING_MODE: 'PAPER',
      }),
    ).toThrow('Production startup requires REMOTE_PAPER_ONLY=true');
  });

  it('rejects a contradictory LIVE request whenever remote paper-only is set', () => {
    expect(() =>
      resolveTradingPlatformStartupSafety({
        NODE_ENV: 'production',
        REMOTE_PAPER_ONLY: 'true',
        TRADING_MODE: 'LIVE',
      }),
    ).toThrow('REMOTE_PAPER_ONLY=true is incompatible with TRADING_MODE=LIVE');
  });

  it('resolves the production profile to PAPER', () => {
    expect(
      resolveTradingPlatformStartupSafety({
        NODE_ENV: 'production',
        REMOTE_PAPER_ONLY: 'true',
        TRADING_MODE: 'PAPER',
      }),
    ).toEqual({ mode: 'PAPER', remotePaperOnly: true });
  });

  it('preserves the development monitoring-only mode selector', () => {
    expect(
      resolveTradingPlatformStartupSafety({ TRADING_MODE: 'LIVE' }),
    ).toEqual({ mode: 'LIVE', remotePaperOnly: false });
  });
});
