import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createResearchSessionManifest,
  readResearchSessionManifest,
  readResearchSessionManifestFromText,
  serializeResearchSessionManifest,
  writeResearchSessionManifest,
} from '../src/research';

const createManifest = () =>
  createResearchSessionManifest({
    sessionId: 'research-session:test-1',
    createdAt: 1_700_000_000_000,
    status: 'COMPLETED',
    instrumentIds: ['ETH-USDT', 'BTC-USDT', 'BTC-USDT'],
    notes: '  deterministic research run  ',
    artifacts: [
      { kind: 'QUALITY_REPORT', path: 'output/quality.jsonl', runId: 'quality-run:1' },
      { kind: 'MARKET_RECORDING', path: 'input/market.jsonl', runId: 'recording:1' },
    ],
  });

describe('research session manifest', () => {
  it('normalizes and serializes deterministically', () => {
    const manifest = createManifest();
    expect(manifest.instrumentIds).toEqual(['BTC-USDT', 'ETH-USDT']);
    expect(manifest.notes).toBe('deterministic research run');
    expect(serializeResearchSessionManifest(manifest)).toBe(
      serializeResearchSessionManifest(createManifest()),
    );
  });

  it('round-trips through text', () => {
    const manifest = createManifest();
    expect(readResearchSessionManifestFromText(serializeResearchSessionManifest(manifest))).toEqual(
      manifest,
    );
  });

  it('writes and reloads a manifest file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'research-session-manifest-'));
    const filePath = join(directory, 'manifest.json');
    try {
      await writeResearchSessionManifest(filePath, createManifest());
      expect(await readResearchSessionManifest(filePath)).toEqual(createManifest());
      expect((await readFile(filePath, 'utf8')).endsWith('\n')).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects malformed or unsupported manifests', () => {
    expect(() => readResearchSessionManifestFromText('{bad')).toThrow(
      'Malformed research session manifest JSON',
    );
    expect(() =>
      readResearchSessionManifestFromText(
        JSON.stringify({ ...createManifest(), schemaVersion: 999 }),
      ),
    ).toThrow('Unsupported research session manifest schema version');
  });

  it('rejects invalid chronology and empty instruments', () => {
    expect(() =>
      createResearchSessionManifest({
        sessionId: 'research-session:bad-time',
        createdAt: 2,
        updatedAt: 1,
        instrumentIds: ['BTC-USDT'],
      }),
    ).toThrow('updatedAt cannot be earlier than createdAt');
    expect(() =>
      createResearchSessionManifest({
        sessionId: 'research-session:no-instruments',
        createdAt: 1,
        instrumentIds: [],
      }),
    ).toThrow('instrumentIds must contain at least one instrument');
  });
});
