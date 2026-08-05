import type { PerformanceRecorder, PipelineProfiler } from './PipelineProfiler';

export interface ObservedStageTiming {
  stage: string;
  durationMs: number;
}

export interface MessagePerformanceContext {
  queueDelayMs?: number;
  stages: ObservedStageTiming[];
}

export interface MarketUpdateDiagnosticState {
  queueDelayMs?: number;
  bidDepth?: number;
  askDepth?: number;
  depthPruned?: boolean;
  activeWhales?: number;
  activeWalls?: number;
  externalSignalStoreSize?: number;
  summaryProcessed: boolean;
  alertEmitted: boolean;
  alertPersisted: boolean;
  recorderFsync: boolean;
}

export interface MarketUpdateDiagnosticSnapshot extends MarketUpdateDiagnosticState {
  stages: readonly ObservedStageTiming[];
}

export class PerformanceTrace implements PerformanceRecorder {
  private readonly stageNames: string[] = [];
  private readonly stageDurations: number[] = [];
  private readonly diagnostics: MarketUpdateDiagnosticState;

  public constructor(
    private readonly profiler: PipelineProfiler,
    private readonly attributionEnabled: boolean,
    messageContext?: MessagePerformanceContext,
  ) {
    this.diagnostics = {
      queueDelayMs: messageContext?.queueDelayMs,
      summaryProcessed: false,
      alertEmitted: false,
      alertPersisted: false,
      recorderFsync: false,
    };

    if (this.attributionEnabled) {
      for (const timing of messageContext?.stages ?? []) {
        this.observe(timing.stage, timing.durationMs);
      }
    }
  }

  public measure<T>(stage: string, operation: () => T): T {
    if (!this.profiler.isEnabled() && !this.attributionEnabled) {
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
    this.profiler.record(stage, durationMs);
    this.observe(stage, durationMs);
  }

  public observe(stage: string, durationMs: number): void {
    if (
      !this.attributionEnabled ||
      !stage ||
      !Number.isFinite(durationMs) ||
      durationMs < 0
    ) {
      return;
    }

    this.stageNames.push(stage);
    this.stageDurations.push(durationMs);
  }

  public updateDiagnostics(values: Partial<MarketUpdateDiagnosticState>): void {
    if (!this.attributionEnabled) {
      return;
    }

    Object.assign(this.diagnostics, values);
  }

  public getSnapshot(): MarketUpdateDiagnosticSnapshot {
    const aggregatedStages = new Map<string, number>();

    for (let index = 0; index < this.stageNames.length; index += 1) {
      const stage = this.stageNames[index];
      const durationMs = this.stageDurations[index];

      if (stage === undefined || durationMs === undefined) {
        continue;
      }

      aggregatedStages.set(
        stage,
        (aggregatedStages.get(stage) ?? 0) + durationMs,
      );
    }

    return {
      ...this.diagnostics,
      stages: [...aggregatedStages.entries()].map(([stage, durationMs]) => ({
        stage,
        durationMs,
      })),
    };
  }
}
