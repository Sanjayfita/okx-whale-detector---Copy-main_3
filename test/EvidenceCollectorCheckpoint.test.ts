import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { EvidenceCollectorCheckpointStore, THIRTY_DAYS_MS } from '../src/research/evidenceCollectorCheckpoint';
import { EvidenceCoverageGapStore } from '../src/research/evidenceCoverageGap';

describe('EvidenceCollectorCheckpointStore', () => {
  it('preserves the original 30-day target and records unexpected downtime on restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'checkpoint-'));
    await writeFile(join(directory, 'coverage-gaps.ndjson'), '');
    const gaps = new EvidenceCoverageGapStore(directory);
    await gaps.initialize();
    const firstStore = new EvidenceCollectorCheckpointStore(directory, 'eval-1', gaps);
    const first = await firstStore.initialize(1_000);
    expect(first.targetEndAt).toBe(1_000 + THIRTY_DAYS_MS);
    await firstStore.heartbeat(2_000);

    const secondGaps = new EvidenceCoverageGapStore(directory);
    await secondGaps.initialize();
    const secondStore = new EvidenceCollectorCheckpointStore(directory, 'eval-1', secondGaps);
    const second = await secondStore.initialize(5_000);
    expect(second.firstStartedAt).toBe(1_000);
    expect(second.targetEndAt).toBe(first.targetEndAt);
    expect(second.sessionSequence).toBe(2);
    const text = await readFile(join(directory, 'coverage-gaps.ndjson'), 'utf8');
    expect(text).toContain('PROCESS_DOWNTIME');
    expect(text).toContain('COLLECTOR_PROCESS_NOT_RUNNING_UNEXPECTEDLY');
  });

  it('records intentional stopped time without resetting the target', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'checkpoint-clean-'));
    await writeFile(join(directory, 'coverage-gaps.ndjson'), '');
    const gaps = new EvidenceCoverageGapStore(directory); await gaps.initialize();
    const first = new EvidenceCollectorCheckpointStore(directory, 'eval-2', gaps);
    const initial = await first.initialize(10_000);
    await first.cleanStop(20_000);
    const gaps2 = new EvidenceCoverageGapStore(directory); await gaps2.initialize();
    const second = new EvidenceCollectorCheckpointStore(directory, 'eval-2', gaps2);
    const resumed = await second.initialize(30_000);
    expect(resumed.targetEndAt).toBe(initial.targetEndAt);
    expect(await readFile(join(directory, 'coverage-gaps.ndjson'), 'utf8')).toContain('COLLECTOR_INTENTIONALLY_STOPPED');
  });
});
