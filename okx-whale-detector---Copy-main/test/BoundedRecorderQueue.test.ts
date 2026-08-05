import { describe, expect, it, vi } from 'vitest';

import { BoundedRecorderQueue } from '../src/recording/BoundedRecorderQueue';

describe('BoundedRecorderQueue', () => {
  it('isolates a failed recorder task and continues draining later tasks', async () => {
    const failure = new Error('disk unavailable');
    const onFailure = vi.fn();
    const completed: string[] = [];
    const queue = new BoundedRecorderQueue({ onFailure });

    expect(
      queue.enqueue(() => {
        throw failure;
      }),
    ).toBe(true);
    expect(
      queue.enqueue(() => {
        completed.push('second');
      }),
    ).toBe(true);

    await queue.closeAndDrain();

    expect(completed).toEqual(['second']);
    expect(onFailure).toHaveBeenCalledWith(failure);
    expect(queue.getSnapshot()).toMatchObject({
      queued: 0,
      accepted: 2,
      completed: 1,
      failed: 1,
      dropped: 0,
      closed: true,
      draining: false,
    });
  });

  it('drops work instead of allowing an unbounded queue', async () => {
    let scheduledDrain: (() => void) | undefined;
    const onDrop = vi.fn();
    const queue = new BoundedRecorderQueue({
      maximumQueueSize: 1,
      scheduleDrain: (callback) => {
        scheduledDrain = callback;
      },
      onDrop,
    });

    expect(queue.enqueue(() => undefined)).toBe(true);
    expect(queue.enqueue(() => undefined)).toBe(false);
    expect(onDrop).toHaveBeenCalledWith(1);

    scheduledDrain?.();
    await queue.closeAndDrain();

    expect(queue.getSnapshot()).toMatchObject({
      accepted: 1,
      completed: 1,
      dropped: 1,
      closed: true,
    });
  });

  it('rejects new work after close begins', async () => {
    const queue = new BoundedRecorderQueue();
    await queue.closeAndDrain();

    expect(queue.enqueue(() => undefined)).toBe(false);
  });
});
