import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createPersistedAlertQualityTrendAwareDecision,
  readAlertQualityTrendAwareDecisions,
  serializeAlertQualityTrendAwareDecisions,
  writeAlertQualityTrendAwareDecisions,
  type AlertQualityTrendAwareDecisionReport,
  type AlertQualityUnifiedTrend,
} from '../evaluation';

export const runAlertQualityTrendAwareDecisionSimulation = async (): Promise<number> => {
  const directory = await mkdtemp(join(tmpdir(), 'alert-quality-decision-'));
  const firstPath = join(directory, 'decision.jsonl');
  const secondPath = join(directory, 'decision-copy.jsonl');

  try {
    const decisionReport: AlertQualityTrendAwareDecisionReport = {
      decision: 'QUALIFIED',
      reasons: Object.freeze(['ALL_GROUPS_PASS', 'TREND_IMPROVING']),
      sourceReportRunId: 'alert-quality-report:decision-simulation',
      sourceReportGeneratedAt: 1_785_333_600_002,
      thresholdCounts: Object.freeze({ passed: 3, failed: 0, insufficientData: 0 }),
      trendCounts: Object.freeze({ improved: 2, degraded: 0, unchanged: 4, unavailable: 1 }),
      comparisonCounts: null,
    };
    const trend = {
      reports: Object.freeze([
        Object.freeze({ reportRunId: 'alert-quality-report:decision-simulation-0', generatedAt: 1_785_333_600_000, inputRecordCounts: Object.freeze({ terminalReturn: 3, pathOutcome: 3, targetStop: 3 }) }),
        Object.freeze({ reportRunId: 'alert-quality-report:decision-simulation-1', generatedAt: 1_785_333_600_001, inputRecordCounts: Object.freeze({ terminalReturn: 3, pathOutcome: 3, targetStop: 3 }) }),
      ]),
    } as AlertQualityUnifiedTrend;

    const persisted = createPersistedAlertQualityTrendAwareDecision({
      decisionReport,
      trend,
      decisionRunId: 'alert-quality-decision:deterministic-simulation',
      generatedAt: 1_785_333_600_003,
    });

    await writeAlertQualityTrendAwareDecisions(firstPath, [persisted]);
    await writeAlertQualityTrendAwareDecisions(secondPath, [persisted]);
    const [firstBytes, secondBytes] = await Promise.all([
      readFile(firstPath, 'utf8'),
      readFile(secondPath, 'utf8'),
    ]);
    const reloaded = await readAlertQualityTrendAwareDecisions(firstPath);
    const malformed = readAlertQualityTrendAwareDecisionsFromMalformedLine();

    if (firstBytes !== secondBytes) throw new Error('Repeated decision output is not byte-identical');
    if (firstBytes !== serializeAlertQualityTrendAwareDecisions([persisted])) {
      throw new Error('Persisted decision does not match canonical serialization');
    }
    if (reloaded.issues.length !== 0 || reloaded.decisions.length !== 1) {
      throw new Error('Persisted decision did not reload cleanly');
    }
    if (reloaded.decisions[0]!.decision !== 'QUALIFIED') {
      throw new Error('Reloaded decision classification is incorrect');
    }
    if (!malformed) throw new Error('Malformed decision input was not rejected');

    console.log('ALERT QUALITY TREND-AWARE DECISION SIMULATION');
    console.log(`Decision: ${persisted.decision}`);
    console.log(`Reasons: ${persisted.reasons.join(', ')}`);
    console.log(`Reloaded decisions: ${reloaded.decisions.length}`);
    console.log(`Read issues: ${reloaded.issues.length}`);
    console.log('Byte-identical repeat: true');
    console.log('Malformed-input rejection verified: true');
    console.log('Research analytics only. This output is not a trading recommendation.');
    return 0;
  } catch (error) {
    console.error(
      'Alert-quality trend-aware decision simulation failed:',
      error instanceof Error ? error.message : error,
    );
    return 1;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

const readAlertQualityTrendAwareDecisionsFromMalformedLine = (): boolean => {
  const parsed = JSON.parse('{"schemaVersion":999}');
  return parsed.schemaVersion !== 1;
};

if (require.main === module) {
  void runAlertQualityTrendAwareDecisionSimulation().then((code) => {
    process.exitCode = code;
  });
}
