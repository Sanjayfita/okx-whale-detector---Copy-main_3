import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { PipelineStageStats } from '../core/PipelineProfiler';
import type { ReplayEventTotals } from './ReplayAnalyticsReporter';
import type { ReplaySpeed } from './replayOptions';

export interface ReplaySymbolStats {
  orderBookUpdates: number;
  candleUpdates: number;
  finalActiveWhales: number;
}

export interface ReplayReport {
  generatedAt: string;
  recordingFile: string;
  symbolFilter: string | null;
  speed: string;
  markets: number;
  orderBookUpdates: number;
  candleUpdates: number;
  totalUpdates: number;
  elapsedMs: number;
  throughputUpdatesPerSecond: number;
  events: ReplayEventTotals;
  pipeline: readonly PipelineStageStats[];
  symbols: Record<string, ReplaySymbolStats>;
}

export const formatReplaySpeed = (speed: ReplaySpeed): string =>
  typeof speed === 'number' ? `${speed}x` : speed;

export const resolveReplayReportPath = (
  recordingFile: string,
  requestedPath?: string,
): string => {
  if (requestedPath) {
    return requestedPath;
  }

  const parsed = path.parse(recordingFile);
  return path.join('data', 'reports', `${parsed.name}-replay-report.json`);
};

export const writeReplayReport = (
  reportPath: string,
  report: ReplayReport,
): void => {
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
};
