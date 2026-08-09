export interface PipelineStageStats {
  readonly stage: string;
  readonly samples: number;
  readonly totalMs: number;
  readonly averageMs: number;
  readonly maximumMs: number;
}

export interface RecentPipelineStageStats {
  readonly stage: string;
  readonly count: number;
  readonly latestMs: number;
  readonly totalMs: number;
  readonly averageMs: number;
  readonly maximumMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
}

interface MutableStageStats {
  samples: number;
  totalMs: number;
  maximumMs: number;
  recent: BoundedSampleWindow;
}

export interface PipelineProfilerOptions {
  maximumSamplesPerStage?: number;
  maximumStages?: number;
  enabled?: boolean;
}

export interface PerformanceRecorder {
  measure<T>(stage: string, operation: () => T): T;
  record(stage: string, durationMs: number): void;
}

const percentile = (sorted: readonly number[], quantile: number): number => {
  if (sorted.length === 0) {
    return 0;
  }

  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index] ?? 0;
};

class BoundedSampleWindow {
  private readonly values: number[];
  private count = 0;
  private nextIndex = 0;

  public constructor(private readonly capacity: number) {
    this.values = new Array<number>(capacity);
  }

  public add(value: number): void {
    this.values[this.nextIndex] = value;
    this.nextIndex = (this.nextIndex + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }

  public getValues(): number[] {
    if (this.count < this.capacity) {
      return this.values.slice(0, this.count);
    }

    return [
      ...this.values.slice(this.nextIndex),
      ...this.values.slice(0, this.nextIndex),
    ];
  }

  public getCount(): number {
    return this.count;
  }
}

export class PipelineProfiler {
  private readonly stages = new Map<string, MutableStageStats>();
  private readonly maximumSamplesPerStage: number;
  private readonly maximumStages: number;
  private readonly enabled: boolean;

  public constructor(options: PipelineProfilerOptions = {}) {
    this.maximumSamplesPerStage = options.maximumSamplesPerStage ?? 100;
    this.maximumStages = options.maximumStages ?? 100;
    this.enabled = options.enabled ?? true;

    if (
      !Number.isInteger(this.maximumSamplesPerStage) ||
      this.maximumSamplesPerStage <= 0
    ) {
      throw new Error('maximumSamplesPerStage must be a positive integer');
    }

    if (!Number.isInteger(this.maximumStages) || this.maximumStages <= 0) {
      throw new Error('maximumStages must be a positive integer');
    }

    if (typeof this.enabled !== 'boolean') {
      throw new Error('enabled must be a boolean');
    }
  }

  public measure<T>(stage: string, operation: () => T): T {
    if (!this.enabled) {
      return operation();
    }

    const startedAt = performance.now();

    try {
      return operation();
    } finally {
      this.record(stage, performance.now() - startedAt);
    }
  }

  public record(stage: string, durationMs: number): void {
    if (
      !this.enabled ||
      !stage ||
      !Number.isFinite(durationMs) ||
      durationMs < 0
    ) {
      return;
    }

    let current = this.stages.get(stage);

    if (!current) {
      if (this.stages.size >= this.maximumStages) {
        return;
      }

      current = {
        samples: 0,
        totalMs: 0,
        maximumMs: 0,
        recent: new BoundedSampleWindow(this.maximumSamplesPerStage),
      };
      this.stages.set(stage, current);
    }

    current.samples += 1;
    current.totalMs += durationMs;
    current.maximumMs = Math.max(current.maximumMs, durationMs);
    current.recent.add(durationMs);
  }

  public getRecentSnapshot(): readonly RecentPipelineStageStats[] {
    return [...this.stages.entries()]
      .map(([stage, stats]) => {
        const values = stats.recent.getValues();
        const sorted = [...values].sort((left, right) => left - right);
        const totalMs = values.reduce((total, value) => total + value, 0);

        return {
          stage,
          count: stats.recent.getCount(),
          latestMs: values[values.length - 1] ?? 0,
          totalMs,
          averageMs: values.length === 0 ? 0 : totalMs / values.length,
          maximumMs: sorted[sorted.length - 1] ?? 0,
          p50Ms: percentile(sorted, 0.5),
          p95Ms: percentile(sorted, 0.95),
          p99Ms: percentile(sorted, 0.99),
        };
      })
      .sort((left, right) => right.totalMs - left.totalMs);
  }

  public getRecentStage(stage: string): RecentPipelineStageStats | undefined {
    return this.getRecentSnapshot().find((entry) => entry.stage === stage);
  }

  public getStageCount(): number {
    return this.stages.size;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public getSnapshot(): readonly PipelineStageStats[] {
    return [...this.stages.entries()]
      .map(([stage, stats]) => ({
        stage,
        samples: stats.samples,
        totalMs: stats.totalMs,
        averageMs: stats.samples === 0 ? 0 : stats.totalMs / stats.samples,
        maximumMs: stats.maximumMs,
      }))
      .sort((left, right) => right.totalMs - left.totalMs);
  }

  public reset(): void {
    this.stages.clear();
  }
}
