import { describe, expect, it } from 'vitest';

import { ManualClock, ReplayClock } from '../src/runtime/Clock';

describe('deterministic clocks', () => {
  it('advances a manual clock without allowing time reversal', () => {
    const clock = new ManualClock(1_000);

    expect(clock.advance(250)).toBe(1_250);
    clock.set(2_000);
    expect(clock.now()).toBe(2_000);
    expect(() => clock.set(1_999)).toThrow('cannot move backwards');
  });

  it('observes chronological replay timestamps and rejects reordered input', () => {
    const clock = new ReplayClock();

    expect(clock.observe(10_000)).toBe(10_000);
    expect(clock.observe(10_500)).toBe(10_500);
    expect(() => clock.observe(10_499)).toThrow(
      'Replay records must be chronological',
    );
  });

  it('temporarily controls Date.now and restores the system function', () => {
    const originalDateNow = Date.now;
    const clock = new ReplayClock(5_000);
    const restore = clock.installDateNow();

    try {
      expect(Date.now()).toBe(5_000);
      clock.observe(6_000);
      expect(Date.now()).toBe(6_000);
    } finally {
      restore();
    }

    expect(Date.now).toBe(originalDateNow);
  });
});
