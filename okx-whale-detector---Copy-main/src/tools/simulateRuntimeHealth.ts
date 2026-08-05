import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRuntimeHealthSnapshot } from '../observability/runtimeHealth';
import {
  createRuntimeHealthDocument,
  readRuntimeHealthDocument,
  serializeRuntimeHealthDocument,
  writeRuntimeHealthDocument,
} from '../observability/runtimeHealthPersistence';
import { runInspectRuntimeHealthCli } from './inspectRuntimeHealth';

export interface RuntimeHealthSimulationResult {
  healthyInspectionExitCode: number;
  unhealthyInspectionExitCode: number;
  healthyStatus: string;
  unhealthyStatus: string;
  byteIdenticalRepeat: boolean;
  inspectionVerified: boolean;
  cleanupVerified: boolean;
}

export const runRuntimeHealthSimulation = async (): Promise<RuntimeHealthSimulationResult> => {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-health-simulation-'));
  const healthyPath = join(directory, 'healthy.json');
  const healthyCopyPath = join(directory, 'healthy-copy.json');
  const unhealthyPath = join(directory, 'unhealthy.json');
  let cleanupVerified = false;

  try {
    const healthySnapshot = createRuntimeHealthSnapshot({
      generatedAt: 1_800_000_060_000,
      startedAt: 1_800_000_000_000,
      components: [
        {
          name: 'order-book',
          status: 'HEALTHY',
          observedAt: 1_800_000_059_000,
          metrics: { syncedInstruments: 3 },
        },
        {
          name: 'websocket',
          status: 'DEGRADED',
          observedAt: 1_800_000_058_000,
          message: 'One reconnect observed',
          metrics: { reconnects: 1 },
        },
      ],
    });
    const healthyDocument = createRuntimeHealthDocument(healthySnapshot);
    await writeRuntimeHealthDocument(healthyPath, healthyDocument);
    await writeRuntimeHealthDocument(healthyCopyPath, healthyDocument);

    const unhealthySnapshot = createRuntimeHealthSnapshot({
      generatedAt: 1_800_000_120_000,
      startedAt: 1_800_000_000_000,
      components: [
        {
          name: 'recorder',
          status: 'UNHEALTHY',
          observedAt: 1_800_000_119_000,
          message: 'Recording output is unavailable',
          metrics: { writeFailures: 2 },
        },
      ],
    });
    await writeRuntimeHealthDocument(
      unhealthyPath,
      createRuntimeHealthDocument(unhealthySnapshot),
    );

    const logs: string[] = [];
    const errors: string[] = [];
    const healthyInspectionExitCode = await runInspectRuntimeHealthCli(
      ['--file', healthyPath],
      { log: (message) => logs.push(message), error: (message) => errors.push(message) },
    );
    const unhealthyInspectionExitCode = await runInspectRuntimeHealthCli(
      ['--file', unhealthyPath],
      { log: (message) => logs.push(message), error: (message) => errors.push(message) },
    );

    const reloadedHealthy = await readRuntimeHealthDocument(healthyPath);
    const firstBytes = await readFile(healthyPath, 'utf8');
    const secondBytes = await readFile(healthyCopyPath, 'utf8');
    const byteIdenticalRepeat = firstBytes === secondBytes;
    const inspectionVerified =
      healthyInspectionExitCode === 0 &&
      unhealthyInspectionExitCode === 1 &&
      errors.length === 0 &&
      logs.some((line) => line === 'Status: DEGRADED') &&
      logs.some((line) => line === 'Status: UNHEALTHY') &&
      serializeRuntimeHealthDocument(reloadedHealthy) === firstBytes;

    console.log('RUNTIME HEALTH SIMULATION');
    console.log(`Healthy inspection exit code: ${healthyInspectionExitCode}`);
    console.log(`Unhealthy inspection exit code: ${unhealthyInspectionExitCode}`);
    console.log(`Healthy snapshot status: ${healthySnapshot.status}`);
    console.log(`Unhealthy snapshot status: ${unhealthySnapshot.status}`);
    console.log(`Byte-identical repeat: ${byteIdenticalRepeat}`);
    console.log(`Inspection verified: ${inspectionVerified}`);
    console.log('Observability simulation only. No orders are placed.');

    if (!byteIdenticalRepeat || !inspectionVerified) {
      throw new Error('Runtime health simulation verification failed');
    }

    return {
      healthyInspectionExitCode,
      unhealthyInspectionExitCode,
      healthyStatus: healthySnapshot.status,
      unhealthyStatus: unhealthySnapshot.status,
      byteIdenticalRepeat,
      inspectionVerified,
      cleanupVerified,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
    cleanupVerified = true;
  }
};

if (require.main === module) {
  void runRuntimeHealthSimulation().catch((cause) => {
    console.error(
      `Runtime health simulation failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    process.exitCode = 1;
  });
}
