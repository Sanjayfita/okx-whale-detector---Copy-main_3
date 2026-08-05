import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { canonicalJsonStringify } from '../evaluation/canonicalJson';
import { isErrorWithCode } from '../core/errorGuards';

export const EVIDENCE_SOURCE_FILE_NAMES = Object.freeze([
  'manifest.json',
  'qualified-alerts.ndjson',
  'alpha-snapshots.ndjson',
  'outcomes.ndjson',
  'pending-observations.json',
] as const);

export type EvidenceSourceFileName =
  (typeof EVIDENCE_SOURCE_FILE_NAMES)[number];

export interface EvidenceSourceFileFingerprint {
  readonly name: EvidenceSourceFileName;
  readonly bytes: number;
  readonly sha256: string | null;
  readonly missing: boolean;
}

export interface EvidenceSourceFingerprint {
  readonly algorithm: 'sha256';
  readonly fingerprintVersion: 'evidence-source-v1';
  readonly fingerprint: string;
  readonly files: readonly EvidenceSourceFileFingerprint[];
}

export const createFileSha256 = async (filePath: string): Promise<string> => {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
};

export const createEvidenceSourceFingerprint = async (
  evaluationDirectory: string,
): Promise<EvidenceSourceFingerprint> => {
  const files: EvidenceSourceFileFingerprint[] = [];
  for (const name of EVIDENCE_SOURCE_FILE_NAMES) {
    const filePath = join(evaluationDirectory, name);
    try {
      const metadata = await stat(filePath);
      if (!metadata.isFile()) {
        throw new Error(`Evidence source is not a file: ${name}`);
      }
      files.push(
        Object.freeze({
          name,
          bytes: metadata.size,
          sha256: await createFileSha256(filePath),
          missing: false,
        }),
      );
    } catch (error: unknown) {
      if (!isErrorWithCode(error, 'ENOENT')) throw error;
      files.push(
        Object.freeze({ name, bytes: 0, sha256: null, missing: true }),
      );
    }
  }
  const frozenFiles = Object.freeze(files);
  const fingerprint = createHash('sha256')
    .update(
      canonicalJsonStringify({
        fingerprintVersion: 'evidence-source-v1',
        files: frozenFiles,
      }),
      'utf8',
    )
    .digest('hex');
  return Object.freeze({
    algorithm: 'sha256',
    fingerprintVersion: 'evidence-source-v1',
    fingerprint,
    files: frozenFiles,
  });
};
