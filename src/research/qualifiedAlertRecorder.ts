import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';

import { isErrorWithCode } from '../core/errorGuards';
import { readEvidenceNdjsonFile } from './evidenceNdjson';
import {
  parseQualifiedAlertEvidenceRecord,
  type QualifiedAlertEvidenceRecord,
} from './qualifiedAlertEvidence';

interface EvaluationManifestIdentity {
  evaluationId: string;
  sourceCommit: string;
  configurationFingerprint: string;
  liveOrderExecutionAllowed: false;
}

export interface QualifiedAlertRecorderOptions {
  evaluationDirectory: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export class QualifiedAlertRecorder {
  private readonly manifestPath: string;
  private readonly outputPath: string;
  private manifest?: EvaluationManifestIdentity;
  private writeChain: Promise<void> = Promise.resolve();
  private readonly recordedAlertIds = new Set<string>();

  constructor(options: QualifiedAlertRecorderOptions) {
    this.manifestPath = path.join(options.evaluationDirectory, 'manifest.json');
    this.outputPath = path.join(
      options.evaluationDirectory,
      'qualified-alerts.ndjson',
    );
  }

  async initialize(): Promise<void> {
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

    const manifest: EvaluationManifestIdentity = {
      evaluationId: parsed.evaluationId,
      sourceCommit: parsed.sourceCommit,
      configurationFingerprint: parsed.configurationFingerprint,
      liveOrderExecutionAllowed: false,
    };

    let existing: Awaited<
      ReturnType<typeof readEvidenceNdjsonFile<QualifiedAlertEvidenceRecord>>
    >;
    try {
      existing = await readEvidenceNdjsonFile(
        this.outputPath,
        parseQualifiedAlertEvidenceRecord,
      );
    } catch (error: unknown) {
      if (!isErrorWithCode(error, 'ENOENT')) {
        throw error;
      }
      existing = Object.freeze({
        records: Object.freeze([]),
        malformed: 0,
        nonEmptyLines: 0,
        issues: Object.freeze([]),
      });
    }
    if (existing.malformed > 0) {
      throw new Error('Qualified alert evidence contains malformed records');
    }

    const recordedAlertIds = new Set<string>();
    for (const record of existing.records) {
      if (
        record.evaluationId !== manifest.evaluationId ||
        record.sourceCommit !== manifest.sourceCommit ||
        record.configurationFingerprint !== manifest.configurationFingerprint ||
        recordedAlertIds.has(record.alertId)
      ) {
        throw new Error(
          'Qualified alert evidence violates the frozen evaluation',
        );
      }
      recordedAlertIds.add(record.alertId);
    }

    this.recordedAlertIds.clear();
    for (const alertId of recordedAlertIds) {
      this.recordedAlertIds.add(alertId);
    }
    this.manifest = manifest;
  }

  async record(record: QualifiedAlertEvidenceRecord): Promise<void> {
    const manifest = this.manifest;
    if (manifest === undefined) {
      throw new Error('QualifiedAlertRecorder must be initialized first');
    }

    const validatedRecord = parseQualifiedAlertEvidenceRecord(record);

    if (
      !validatedRecord ||
      validatedRecord.evaluationId !== manifest.evaluationId ||
      validatedRecord.sourceCommit !== manifest.sourceCommit ||
      validatedRecord.configurationFingerprint !==
        manifest.configurationFingerprint
    ) {
      throw new Error('Qualified alert does not match the frozen evaluation');
    }

    const line = `${JSON.stringify(validatedRecord)}\n`;
    const write = this.writeChain.then(async () => {
      if (this.recordedAlertIds.has(validatedRecord.alertId)) {
        throw new Error(
          `Duplicate qualified alert ID: ${validatedRecord.alertId}`,
        );
      }

      await appendFile(this.outputPath, line, {
        encoding: 'utf8',
        flush: true,
      });
      this.recordedAlertIds.add(validatedRecord.alertId);
    });
    this.writeChain = write.catch(() => undefined);
    await write;
  }
}
