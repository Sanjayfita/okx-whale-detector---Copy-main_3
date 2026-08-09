import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  compareReplayReports,
  readReplayReport,
  type NumericComparison,
} from '../recording/replayReportComparison';

const formatChange = (comparison: NumericComparison): string => {
  const sign = comparison.change > 0 ? '+' : '';
  const percent =
    comparison.changePercent === null
      ? 'n/a'
      : `${comparison.changePercent >= 0 ? '+' : ''}${comparison.changePercent.toFixed(2)}%`;

  return `${comparison.baseline.toFixed(4)} → ${comparison.candidate.toFixed(4)} (${sign}${comparison.change.toFixed(4)}, ${percent})`;
};

const run = (): void => {
  const [baselineFile, candidateFile, outputFile] = process.argv.slice(2);

  if (!baselineFile || !candidateFile) {
    throw new Error(
      'Usage: npm run replay:compare -- <baseline-report.json> <candidate-report.json> [comparison-output.json]',
    );
  }

  const baseline = readReplayReport(baselineFile);
  const candidate = readReplayReport(candidateFile);
  const comparison = compareReplayReports(
    baselineFile,
    baseline,
    candidateFile,
    candidate,
  );

  console.log('\nREPLAY REPORT COMPARISON');
  console.log(`Baseline: ${baselineFile}`);
  console.log(`Candidate: ${candidateFile}`);
  console.log(`Compatible input: ${comparison.compatibleInput ? 'yes' : 'no'}`);

  for (const warning of comparison.compatibilityWarnings) {
    console.warn(`Warning: ${warning}`);
  }

  console.log('\nTOTALS');
  console.log(`Elapsed: ${formatChange(comparison.totals.elapsedMs)}`);
  console.log(
    `Throughput: ${formatChange(comparison.totals.throughputUpdatesPerSecond)}`,
  );
  const newWhaleEvents = comparison.events.whaleEvents.NEW;
  if (newWhaleEvents === undefined) {
    throw new Error('Replay comparison is missing NEW whale-event totals');
  }
  console.log(`Final whale events: ${formatChange(newWhaleEvents)} NEW`);
  console.log(`Sequence gaps: ${formatChange(comparison.events.sequenceGaps)}`);

  console.log('\nPIPELINE AVERAGE TIME');
  for (const stage of comparison.pipeline) {
    console.log(
      `${stage.stage}: ${formatChange(stage.averageMs)} [${stage.averagePerformance}]`,
    );
  }

  if (outputFile) {
    mkdirSync(path.dirname(outputFile), { recursive: true });
    writeFileSync(
      outputFile,
      `${JSON.stringify(comparison, null, 2)}\n`,
      'utf8',
    );
    console.log(`\nComparison report: ${outputFile}`);
  }
};

try {
  run();
} catch (error: unknown) {
  console.error(
    'Replay report comparison failed:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
}
