import { readResearchDashboardDocument } from '../dashboard/researchDashboardPersistence';

export interface InspectResearchDashboardCliDependencies {
  readDocument?: typeof readResearchDashboardDocument;
  log?: (message: string) => void;
  error?: (message: string) => void;
}

const readArgument = (args: readonly string[], name: string): string | null => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1]! : null;
};

const formatList = (values: readonly string[]): string =>
  values.length === 0 ? 'none' : values.join(', ');

export const runInspectResearchDashboardCli = async (
  args: readonly string[],
  dependencies: InspectResearchDashboardCliDependencies = {},
): Promise<number> => {
  const filePath = readArgument(args, '--file');
  const log = dependencies.log ?? console.log;
  const error = dependencies.error ?? console.error;

  if (filePath === null || filePath.trim() === '') {
    error('Usage: dashboard:inspect -- --file <research-dashboard.json>');
    return 2;
  }

  try {
    const document = await (dependencies.readDocument ?? readResearchDashboardDocument)(filePath);
    const { snapshot } = document;

    log('RESEARCH DASHBOARD');
    log(`File: ${filePath}`);
    log(`Schema version: ${document.schemaVersion}`);
    log(`Generator version: ${document.generatorVersion}`);
    log(`Generated at: ${snapshot.generatedAt}`);
    log(`Status: ${snapshot.status}`);
    log(`Runtime status: ${snapshot.runtimeStatus}`);
    log(`Recordings: ${snapshot.counts.validRecordings}/${snapshot.counts.recordings} valid`);
    log(
      `Research sessions: ${snapshot.counts.completedResearchSessions}/${snapshot.counts.researchSessions} complete`,
    );
    log(
      `Strategy candidates: ${snapshot.counts.evaluatedStrategyCandidates}/${snapshot.counts.strategyCandidates} evaluated`,
    );
    log(`Invalid recordings: ${formatList(snapshot.invalidRecordingPaths)}`);
    log(`Incomplete sessions: ${formatList(snapshot.incompleteResearchSessionIds)}`);
    log(
      `Unevaluated candidates: ${formatList(snapshot.unevaluatedStrategyCandidateIds)}`,
    );
    log(`Reasons: ${formatList(snapshot.reasons)}`);
    log('Research analytics only. This output is not a trading recommendation.');

    return snapshot.status === 'BLOCKED' ? 1 : 0;
  } catch (cause) {
    error(
      `Research dashboard inspection failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    return 2;
  }
};

if (require.main === module) {
  void runInspectResearchDashboardCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
