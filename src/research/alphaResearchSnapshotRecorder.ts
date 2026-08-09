import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';

import { isErrorWithCode } from '../core/errorGuards';
import type { AlphaResearchEventSnapshot } from './alphaFeatureTypes';
import { createAlphaResearchConfig } from './alphaResearchConfig';
import {
  captureAlphaFeatureValues,
  resolveAlphaFeatureVector,
} from './alphaCapturedFeatures';
import { parseAlphaResearchEventSnapshot } from './alphaSnapshotParser';
import { readEvidenceNdjsonFile } from './evidenceNdjson';

interface AlphaSnapshotManifestIdentity {
  readonly evaluationId: string;
  readonly sourceCommit: string;
  readonly configurationFingerprint: string;
  readonly liveOrderExecutionAllowed: false;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const validationConfig = createAlphaResearchConfig();

export class AlphaResearchSnapshotRecorder {
  private readonly manifestPath: string;
  private readonly outputPath: string;
  private manifest?: AlphaSnapshotManifestIdentity;
  private writeChain: Promise<void> = Promise.resolve();
  private readonly recordedAlertIds = new Set<string>();

  public constructor(options: { readonly evaluationDirectory: string }) {
    this.manifestPath = path.join(options.evaluationDirectory, 'manifest.json');
    this.outputPath = path.join(
      options.evaluationDirectory,
      'alpha-snapshots.ndjson',
    );
  }

  public async initialize(): Promise<void> {
    this.manifest = undefined;
    const parsed = JSON.parse(
      await readFile(this.manifestPath, 'utf8'),
    ) as unknown;
    if (
      !isRecord(parsed) ||
      typeof parsed.evaluationId !== 'string' ||
      parsed.evaluationId.trim().length === 0 ||
      parsed.evaluationId !== parsed.evaluationId.trim() ||
      typeof parsed.sourceCommit !== 'string' ||
      parsed.sourceCommit.trim().length === 0 ||
      parsed.sourceCommit !== parsed.sourceCommit.trim() ||
      typeof parsed.configurationFingerprint !== 'string' ||
      parsed.configurationFingerprint.trim().length === 0 ||
      parsed.configurationFingerprint !==
        parsed.configurationFingerprint.trim() ||
      parsed.liveOrderExecutionAllowed !== false
    ) {
      throw new Error('Evaluation manifest identity is invalid');
    }
    const manifest: AlphaSnapshotManifestIdentity = Object.freeze({
      evaluationId: parsed.evaluationId,
      sourceCommit: parsed.sourceCommit,
      configurationFingerprint: parsed.configurationFingerprint,
      liveOrderExecutionAllowed: false,
    });
    let existing: Awaited<
      ReturnType<typeof readEvidenceNdjsonFile<AlphaResearchEventSnapshot>>
    >;
    try {
      existing = await readEvidenceNdjsonFile(
        this.outputPath,
        parseAlphaResearchEventSnapshot,
      );
    } catch (error: unknown) {
      if (!isErrorWithCode(error, 'ENOENT')) throw error;
      existing = Object.freeze({
        records: Object.freeze([]),
        malformed: 0,
        nonEmptyLines: 0,
        issues: Object.freeze([]),
      });
    }
    if (existing.malformed > 0) {
      throw new Error('Alpha research snapshots contain malformed records');
    }
    const alertIds = new Set<string>();
    for (const snapshot of existing.records) {
      resolveAlphaFeatureVector(snapshot, validationConfig);
      const evidence = snapshot.evidence;
      if (
        evidence.evaluationId !== manifest.evaluationId ||
        evidence.sourceCommit !== manifest.sourceCommit ||
        evidence.configurationFingerprint !==
          manifest.configurationFingerprint ||
        alertIds.has(evidence.alertId)
      ) {
        throw new Error('Alpha snapshots violate the frozen evaluation');
      }
      alertIds.add(evidence.alertId);
    }
    this.recordedAlertIds.clear();
    for (const alertId of alertIds) this.recordedAlertIds.add(alertId);
    this.manifest = manifest;
  }

  public async record(snapshot: AlphaResearchEventSnapshot): Promise<void> {
    const manifest = this.manifest;
    if (manifest === undefined) {
      throw new Error(
        'AlphaResearchSnapshotRecorder must be initialized first',
      );
    }
    const validated = parseAlphaResearchEventSnapshot(snapshot);
    if (
      validated === undefined ||
      validated.synthetic ||
      validated.evidence.evaluationId !== manifest.evaluationId ||
      validated.evidence.sourceCommit !== manifest.sourceCommit ||
      validated.evidence.configurationFingerprint !==
        manifest.configurationFingerprint
    ) {
      throw new Error('Alpha snapshot does not match the frozen evaluation');
    }
    resolveAlphaFeatureVector(validated, validationConfig);
    const persisted = captureAlphaFeatureValues(validated, validationConfig);
    const line = `${JSON.stringify(persisted)}\n`;
    const write = this.writeChain.then(async () => {
      if (this.recordedAlertIds.has(validated.evidence.alertId)) {
        throw new Error(
          `Duplicate alpha snapshot ID: ${validated.evidence.alertId}`,
        );
      }
      await appendFile(this.outputPath, line, {
        encoding: 'utf8',
        flush: true,
      });
      this.recordedAlertIds.add(validated.evidence.alertId);
    });
    this.writeChain = write.catch(() => undefined);
    await write;
  }
}
