import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createResearchDashboardSnapshot } from '../dashboard/researchDashboard';
import {
  createResearchDashboardDocument,
  readResearchDashboardDocument,
  serializeResearchDashboardDocument,
  writeResearchDashboardDocument,
} from '../dashboard/researchDashboardPersistence';
import { createRuntimeHealthSnapshot } from '../observability/runtimeHealth';
import { inspectRecordingIntegrityFromText } from '../recording/recordingIntegrity';
import { runInspectResearchDashboardCli } from './inspectResearchDashboard';

export interface ResearchDashboardSimulationResult {
  readyDashboardVerified: boolean;
  warningDashboardVerified: boolean;
  blockedDashboardVerified: boolean;
  persistenceVerified: boolean;
  canonicalSerializationStable: boolean;
  inspectorExitCodesVerified: boolean;
}

export const runResearchDashboardSimulation = async (): Promise<ResearchDashboardSimulationResult> => {
  const directory = await mkdtemp(join(tmpdir(), 'research-dashboard-simulation-'));
  const readyPath = join(directory, 'ready-dashboard.json');
  const blockedPath = join(directory, 'blocked-dashboard.json');

  try {
    const generatedAt = 1_700_000_010_000;
    const healthyRuntime = createRuntimeHealthSnapshot({
      generatedAt,
      startedAt: 1_700_000_000_000,
      components: [
        {
          name: 'market-data',
          status: 'HEALTHY',
          observedAt: generatedAt,
          metrics: { messages: 120 },
        },
      ],
    });
    const degradedRuntime = createRuntimeHealthSnapshot({
      generatedAt,
      startedAt: 1_700_000_000_000,
      components: [
        {
          name: 'market-data',
          status: 'DEGRADED',
          observedAt: generatedAt,
          message: 'One reconnect observed',
          metrics: { reconnects: 1 },
        },
      ],
    });

    const validRecording = inspectRecordingIntegrityFromText({
      filePath: 'valid.jsonl',
      text: '{"timestamp":1}\n{"timestamp":2}\n',
    });
    const invalidRecording = inspectRecordingIntegrityFromText({
      filePath: 'invalid.jsonl',
      text: '{"timestamp":2}\n{"timestamp":1}\n',
    });

    const readySnapshot = createResearchDashboardSnapshot({
      generatedAt,
      runtimeHealth: healthyRuntime,
      recordings: [validRecording],
      researchSessions: [{ sessionId: 'session-ready', completed: true }],
      strategyCandidates: [{ candidateId: 'candidate-ready', evaluated: true }],
    });
    const warningSnapshot = createResearchDashboardSnapshot({
      generatedAt,
      runtimeHealth: degradedRuntime,
      recordings: [validRecording],
      researchSessions: [{ sessionId: 'session-warning', completed: false }],
      strategyCandidates: [{ candidateId: 'candidate-warning', evaluated: false }],
    });
    const blockedSnapshot = createResearchDashboardSnapshot({
      generatedAt,
      runtimeHealth: healthyRuntime,
      recordings: [validRecording, invalidRecording],
      researchSessions: [{ sessionId: 'session-blocked', completed: true }],
      strategyCandidates: [{ candidateId: 'candidate-blocked', evaluated: true }],
    });

    const readyDocument = createResearchDashboardDocument(readySnapshot);
    const blockedDocument = createResearchDashboardDocument(blockedSnapshot);
    await writeResearchDashboardDocument(readyPath, readyDocument);
    await writeResearchDashboardDocument(blockedPath, blockedDocument);

    const reloaded = await readResearchDashboardDocument(readyPath);
    const persistedText = await readFile(readyPath, 'utf8');
    const readyExitCode = await runInspectResearchDashboardCli(['--file', readyPath], {
      log: () => undefined,
      error: () => undefined,
    });
    const blockedExitCode = await runInspectResearchDashboardCli(['--file', blockedPath], {
      log: () => undefined,
      error: () => undefined,
    });

    return {
      readyDashboardVerified:
        readySnapshot.status === 'READY' && readySnapshot.reasons.length === 0,
      warningDashboardVerified:
        warningSnapshot.status === 'WARNING' && warningSnapshot.reasons.length === 3,
      blockedDashboardVerified:
        blockedSnapshot.status === 'BLOCKED' &&
        blockedSnapshot.invalidRecordingPaths[0] === 'invalid.jsonl',
      persistenceVerified:
        reloaded.schemaVersion === 1 && reloaded.snapshot.status === 'READY',
      canonicalSerializationStable:
        persistedText === serializeResearchDashboardDocument(reloaded),
      inspectorExitCodesVerified: readyExitCode === 0 && blockedExitCode === 1,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

const main = async (): Promise<void> => {
  const result = await runResearchDashboardSimulation();
  const passed = Object.values(result).every(Boolean);
  process.stdout.write(`${JSON.stringify({ passed, ...result }, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
};

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `Research dashboard simulation failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    process.exitCode = 1;
  });
}
