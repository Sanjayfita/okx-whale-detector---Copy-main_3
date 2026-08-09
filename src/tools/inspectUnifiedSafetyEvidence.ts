import { readUnifiedSafetyEvidenceDocument } from '../safety/unifiedSafetyEvidencePersistence';

export interface InspectUnifiedSafetyEvidenceCliDependencies {
  readDocument?: typeof readUnifiedSafetyEvidenceDocument;
  log?: (message: string) => void;
  error?: (message: string) => void;
}

const readArgument = (args: readonly string[], name: string): string | null => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1]! : null;
};

export const runInspectUnifiedSafetyEvidenceCli = async (
  args: readonly string[],
  dependencies: InspectUnifiedSafetyEvidenceCliDependencies = {},
): Promise<number> => {
  const filePath = readArgument(args, '--file');
  const log = dependencies.log ?? console.log;
  const error = dependencies.error ?? console.error;

  if (filePath === null || filePath.trim() === '') {
    error('Usage: safety:inspect-evidence -- --file <evidence.json>');
    return 2;
  }

  try {
    const readDocument = dependencies.readDocument ?? readUnifiedSafetyEvidenceDocument;
    const document = await readDocument(filePath);
    const bundle = document.bundle;

    log('UNIFIED SAFETY EVIDENCE');
    log(`File: ${filePath}`);
    log(`Schema version: ${document.schemaVersion}`);
    log(`Generator version: ${document.generatorVersion}`);
    log(`Document generated at: ${document.generatedAt}`);
    log(`Bundle generated at: ${bundle.generatedAt}`);
    log(`Status: ${bundle.status}`);
    log(`Passed sources: ${bundle.passedSources.join(', ') || 'none'}`);
    log(`Review sources: ${bundle.reviewSources.join(', ') || 'none'}`);
    log(`Failed sources: ${bundle.failedSources.join(', ') || 'none'}`);
    log(`Missing sources: ${bundle.missingSources.join(', ') || 'none'}`);
    log(`Order execution authorized: ${bundle.orderExecutionAuthorized}`);

    for (const item of bundle.evidence) {
      log(
        `EVIDENCE | ${item.source} | ${item.state} | generatedAt=${item.generatedAt} | ${item.summary}`,
      );
      for (const reason of item.reasons) {
        log(`EVIDENCE REASON | ${item.source} | ${reason}`);
      }
    }

    for (const reason of bundle.reasons) {
      log(`REASON | ${reason}`);
    }

    return bundle.status === 'BLOCKED' ? 1 : 0;
  } catch (cause) {
    error(
      `Unified safety evidence inspection failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    return 2;
  }
};

if (require.main === module) {
  void runInspectUnifiedSafetyEvidenceCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
