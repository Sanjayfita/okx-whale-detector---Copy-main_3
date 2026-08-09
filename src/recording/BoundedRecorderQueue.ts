export interface RecorderQueueSnapshot {
  readonly queued: number;
  readonly accepted: number;
  readonly completed: number;
  readonly failed: number;
  readonly dropped: number;
  readonly closed: boolean;
  readonly draining: boolean;
}

export interface BoundedRecorderQueueOptions {
  readonly maximumQueueSize?: number;
  readonly scheduleDrain?: (callback: () => void) => void;
  readonly onFailure?: (error: unknown) => void;
  readonly onDrop?: (queueDepth: number) => void;
}

type RecorderTask = () => void | Promise<void>;

const DEFAULT_MAXIMUM_QUEUE_SIZE = 10_000;

export class BoundedRecorderQueue {
  private readonly queue: RecorderTask[] = [];
  private readonly maximumQueueSize: number;
  private readonly scheduleDrain: (callback: () => void) => void;
  private accepted = 0;
  private completed = 0;
  private failed = 0;
  private dropped = 0;
  private draining = false;
  private closed = false;
  private drainPromise?: Promise<void>;
  private closePromise?: Promise<void>;
  private resolveClose?: () => void;

  public constructor(
    private readonly options: BoundedRecorderQueueOptions = {},
  ) {
    this.maximumQueueSize =
      options.maximumQueueSize ?? DEFAULT_MAXIMUM_QUEUE_SIZE;
    this.scheduleDrain = options.scheduleDrain ?? ((callback) => setImmediate(callback));

    if (!Number.isInteger(this.maximumQueueSize) || this.maximumQueueSize <= 0) {
      throw new Error('maximumQueueSize must be a positive integer');
    }
  }

  public enqueue(task: RecorderTask): boolean {
    if (this.closed) {
      return false;
    }

    if (this.queue.length >= this.maximumQueueSize) {
      this.dropped += 1;
      this.options.onDrop?.(this.queue.length);
      return false;
    }

    this.queue.push(task);
    this.accepted += 1;
    this.ensureDraining();
    return true;
  }

  public getSnapshot(): RecorderQueueSnapshot {
    return {
      queued: this.queue.length,
      accepted: this.accepted,
      completed: this.completed,
      failed: this.failed,
      dropped: this.dropped,
      closed: this.closed,
      draining: this.draining,
    };
  }

  public closeAndDrain(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise;
    }

    this.closed = true;
    this.closePromise = new Promise<void>((resolve) => {
      this.resolveClose = resolve;
    });

    if (!this.draining && this.queue.length === 0) {
      this.finishClose();
    } else {
      this.ensureDraining();
    }

    return this.closePromise;
  }

  private ensureDraining(): void {
    if (this.draining || this.queue.length === 0) {
      if (this.closed && !this.draining && this.queue.length === 0) {
        this.finishClose();
      }
      return;
    }

    this.draining = true;
    this.scheduleDrain(() => {
      this.drainPromise = this.drain().finally(() => {
        this.drainPromise = undefined;
      });
    });
  }

  private async drain(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        const task = this.queue.shift();
        if (!task) {
          continue;
        }

        try {
          await task();
          this.completed += 1;
        } catch (error: unknown) {
          this.failed += 1;
          this.options.onFailure?.(error);
        }
      }
    } finally {
      this.draining = false;
      if (this.queue.length > 0) {
        this.ensureDraining();
      } else if (this.closed) {
        this.finishClose();
      }
    }
  }

  private finishClose(): void {
    const resolve = this.resolveClose;
    this.resolveClose = undefined;
    resolve?.();
  }
}
