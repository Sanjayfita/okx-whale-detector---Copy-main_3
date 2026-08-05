import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  readOfflineResearchPipelinePlan,
  runOfflineResearchPipeline,
} from '../src/research/offlineResearchPipeline';
import { readResearchSessionManifest } from '../src/research/researchSessionManifest';

const directories: string[] = [];

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'offline-research-pipeline-'));
  directories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe('offline research pipeline', () => {
  it('runs steps in order and writes a completed manifest', async () => {
    const directory = await temporaryDirectory();
    const manifestPath = join(directory, 'session', 'manifest.json');
    const calls: string[] = [];
    const plan = {
      sessionId: 'research-session:stable',
      createdAt: 1_700_000_000_000,
      instrumentIds: ['ETH-USDT', 'BTC-USDT', 'BTC-USDT'],
      manifestPath,
      steps: [
        {
          id: 'alignment',
          command: 'node',
          args: ['alignment.js'],
          artifacts: [
            {
              kind: 'ALIGNMENT_EVALUATIONS' as const,
              path: 'alignment.jsonl',
              runId: 'alignment-run:stable',
            },
          ],
        },
        {
          id: 'returns',
          command: 'node',
          args: ['returns.js'],
          artifacts: [
            {
              kind: 'TERMINAL_RETURNS' as const,
              path: 'returns.jsonl',
              runId: 'terminal-return-run:stable',
            },
          ],
        },
      ],
    };

    const result = await runOfflineResearchPipeline({
      plan,
      now: () => 1_700_000_000_100,
      runCommand: async ({ command, args }) => {
        calls.push([command, ...args].join(' '));
        return 0;
      },
    });

    expect(calls).toEqual(['node alignment.js', 'node returns.js']);
    expect(result.manifest.status).toBe('COMPLETED');
    expect(result.manifest.instrumentIds).toEqual(['BTC-USDT', 'ETH-USDT']);
    expect(result.manifest.artifacts).toHaveLength(2);
    expect((await readResearchSessionManifest(manifestPath)).status).toBe('COMPLETED');
  });

  it('writes a failed manifest and stops after the first failing step', async () => {
    const directory = await temporaryDirectory();
    const manifestPath = join(directory, 'manifest.json');
    let calls = 0;
    const plan = {
      sessionId: 'research-session:failed',
      createdAt: 10,
      instrumentIds: ['BTC-USDT'],
      manifestPath,
      steps: [
        { id: 'first', command: 'node', args: ['first.js'], artifacts: [] },
        { id: 'second', command: 'node', args: ['second.js'], artifacts: [] },
      ],
    };

    await expect(
      runOfflineResearchPipeline({
        plan,
        now: () => 11,
        runCommand: async () => {
          calls += 1;
          return 2;
        },
      }),
    ).rejects.toThrow('first failed with exit code 2');

    expect(calls).toBe(1);
    expect((await readResearchSessionManifest(manifestPath)).status).toBe('FAILED');
  });

  it('loads and validates a JSON plan', async () => {
    const directory = await temporaryDirectory();
    const planPath = join(directory, 'plan.json');
    await writeFile(
      planPath,
      JSON.stringify({
        sessionId: 'research-session:plan',
        createdAt: 20,
        instrumentIds: ['BTC-USDT'],
        manifestPath: join(directory, 'manifest.json'),
        steps: [{ id: 'quality', command: 'node', args: [], artifacts: [] }],
      }),
      'utf8',
    );

    const plan = await readOfflineResearchPipelinePlan(planPath);
    expect(plan.steps[0]?.id).toBe('quality');
    expect(await readFile(planPath, 'utf8')).toContain('research-session:plan');
  });

  it('rejects duplicate step identifiers', async () => {
    await expect(
      runOfflineResearchPipeline({
        plan: {
          sessionId: 'research-session:duplicate',
          createdAt: 30,
          instrumentIds: ['BTC-USDT'],
          manifestPath: 'manifest.json',
          steps: [
            { id: 'same', command: 'node', args: [], artifacts: [] },
            { id: 'same', command: 'node', args: [], artifacts: [] },
          ],
        },
        runCommand: async () => 0,
      }),
    ).rejects.toThrow('Duplicate pipeline step id');
  });
});
