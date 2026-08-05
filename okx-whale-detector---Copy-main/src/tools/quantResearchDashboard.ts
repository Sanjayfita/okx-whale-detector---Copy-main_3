import { readFile } from 'node:fs/promises';

import {
  createResearchAnalyticsServer,
  renderResearchAnalyticsCli,
  type ResearchAnalyticsReport,
} from '../analytics/ResearchAnalytics';

const asObject = (value: unknown, name: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
};

const parseReport = (text: string): ResearchAnalyticsReport => {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error: unknown) {
    throw new Error(
      `Malformed analytics JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const report = asObject(value, 'report');
  const statistics = asObject(report.statistics, 'report.statistics');
  if (!Number.isSafeInteger(report.generatedAt) || Number(report.generatedAt) < 0) {
    throw new Error('report.generatedAt must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(statistics.tradeCount) || Number(statistics.tradeCount) < 0) {
    throw new Error('report.statistics.tradeCount must be non-negative');
  }
  if (report.liveExecutionAllowed !== false) {
    throw new Error('analytics report must explicitly disable live execution');
  }
  return value as ResearchAnalyticsReport;
};

const usage = (): string =>
  [
    'Usage:',
    '  node dist/tools/quantResearchDashboard.js inspect <report.json>',
    '  node dist/tools/quantResearchDashboard.js serve <report.json> [port]',
  ].join('\n');

export const runQuantResearchDashboardCli = async (
  arguments_: readonly string[],
): Promise<number> => {
  const [command, reportPath, rawPort] = arguments_;
  if ((command !== 'inspect' && command !== 'serve') || reportPath === undefined) {
    console.error(usage());
    return 1;
  }
  const report = parseReport(await readFile(reportPath, 'utf8'));
  if (command === 'inspect') {
    console.log(renderResearchAnalyticsCli(report));
    return 0;
  }

  const port = rawPort === undefined ? 8787 : Number(rawPort);
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
    throw new Error('port must be an integer between 1 and 65535');
  }
  const server = createResearchAnalyticsServer({ report });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  console.log(`Research dashboard listening on http://127.0.0.1:${port}`);
  console.log('Research analytics only. Live execution is disabled.');
  return 0;
};

if (require.main === module) {
  runQuantResearchDashboardCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(
        `Research dashboard failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    });
}
