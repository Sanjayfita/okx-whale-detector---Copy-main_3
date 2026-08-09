import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  inspectResearchSession,
  readResearchSessionManifest,
  runOfflineResearchPipeline,
  serializeResearchSessionManifest,
} from '../research';

export const runOfflineResearchPipelineSimulation = async (
  log: (...values: unknown[]) => void = console.log,
): Promise<void> => {
  const directory = await mkdtemp(join(tmpdir(), 'offline-research-pipeline-'));
  const manifestPath = join(directory, 'manifest.json');
  const artifactPath = join(directory, 'quality-report.jsonl');

  try {
    const plan = {
      sessionId: 'research-session:deterministic-simulation',
      createdAt: 1_785_333_600_000,
      instrumentIds: ['BTC-USDT'],
      notes: 'Deterministic offline research pipeline simulation',
      manifestPath,
      steps: [
        {
          id: 'quality-report',
          command: 'simulate-quality-report',
          args: ['--output', artifactPath],
          artifacts: [
            {
              kind: 'QUALITY_REPORT' as const,
              path: artifactPath,
              runId: 'alert-quality-report:offline-pipeline-simulation',
            },
          ],
        },
      ],
    };

    const result = await runOfflineResearchPipeline({
      plan,
      now: () => 1_785_333_600_001,
      runCommand: async ({ command, args }) => {
        if (command !== 'simulate-quality-report' || args[0] !== '--output' || !args[1]) {
          return 1;
        }
        await writeFile(args[1], '{"simulation":true}\n', 'utf8');
        return 0;
      },
    });

    const persisted = await readResearchSessionManifest(manifestPath);
    const firstBytes = await readFile(manifestPath, 'utf8');
    const repeatedBytes = serializeResearchSessionManifest(persisted);
    const inspection = await inspectResearchSession({ manifestPath, manifest: persisted });

    if (result.manifest.status !== 'COMPLETED') throw new Error('Pipeline did not complete');
    if (result.stepResults.length !== 1 || result.stepResults[0]?.exitCode !== 0) {
      throw new Error('Pipeline step result was not successful');
    }
    if (firstBytes !== repeatedBytes) throw new Error('Manifest serialization was not deterministic');
    if (!inspection.complete || inspection.missingArtifactCount !== 0) {
      throw new Error('Completed pipeline did not pass inspection');
    }

    log('OFFLINE RESEARCH PIPELINE SIMULATION');
    log(`Session: ${persisted.sessionId}`);
    log(`Status: ${persisted.status}`);
    log(`Steps completed: ${result.stepResults.length}`);
    log(`Artifacts: ${persisted.artifacts.length}`);
    log(`Inspection complete: ${inspection.complete}`);
    log(`Byte-identical manifest repeat: ${firstBytes === repeatedBytes}`);
    log('Research analytics only. No orders are placed.');
  } finally {
    await rm(directory, { recursive: true, force: true });
    log('Temporary offline research outputs cleaned up: true');
  }
};

const main = async (): Promise<void> => {
  await runOfflineResearchPipelineSimulation();
};

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(
      `Offline research pipeline simulation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
