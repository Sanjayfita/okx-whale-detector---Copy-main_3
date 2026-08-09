import { describe, expect, it } from 'vitest';
import { TradeReplayController } from '../src/replay/TradeReplayController';

describe('TradeReplayController', () => {
  it('supports play pause speed stepping and reset deterministically', () => {
    const replay = new TradeReplayController([
      { timestamp: 3, data: 'c' },
      { timestamp: 1, data: 'a' },
      { timestamp: 2, data: 'b' },
      { timestamp: 4, data: 'd' },
    ]);

    expect(replay.getState().currentFrame?.data).toBe('a');
    expect(replay.stepForward().currentFrame?.data).toBe('b');
    expect(replay.stepBack().currentFrame?.data).toBe('a');
    expect(replay.play(2).playing).toBe(true);
    expect(replay.tick().currentFrame?.data).toBe('c');
    expect(replay.pause().playing).toBe(false);
    expect(replay.setSpeed(5).speed).toBe(5);
    expect(replay.seek(1).currentFrame?.data).toBe('b');
    expect(replay.reset().currentFrame?.data).toBe('a');
  });

  it('rejects duplicate timestamps and invalid seeks', () => {
    expect(
      () =>
        new TradeReplayController([
          { timestamp: 1, data: 'a' },
          { timestamp: 1, data: 'b' },
        ]),
    ).toThrow(/duplicate timestamps/u);

    const replay = new TradeReplayController([{ timestamp: 1, data: 'a' }]);
    expect(() => replay.seek(2)).toThrow(/outside the frame range/u);
  });
});
