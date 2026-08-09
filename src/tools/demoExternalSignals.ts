import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  SYNTHETIC_EXTERNAL_SCENARIOS,
  getSyntheticExternalScenario,
} from '../external/demo/SyntheticExternalScenarios';
import { runSyntheticExternalScenario } from '../external/demo/runSyntheticExternalScenario';

interface DemoOptions {
  scenario: string;
  reportPath?: string;
}

const parseOptions = (args: readonly string[]): DemoOptions => {
  let scenario = 'all';
  let reportPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];

    if (argument === '--scenario') {
      if (!value || value.startsWith('--')) {
        throw new Error('--scenario requires a scenario name or all');
      }
      scenario = value;
      index += 1;
      continue;
    }

    if (argument === '--report') {
      if (value && !value.startsWith('--')) {
        reportPath = value;
        index += 1;
      } else {
        reportPath = path.join('data', 'reports', 'external-signal-demo.json');
      }
      continue;
    }

    throw new Error(`Unknown external demo option: ${argument}`);
  }

  return { scenario, reportPath };
};

const formatNumber = (value: number): string => value.toFixed(2);

const main = (): void => {
  const options = parseOptions(process.argv.slice(2));
  const scenarios =
    options.scenario === 'all'
      ? SYNTHETIC_EXTERNAL_SCENARIOS
      : [getSyntheticExternalScenario(options.scenario)].filter(
          (scenario) => scenario !== undefined,
        );

  if (scenarios.length === 0) {
    const available = SYNTHETIC_EXTERNAL_SCENARIOS.map(
      (scenario) => scenario.name,
    ).join(', ');
    throw new Error(
      `Unknown scenario ${options.scenario}. Available scenarios: ${available}`,
    );
  }

  const reports = scenarios.map(runSyntheticExternalScenario);

  console.log('\nEXTERNAL SIGNAL DEMO');
  for (const report of reports) {
    const correlation = report.correlation;
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Scenario: ${report.name}`);
    console.log(`Market: ${report.symbol}`);
    console.log(report.description);
    console.log(
      `Signals: ${report.rawSignals} raw → ${report.deduplicatedSignals} deduplicated (${report.mergedSignals} merged)`,
    );
    console.log(`Providers: ${report.evidenceProviders.join(', ') || 'none'}`);
    console.log(
      `OKX: ${correlation.okxBias} ${formatNumber(correlation.okxConfidence)}%`,
    );
    console.log(
      `External: ${correlation.externalBias} ${formatNumber(correlation.externalConfidence)}%`,
    );
    console.log(
      `Combined: ${correlation.bias} ${formatNumber(correlation.confidence)}%`,
    );
    console.log(`Agreement: ${correlation.agreement}`);
    console.log(
      `Considered: ${correlation.consideredSignals} | Ignored: ${correlation.ignoredSignals}`,
    );
    console.log(`Reason: ${correlation.reason}`);
  }
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (options.reportPath) {
    mkdirSync(path.dirname(options.reportPath), { recursive: true });
    writeFileSync(
      options.reportPath,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          requestedScenario: options.scenario,
          scenarios: reports,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    console.log(`Report: ${options.reportPath}`);
  }
};

try {
  main();
} catch (error: unknown) {
  console.error(
    'External signal demo failed:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
}
