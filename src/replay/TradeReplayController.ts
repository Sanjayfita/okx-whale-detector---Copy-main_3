export interface ReplayFrame<T> {
  readonly timestamp: number;
  readonly data: T;
}

export type ReplaySpeed = 1 | 2 | 5;

export interface ReplayState<T> {
  readonly frameCount: number;
  readonly currentIndex: number;
  readonly currentFrame: ReplayFrame<T> | null;
  readonly playing: boolean;
  readonly speed: ReplaySpeed;
  readonly atStart: boolean;
  readonly atEnd: boolean;
}

const requireFrameTimestamp = (timestamp: number): void => {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error('replay frame timestamp must be a non-negative safe integer');
  }
};

/**
 * Pure deterministic replay cursor used by both browser controls and tests.
 * Playback timing is intentionally outside this class; the caller supplies a
 * regular timer and `tick()` advances one, two or five frames according to speed.
 */
export class TradeReplayController<T> {
  private readonly frames: readonly ReplayFrame<T>[];
  private currentIndex: number;
  private playing = false;
  private speed: ReplaySpeed = 1;

  public constructor(frames: readonly ReplayFrame<T>[]) {
    const ordered = frames.slice().sort((left, right) => left.timestamp - right.timestamp);
    for (const frame of ordered) requireFrameTimestamp(frame.timestamp);
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index]?.timestamp === ordered[index - 1]?.timestamp) {
        throw new Error('replay frames must not contain duplicate timestamps');
      }
    }
    this.frames = ordered;
    this.currentIndex = ordered.length === 0 ? -1 : 0;
  }

  public play(speed: ReplaySpeed = this.speed): ReplayState<T> {
    this.speed = speed;
    this.playing = this.frames.length > 0 && !this.isAtEnd();
    return this.getState();
  }

  public pause(): ReplayState<T> {
    this.playing = false;
    return this.getState();
  }

  public setSpeed(speed: ReplaySpeed): ReplayState<T> {
    this.speed = speed;
    return this.getState();
  }

  public stepForward(steps = 1): ReplayState<T> {
    if (!Number.isSafeInteger(steps) || steps <= 0) {
      throw new Error('replay steps must be a positive safe integer');
    }
    if (this.frames.length === 0) return this.getState();
    this.currentIndex = Math.min(
      this.frames.length - 1,
      this.currentIndex + steps,
    );
    if (this.isAtEnd()) this.playing = false;
    return this.getState();
  }

  public stepBack(steps = 1): ReplayState<T> {
    if (!Number.isSafeInteger(steps) || steps <= 0) {
      throw new Error('replay steps must be a positive safe integer');
    }
    if (this.frames.length === 0) return this.getState();
    this.currentIndex = Math.max(0, this.currentIndex - steps);
    return this.getState();
  }

  public tick(): ReplayState<T> {
    return this.playing ? this.stepForward(this.speed) : this.getState();
  }

  public seek(index: number): ReplayState<T> {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.frames.length) {
      throw new Error('replay seek index is outside the frame range');
    }
    this.currentIndex = index;
    if (this.isAtEnd()) this.playing = false;
    return this.getState();
  }

  public reset(): ReplayState<T> {
    this.currentIndex = this.frames.length === 0 ? -1 : 0;
    this.playing = false;
    this.speed = 1;
    return this.getState();
  }

  public getVisibleFrames(): readonly ReplayFrame<T>[] {
    return this.currentIndex < 0
      ? []
      : this.frames.slice(0, this.currentIndex + 1);
  }

  public getState(): ReplayState<T> {
    return {
      frameCount: this.frames.length,
      currentIndex: this.currentIndex,
      currentFrame:
        this.currentIndex < 0 ? null : (this.frames[this.currentIndex] ?? null),
      playing: this.playing,
      speed: this.speed,
      atStart: this.currentIndex <= 0,
      atEnd: this.isAtEnd(),
    };
  }

  private isAtEnd(): boolean {
    return this.frames.length === 0 || this.currentIndex >= this.frames.length - 1;
  }
}
