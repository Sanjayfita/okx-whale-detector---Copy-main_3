import { readFileSync } from 'node:fs';

import type { PipelineStageStats } from '../core/PipelineProfiler';
import type { ReplayReport, ReplaySymbolStats } from './replayReport';

export interface NumericComparison {
  baseline: number;
  candidate: number;
  change: number;
  changePercent: number | null;
}

export interface PipelineStageComparison {
  stage: string;
  samples: NumericComparison;
  totalMs: NumericComparison;
  averageMs: NumericComparison;
  maximumMs: NumericComparison;
  averagePerformance: 'FASTER' | 'SLOWER' | 'UNCHANGED';
}

export interface ReplaySymbolComparison {
  orderBookUpdates: NumericComparison;
  candleUpdates: NumericComparison;
  finalActiveWhales: NumericComparison;
}

export interface ReplayReportComparison {
  baselineFile: string;
  candidateFile: string;
  compatibleInput: boolean;
  compatibilityWarnings: string[];
  totals: {
    markets: NumericComparison;
    orderBookUpdates: NumericComparison;
    candleUpdates: NumericComparison;
    totalUpdates: NumericComparison;
    elapsedMs: NumericComparison;
    throughputUpdatesPerSecond: NumericComparison;
  };
  events: {
    sequenceGaps: NumericComparison;
    movedWhales: NumericComparison;
    refillEvents: NumericComparison;
    spoofEvents: NumericComparison;
    summaries: NumericComparison;
    whaleEvents: Record<string, NumericComparison>;
    behaviorEvents: Record<string, NumericComparison>;
  };
  symbols: Record<string, ReplaySymbolComparison>;
  pipeline: PipelineStageComparison[];
}

const compareNumber = (
  baseline: number,
  candidate: number,
): NumericComparison => ({
  baseline,
  candidate,
  change: candidate - baseline,
  changePercent:
    baseline === 0
      ? candidate === 0
        ? 0
        : null
      : ((candidate - baseline) / baseline) * 100,
});

const compareRecord = (
  baseline: Readonly<Record<string, number>>,
  candidate: Readonly<Record<string, number>>,
): Record<string, NumericComparison> => {
  const keys = new Set([...Object.keys(baseline), ...Object.keys(candidate)]);

  return Object.fromEntries(
    [...keys]
      .sort()
      .map((key) => [
        key,
        compareNumber(baseline[key] ?? 0, candidate[key] ?? 0),
      ]),
  );
};

const compareSymbol = (
  baseline: ReplaySymbolStats | undefined,
  candidate: ReplaySymbolStats | undefined,
): ReplaySymbolComparison => ({
  orderBookUpdates: compareNumber(
    baseline?.orderBookUpdates ?? 0,
    candidate?.orderBookUpdates ?? 0,
  ),
  candleUpdates: compareNumber(
    baseline?.candleUpdates ?? 0,
    candidate?.candleUpdates ?? 0,
  ),
  finalActiveWhales: compareNumber(
    baseline?.finalActiveWhales ?? 0,
    candidate?.finalActiveWhales ?? 0,
  ),
});

const indexPipeline = (
  stages: readonly PipelineStageStats[],
): Map<string, PipelineStageStats> =>
  new Map(stages.map((stage) => [stage.stage, stage]));

const comparePipeline = (
  baselineStages: readonly PipelineStageStats[],
  candidateStages: readonly PipelineStageStats[],
): PipelineStageComparison[] => {
  const baseline = indexPipeline(baselineStages);
  const candidate = indexPipeline(candidateStages);
  const stages = new Set([...baseline.keys(), ...candidate.keys()]);

  return [...stages].sort().map((stage) => {
    const baselineStage = baseline.get(stage);
    const candidateStage = candidate.get(stage);
    const averageMs = compareNumber(
      baselineStage?.averageMs ?? 0,
      candidateStage?.averageMs ?? 0,
    );

    return {
      stage,
      samples: compareNumber(
        baselineStage?.samples ?? 0,
        candidateStage?.samples ?? 0,
      ),
      totalMs: compareNumber(
        baselineStage?.totalMs ?? 0,
        candidateStage?.totalMs ?? 0,
      ),
      averageMs,
      maximumMs: compareNumber(
        baselineStage?.maximumMs ?? 0,
        candidateStage?.maximumMs ?? 0,
      ),
      averagePerformance:
        averageMs.change < 0
          ? 'FASTER'
          : averageMs.change > 0
            ? 'SLOWER'
            : 'UNCHANGED',
    };
  });
};

export const compareReplayReports = (
  baselineFile: string,
  baseline: ReplayReport,
  candidateFile: string,
  candidate: ReplayReport,
): ReplayReportComparison => {
  const warnings: string[] = [];

  if (baseline.recordingFile !== candidate.recordingFile) {
    warnings.push('Reports were generated from different recording files.');
  }
  if (baseline.symbolFilter !== candidate.symbolFilter) {
    warnings.push('Reports use different symbol filters.');
  }
  if (baseline.totalUpdates !== candidate.totalUpdates) {
    warnings.push('Reports processed different total update counts.');
  }

  const symbols = new Set([
    ...Object.keys(baseline.symbols),
    ...Object.keys(candidate.symbols),
  ]);

  return {
    baselineFile,
    candidateFile,
    compatibleInput: warnings.length === 0,
    compatibilityWarnings: warnings,
    totals: {
      markets: compareNumber(baseline.markets, candidate.markets),
      orderBookUpdates: compareNumber(
        baseline.orderBookUpdates,
        candidate.orderBookUpdates,
      ),
      candleUpdates: compareNumber(
        baseline.candleUpdates,
        candidate.candleUpdates,
      ),
      totalUpdates: compareNumber(
        baseline.totalUpdates,
        candidate.totalUpdates,
      ),
      elapsedMs: compareNumber(baseline.elapsedMs, candidate.elapsedMs),
      throughputUpdatesPerSecond: compareNumber(
        baseline.throughputUpdatesPerSecond,
        candidate.throughputUpdatesPerSecond,
      ),
    },
    events: {
      sequenceGaps: compareNumber(
        baseline.events.sequenceGaps,
        candidate.events.sequenceGaps,
      ),
      movedWhales: compareNumber(
        baseline.events.movedWhales,
        candidate.events.movedWhales,
      ),
      refillEvents: compareNumber(
        baseline.events.refillEvents,
        candidate.events.refillEvents,
      ),
      spoofEvents: compareNumber(
        baseline.events.spoofEvents,
        candidate.events.spoofEvents,
      ),
      summaries: compareNumber(
        baseline.events.summaries,
        candidate.events.summaries,
      ),
      whaleEvents: compareRecord(
        baseline.events.whaleEvents,
        candidate.events.whaleEvents,
      ),
      behaviorEvents: compareRecord(
        baseline.events.behaviorEvents,
        candidate.events.behaviorEvents,
      ),
    },
    symbols: Object.fromEntries(
      [...symbols]
        .sort()
        .map((symbol) => [
          symbol,
          compareSymbol(baseline.symbols[symbol], candidate.symbols[symbol]),
        ]),
    ),
    pipeline: comparePipeline(baseline.pipeline, candidate.pipeline),
  };
};

export const readReplayReport = (filePath: string): ReplayReport => {
  const value: unknown = JSON.parse(readFileSync(filePath, 'utf8'));

  if (
    typeof value !== 'object' ||
    value === null ||
    !('recordingFile' in value) ||
    !('events' in value) ||
    !('pipeline' in value) ||
    !('symbols' in value)
  ) {
    throw new Error(`Invalid replay report: ${filePath}`);
  }

  return value as ReplayReport;
};
