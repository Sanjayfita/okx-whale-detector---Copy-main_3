import { readRuntimeHealthDocument } from '../observability/runtimeHealthPersistence';

export interface InspectRuntimeHealthCliDependencies {
  readDocument?: typeof readRuntimeHealthDocument;
  log?: (message: string) => void;
  error?: (message: string) => void;
}

const readArgument = (args: readonly string[], name: string): string | null => {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1]! : null;
};

export const runInspectRuntimeHealthCli = async (
  args: readonly string[],
  dependencies: InspectRuntimeHealthCliDependencies = {},
): Promise<number> => {
  const filePath = readArgument(args, '--file');
  const log = dependencies.log ?? console.log;
  const error = dependencies.error ?? console.error;

  if (filePath === null || filePath.trim() === '') {
    error('Usage: runtime:health:inspect -- --file <runtime-health.json>');
    return 2;
  }

  try {
    const document = await (dependencies.readDocument ?? readRuntimeHealthDocument)(filePath);
    const { snapshot } = document;

    log('RUNTIME HEALTH SNAPSHOT');
    log(`File: ${filePath}`);
    log(`Schema version: ${document.schemaVersion}`);
    log(`Generator version: ${document.generatorVersion}`);
    log(`Generated at: ${snapshot.generatedAt}`);
    log(`Started at: ${snapshot.startedAt}`);
    log(`Uptime (ms): ${snapshot.uptimeMs}`);
    log(`Status: ${snapshot.status}`);
    log(`Healthy components: ${snapshot.healthyCount}`);
    log(`Degraded components: ${snapshot.degradedCount}`);
    log(`Unhealthy components: ${snapshot.unhealthyCount}`);
    log(`Components: ${snapshot.components.length}`);

    for (const component of snapshot.components) {
      const metricText = Object.entries(component.metrics)
        .map(([name, value]) => `${name}=${value}`)
        .join(', ');
      const details = [component.message, metricText].filter((value) => value !== null && value !== '').join(' | ');
      log(
        `${component.status} | ${component.name} | observedAt=${component.observedAt}${
          details === '' ? '' : ` | ${details}`
        }`,
      );
    }

    return snapshot.status === 'UNHEALTHY' ? 1 : 0;
  } catch (cause) {
    error(`Runtime health inspection failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    return 2;
  }
};

if (require.main === module) {
  void runInspectRuntimeHealthCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
