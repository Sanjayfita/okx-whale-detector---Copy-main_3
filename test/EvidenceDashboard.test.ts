import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { renderEvidenceDashboardHtml } from '../src/tools/serveEvidenceDashboard';

const directories: string[] = [];
const originalCwd = process.cwd();

afterEach(async () => {
  process.chdir(originalCwd);
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('evidence profitability dashboard', () => {
  it('renders a read-only safety banner and primary-horizon sections', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evidence-dashboard-'));
    directories.push(root);
    const directory = join(root, 'data', 'evaluations', 'eval-dashboard');
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'qualified-alerts.ndjson'),
      `${JSON.stringify({
        schemaVersion: 1,
        evaluationId: 'eval-dashboard',
        alertId: 'a1',
        instrumentId: 'BTC-USDT',
        detectedAt: 1_000,
        recordedAt: 1_001,
        direction: 'BULLISH',
        signalType: 'BUY_PRESSURE',
        confidence: 90,
        referencePrice: 100,
        bestBid: 99.9,
        bestAsk: 100.1,
        spreadPercent: 0.2,
        sourceCommit: 'commit',
        configurationFingerprint: 'fingerprint',
        qualified: true,
        liveOrderExecutionAllowed: false,
      })}\n`,
      'utf8',
    );
    await writeFile(
      join(directory, 'outcomes.ndjson'),
      `${JSON.stringify({
        schemaVersion: 1,
        evaluationId: 'eval-dashboard',
        alertId: 'a1',
        instrumentId: 'BTC-USDT',
        detectedAt: 1_000,
        horizonMinutes: 15,
        observedAt: 901_000,
        referencePrice: 100,
        observedPrice: 101,
        rawReturnPercent: 1,
        directionAdjustedReturnPercent: 1,
        maximumFavorableExcursionPercent: 1.2,
        maximumAdverseExcursionPercent: 0.3,
        complete: true,
        liveOrderExecutionAllowed: false,
      })}\n`,
      'utf8',
    );

    process.chdir(root);
    const html = await renderEvidenceDashboardHtml('eval-dashboard');

    expect(html).toContain('Evidence Profitability Dashboard');
    expect(html).toContain('READ ONLY · EXECUTION DISABLED');
    expect(html).toContain('Descriptive performance by horizon');
    expect(html).toContain('Independent episodes');
    expect(html).toContain('Primary 15m performance by instrument');
    expect(html).toContain('BTC-USDT');
    expect(html).toContain('INSUFFICIENT DATA');
  });
});
