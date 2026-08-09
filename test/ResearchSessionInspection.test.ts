import { describe, expect, it } from 'vitest';

import { inspectResearchSession } from '../src/research/researchSessionInspection';
import { createResearchSessionManifest } from '../src/research/researchSessionManifest';

describe('research session inspection', () => {
  const manifest = createResearchSessionManifest({
    sessionId: 'research-session:inspection',
    createdAt: 1,
    updatedAt: 2,
    status: 'COMPLETED',
    instrumentIds: ['BTC-USDT'],
    artifacts: [
      { kind: 'QUALITY_REPORT', path: 'quality.jsonl', runId: 'quality:1' },
      { kind: 'QUALITY_TREND', path: 'trend.jsonl', runId: 'trend:1' },
    ],
  });

  it('reports a completed session when all artifacts exist', async () => {
    const inspection = await inspectResearchSession({
      manifestPath: 'research/session/manifest.json',
      manifest,
      fileExists: async () => true,
    });

    expect(inspection.existingArtifactCount).toBe(2);
    expect(inspection.missingArtifactCount).toBe(0);
    expect(inspection.complete).toBe(true);
  });

  it('reports missing artifacts and an incomplete session', async () => {
    const inspection = await inspectResearchSession({
      manifestPath: 'research/session/manifest.json',
      manifest,
      fileExists: async (path) => !path.endsWith('trend.jsonl'),
    });

    expect(inspection.existingArtifactCount).toBe(1);
    expect(inspection.missingArtifactCount).toBe(1);
    expect(inspection.complete).toBe(false);
    expect(inspection.artifacts.find((entry) => !entry.exists)?.artifact.kind).toBe(
      'QUALITY_TREND',
    );
  });

  it('does not classify a running manifest as complete', async () => {
    const running = createResearchSessionManifest({
      sessionId: 'research-session:running',
      createdAt: 1,
      status: 'RUNNING',
      instrumentIds: ['BTC-USDT'],
    });
    const inspection = await inspectResearchSession({
      manifestPath: 'manifest.json',
      manifest: running,
      fileExists: async () => true,
    });

    expect(inspection.complete).toBe(false);
  });
});
