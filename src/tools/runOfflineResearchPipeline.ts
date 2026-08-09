import { spawn } from 'node:child_process';

import {
  readOfflineResearchPipelinePlan,
  runOfflineResearchPipeline,
} from '../research/offlineResearchPipeline';

interface ConsoleLike {
  log: (...values: unknown[]) => void;
  error: (...values: unknown[]) => void;
}

const optionValue = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

const runCommand = (command: string, args: readonly string[]): Promise<number> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: 'inherit', shell: process.platform === 'win32' });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });

export const runOfflineResearchPipelineCli = async (
  args: readonly string[],
  output: Partial<ConsoleLike> = console,
): Promise<number> => {
  const log = output.log ?? console.log;
  const error = output.error ?? console.error;

  try {
    const planPath = optionValue(args, '--plan');
    if (!planPath) throw new Error('--plan is required');

    const plan = await readOfflineResearchPipelinePlan(planPath);
    const result = await runOfflineResearchPipeline({
      plan,
      runCommand: ({ command, args: commandArgs }) => runCommand(command, commandArgs),
    });

    log('OFFLINE RESEARCH PIPELINE');
    log(`Session: ${result.manifest.sessionId}`);
    log(`Status: ${result.manifest.status}`);
    log(`Instruments: ${result.manifest.instrumentIds.join(', ')}`);
    log(`Steps completed: ${result.stepResults.length}`);
    log(`Artifacts: ${result.manifest.artifacts.length}`);
    log(`Manifest: ${plan.manifestPath}`);
    log('Research analytics only. This output is not a trading recommendation.');
    return 0;
  } catch (caught) {
    error(
      `Offline research pipeline failed: ${
        caught instanceof Error ? caught.message : String(caught)
      }`,
    );
    return 1;
  }
};

if (require.main === module) {
  void runOfflineResearchPipelineCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
