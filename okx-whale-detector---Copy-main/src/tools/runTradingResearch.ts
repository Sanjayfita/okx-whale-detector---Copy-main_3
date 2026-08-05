import type { Server } from 'node:http';

import type { AppShutdownReason } from '../runtime/AppShutdownCoordinator';
import { runEvidenceCollectCommand } from './collectEvidence';
import { generateEvidenceProfitabilityReport } from './generateEvidenceProfitability';
import { generateStatisticalValidationReport } from './generateStatisticalValidation';
import { createEvidenceDashboardServer } from './serveEvidenceDashboard';
import { runPaperTradingSimulation } from './simulatePaperTrading';

const REPORT_REFRESH_MS = 60_000;

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

const refreshReports = async (evaluationId: string): Promise<void> => {
  await Promise.all([
    generateEvidenceProfitabilityReport({ evaluationId }),
    generateStatisticalValidationReport({ evaluationId }),
  ]);
};

export const runTradingResearchWorkspace = async (
  evaluationId: string,
): Promise<{
  readonly stop: (reason?: AppShutdownReason) => Promise<void>;
  readonly liveOrderExecutionAllowed: false;
}> => {
  process.env.OKX_SKIP_AUTO_START = '1';
  const port = Number(process.env.EVIDENCE_DASHBOARD_PORT ?? 4173);
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
    throw new Error('EVIDENCE_DASHBOARD_PORT must be a valid port');
  }

  console.log('RUNNING OFFLINE PAPER-ACCOUNTING SELF-CHECK');
  runPaperTradingSimulation();
  await refreshReports(evaluationId);

  const dashboardServer = createEvidenceDashboardServer(evaluationId);
  await new Promise<void>((resolve, reject) => {
    dashboardServer.once('error', reject);
    dashboardServer.listen(port, '127.0.0.1', () => {
      dashboardServer.off('error', reject);
      resolve();
    });
  });

  let collector:
    | Awaited<ReturnType<typeof runEvidenceCollectCommand>>
    | undefined;
  try {
    const { createAppRuntime } = await import('../index.js');
    collector = await runEvidenceCollectCommand(evaluationId, {
      createAppRuntime,
      registerSignal: () => undefined,
    });
  } catch (error: unknown) {
    await closeServer(dashboardServer);
    throw error;
  }

  const refreshTimer = setInterval(() => {
    void refreshReports(evaluationId).catch((error: unknown) => {
      console.error('Scheduled research-report refresh failed:', error);
    });
  }, REPORT_REFRESH_MS);
  refreshTimer.unref();

  let stopPromise: Promise<void> | undefined;
  const stop = (
    reason: AppShutdownReason = 'APPLICATION_CLOSE',
  ): Promise<void> => {
    stopPromise ??= (async () => {
      clearInterval(refreshTimer);
      let failure: unknown;

      try {
        await collector?.stop(reason);
      } catch (error: unknown) {
        failure = error;
      }

      try {
        await closeServer(dashboardServer);
      } catch (error: unknown) {
        failure ??= error;
      }

      try {
        await refreshReports(evaluationId);
      } catch (error: unknown) {
        failure ??= error;
      }

      if (failure) {
        throw failure;
      }
    })();

    return stopPromise;
  };

  const handleSignal = (signal: NodeJS.Signals): void => {
    void stop(signal).catch((error: unknown) => {
      console.error('Trading research workspace shutdown failed:', error);
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', () => handleSignal('SIGINT'));
  process.once('SIGTERM', () => handleSignal('SIGTERM'));

  console.log('');
  console.log('TRADING RESEARCH WORKSPACE STARTED');
  console.log(`Evaluation ID: ${evaluationId}`);
  console.log(`Dashboard: http://127.0.0.1:${port}`);
  console.log('Components: live public evidence, profitability, statistics, dashboard, and paper-accounting self-check.');
  console.log('READ ONLY. LIVE ORDER EXECUTION IS DISABLED.');
  console.log('Press Ctrl+C for a clean shutdown.');

  return Object.freeze({
    stop,
    liveOrderExecutionAllowed: false,
  });
};

const main = async (): Promise<void> => {
  const evaluationId = process.argv[2] ?? 'eval-2026-08-02-v1';
  await runTradingResearchWorkspace(evaluationId);
};

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(
      `Trading research workspace failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  });
}
