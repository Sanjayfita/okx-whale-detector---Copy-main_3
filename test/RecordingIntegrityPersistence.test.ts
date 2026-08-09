import { describe, expect, it } from 'vitest';

import { inspectRecordingIntegrityFromText } from '../src/recording/recordingIntegrity';
import {
  createRecordingIntegrityDocument,
  readRecordingIntegrityDocumentFromText,
  serializeRecordingIntegrityDocument,
} from '../src/recording/recordingIntegrityPersistence';

describe('recording integrity persistence', () => {
  const report = inspectRecordingIntegrityFromText({
    filePath: 'recordings/btc.jsonl',
    text: '{"timestamp":1000}\n{"timestamp":2000}\n',
  });

  it('serializes deterministically and round-trips through text', () => {
    const document = createRecordingIntegrityDocument({ generatedAt: 3000, report });
    const serialized = serializeRecordingIntegrityDocument(document);

    expect(serialized.endsWith('\n')).toBe(true);
    expect(readRecordingIntegrityDocumentFromText(serialized)).toEqual(document);
    expect(serializeRecordingIntegrityDocument(document)).toBe(serialized);
  });

  it('rejects malformed and unsupported documents', () => {
    expect(() => readRecordingIntegrityDocumentFromText('{')).toThrow(
      'Malformed recording integrity document JSON',
    );

    const document = createRecordingIntegrityDocument({ generatedAt: 3000, report });
    expect(() =>
      readRecordingIntegrityDocumentFromText(
        JSON.stringify({ ...document, schemaVersion: 99 }),
      ),
    ).toThrow('Unsupported recording integrity document schema version');
  });

  it('rejects inconsistent line counts and invalid checksums', () => {
    const document = createRecordingIntegrityDocument({ generatedAt: 3000, report });

    expect(() =>
      readRecordingIntegrityDocumentFromText(
        JSON.stringify({
          ...document,
          report: { ...document.report, nonEmptyLineCount: 3, lineCount: 2 },
        }),
      ),
    ).toThrow('report.nonEmptyLineCount cannot exceed report.lineCount');

    expect(() =>
      readRecordingIntegrityDocumentFromText(
        JSON.stringify({ ...document, report: { ...document.report, sha256: 'bad' } }),
      ),
    ).toThrow('report.sha256 must be a lowercase SHA-256 digest');
  });
});
