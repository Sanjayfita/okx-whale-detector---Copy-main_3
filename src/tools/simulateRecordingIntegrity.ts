import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  inspectRecordingIntegrity,
  inspectRecordingIntegrityFromText,
} from '../recording/recordingIntegrity';
import {
  createRecordingIntegrityDocument,
  readRecordingIntegrityDocument,
  serializeRecordingIntegrityDocument,
  writeRecordingIntegrityDocument,
} from '../recording/recordingIntegrityPersistence';

export interface RecordingIntegritySimulationResult {
  recordingValid: boolean;
  persistedDocumentValid: boolean;
  checksumStable: boolean;
  serializationStable: boolean;
  malformedRecordingRejected: boolean;
  nonMonotonicRecordingRejected: boolean;
}

export const runRecordingIntegritySimulation = async (): Promise<RecordingIntegritySimulationResult> => {
  const directory = await mkdtemp(join(tmpdir(), 'okx-recording-integrity-'));
  const recordingPath = join(directory, 'btc-usdt.jsonl');
  const documentPath = join(directory, 'btc-usdt.integrity.json');

  try {
    const recordingText = [
      JSON.stringify({ timestamp: 1_000, type: 'snapshot', instrumentId: 'BTC-USDT' }),
      JSON.stringify({ timestamp: 2_000, type: 'update', instrumentId: 'BTC-USDT' }),
      JSON.stringify({ timestamp: 3_000, type: 'update', instrumentId: 'BTC-USDT' }),
      '',
    ].join('\n');

    await writeFile(recordingPath, recordingText, 'utf8');
    const report = await inspectRecordingIntegrity(recordingPath);
    if (!report.valid) throw new Error('Expected deterministic recording to be valid');

    const document = createRecordingIntegrityDocument({
      generatedAt: 4_000,
      report,
    });
    await writeRecordingIntegrityDocument(documentPath, document);

    const persistedText = await readFile(documentPath, 'utf8');
    const reloaded = await readRecordingIntegrityDocument(documentPath);
    const serializationStable =
      persistedText === serializeRecordingIntegrityDocument(reloaded);
    if (!serializationStable) throw new Error('Integrity document serialization changed after reload');

    const repeatedReport = await inspectRecordingIntegrity(recordingPath);
    const checksumStable = report.sha256 === repeatedReport.sha256;
    if (!checksumStable) throw new Error('Recording checksum changed across identical inspections');

    const malformed = inspectRecordingIntegrityFromText({
      filePath: 'malformed.jsonl',
      text: '{"timestamp":1000}\nnot-json\n',
    });
    const nonMonotonic = inspectRecordingIntegrityFromText({
      filePath: 'non-monotonic.jsonl',
      text: '{"timestamp":2000}\n{"timestamp":1000}\n',
    });

    const result = Object.freeze({
      recordingValid: report.valid,
      persistedDocumentValid: reloaded.report.valid,
      checksumStable,
      serializationStable,
      malformedRecordingRejected: !malformed.valid && malformed.malformedJsonLineCount === 1,
      nonMonotonicRecordingRejected:
        !nonMonotonic.valid && nonMonotonic.nonMonotonicTimestampCount === 1,
    });

    if (!Object.values(result).every(Boolean)) {
      throw new Error('Recording integrity simulation did not satisfy every assertion');
    }

    return result;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

const main = async (): Promise<void> => {
  const result = await runRecordingIntegritySimulation();
  console.log('Recording integrity simulation passed');
  console.log(`Recording valid: ${result.recordingValid}`);
  console.log(`Persisted document valid: ${result.persistedDocumentValid}`);
  console.log(`Checksum stable: ${result.checksumStable}`);
  console.log(`Serialization stable: ${result.serializationStable}`);
  console.log(`Malformed recording rejected: ${result.malformedRecordingRejected}`);
  console.log(`Non-monotonic recording rejected: ${result.nonMonotonicRecordingRejected}`);
  console.log('No orders were placed.');
};

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
