import { readResearchSessionManifest } from '../research/researchSessionManifest';
import { inspectResearchSession } from '../research/researchSessionInspection';

interface ConsoleLike {
  log: (...values: unknown[]) => void;
  error: (...values: unknown[]) => void;
}

const valueAfter = (args: readonly string[], option: string): string | undefined => {
  const index = args.indexOf(option);
  return index >= 0 ? args[index + 1] : undefined;
};

export const runResearchSessionInspectorCli = async (
  args: readonly string[],
  output: ConsoleLike = console,
): Promise<number> => {
  const manifestPath = valueAfter(args, '--manifest');
  if (!manifestPath) {
    output.error('Research session inspection failed: --manifest is required');
    return 1;
  }

  try {
    const manifest = await readResearchSessionManifest(manifestPath);
    const inspection = await inspectResearchSession({ manifestPath, manifest });

    output.log('RESEARCH SESSION INSPECTION');
    output.log(`Manifest: ${inspection.manifestPath}`);
    output.log(`Session ID: ${manifest.sessionId}`);
    output.log(`Status: ${manifest.status}`);
    output.log(`Created at: ${manifest.createdAt}`);
    output.log(`Updated at: ${manifest.updatedAt}`);
    output.log(`Instruments: ${manifest.instrumentIds.join(', ')}`);
    output.log(`Artifacts: ${manifest.artifacts.length}`);
    output.log(`Existing artifacts: ${inspection.existingArtifactCount}`);
    output.log(`Missing artifacts: ${inspection.missingArtifactCount}`);

    inspection.artifacts.forEach((entry, index) => {
      output.log(
        `${index + 1}. ${entry.exists ? 'FOUND' : 'MISSING'} | ${entry.artifact.kind} | ${entry.artifact.path}${
          entry.artifact.runId ? ` | ${entry.artifact.runId}` : ''
        }`,
      );
    });

    output.log(`Session complete: ${inspection.complete}`);
    output.log('Research analytics only. This output is not a trading recommendation.');
    return inspection.missingArtifactCount === 0 ? 0 : 2;
  } catch (error) {
    output.error(
      `Research session inspection failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
};

if (require.main === module) {
  void runResearchSessionInspectorCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
