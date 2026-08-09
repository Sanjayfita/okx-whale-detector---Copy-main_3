import { resolve } from 'node:path';

import {
  inspectRecordingIntegrity,
  type RecordingIntegrityReport,
} from '../recording/recordingIntegrity';

const argumentValue = (args: readonly string[], name: string): string | null => {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? null) : null;
};

export const formatRecordingIntegrityReport = (report: RecordingIntegrityReport): string =>
  [
    'RECORDING INTEGRITY REPORT',
    `File: ${report.filePath}`,
    `Valid: ${report.valid}`,
    `UTF-8 bytes: ${report.byteLength}`,
    `Lines: ${report.lineCount}`,
    `Non-empty lines: ${report.nonEmptyLineCount}`,
    `Malformed JSON lines: ${report.malformedJsonLineCount}`,
    `First timestamp: ${report.firstTimestamp ?? 'not found'}`,
    `Last timestamp: ${report.lastTimestamp ?? 'not found'}`,
    `Backward timestamps: ${report.nonMonotonicTimestampCount}`,
    `SHA-256: ${report.sha256}`,
  ].join('\n');

export const runInspectRecordingIntegrityCli = async (
  args: readonly string[],
  dependencies: {
    inspect?: (filePath: string) => Promise<RecordingIntegrityReport>;
    writeOutput?: (message: string) => void;
    writeError?: (message: string) => void;
  } = {},
): Promise<number> => {
  const file = argumentValue(args, '--file');
  if (file === null || file.trim() === '') {
    (dependencies.writeError ?? console.error)(
      'Usage: npm run recording:integrity -- --file <recording.jsonl>',
    );
    return 2;
  }

  const filePath = resolve(file);
  try {
    const report = await (dependencies.inspect ?? inspectRecordingIntegrity)(filePath);
    (dependencies.writeOutput ?? console.log)(formatRecordingIntegrityReport(report));
    return report.valid ? 0 : 1;
  } catch (error) {
    (dependencies.writeError ?? console.error)(
      `Recording integrity inspection failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return 2;
  }
};

if (require.main === module) {
  void runInspectRecordingIntegrityCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
