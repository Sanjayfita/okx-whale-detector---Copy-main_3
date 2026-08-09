import {
  assessLiveTradingReadiness,
  type LiveTradingReadinessChecklist,
  type LiveTradingReadinessStatus,
} from '../safety/liveTradingReadiness';
import {
  createLiveTradingReadinessDocument,
  readLiveTradingReadinessDocumentFromText,
  serializeLiveTradingReadinessDocument,
} from '../safety/liveTradingReadinessPersistence';

export interface LiveTradingReadinessSimulationResult {
  name: string;
  status: LiveTradingReadinessStatus;
  completedChecks: number;
  totalChecks: number;
  missingChecks: readonly string[];
  orderExecutionAuthorized: false;
}

const completeChecklist = (): LiveTradingReadinessChecklist => ({
  credentialsIsolated: true,
  tradePermissionDisabledByDefault: true,
  maximumOrderNotionalConfigured: true,
  maximumDailyLossConfigured: true,
  emergencyStopImplemented: true,
  duplicateOrderProtectionImplemented: true,
  exchangeReconciliationImplemented: true,
  auditLoggingImplemented: true,
  manualApprovalRequired: true,
  testnetValidationCompleted: true,
  independentSecurityReviewCompleted: true,
});

const scenarios: readonly {
  name: string;
  checklist: LiveTradingReadinessChecklist;
}[] = Object.freeze([
  {
    name: 'critical-controls-missing',
    checklist: {
      ...completeChecklist(),
      emergencyStopImplemented: false,
      duplicateOrderProtectionImplemented: false,
    },
  },
  {
    name: 'manual-review-incomplete',
    checklist: {
      ...completeChecklist(),
      testnetValidationCompleted: false,
      independentSecurityReviewCompleted: false,
    },
  },
  {
    name: 'all-checks-complete',
    checklist: completeChecklist(),
  },
]);

export const simulateLiveTradingReadiness = (): readonly LiveTradingReadinessSimulationResult[] =>
  Object.freeze(
    scenarios.map((scenario, index) => {
      const assessment = assessLiveTradingReadiness(scenario.checklist);
      const document = createLiveTradingReadinessDocument({
        generatedAt: 1_800_000_000_000 + index,
        checklist: scenario.checklist,
      });
      const restored = readLiveTradingReadinessDocumentFromText(
        serializeLiveTradingReadinessDocument(document),
      );

      if (restored.assessment.status !== assessment.status) {
        throw new Error(`Readiness persistence changed status for ${scenario.name}`);
      }
      if (restored.assessment.orderExecutionAuthorized !== false) {
        throw new Error(`Readiness simulation unexpectedly authorized execution for ${scenario.name}`);
      }

      return Object.freeze({
        name: scenario.name,
        status: assessment.status,
        completedChecks: assessment.completedChecks,
        totalChecks: assessment.totalChecks,
        missingChecks: Object.freeze([...assessment.missingChecks]),
        orderExecutionAuthorized: false as const,
      });
    }),
  );

export const runSimulateLiveTradingReadinessCli = (
  log: (message: string) => void = console.log,
): number => {
  const results = simulateLiveTradingReadiness();
  log('LIVE TRADING READINESS SIMULATION');

  for (const result of results) {
    log(
      `${result.name} | status=${result.status} | checks=${result.completedChecks}/${result.totalChecks} | missing=${
        result.missingChecks.length === 0 ? 'none' : result.missingChecks.join(',')
      } | orderExecutionAuthorized=${result.orderExecutionAuthorized}`,
    );
  }

  log('Simulation complete. Real-order execution remains disabled.');
  return 0;
};

if (require.main === module) {
  process.exitCode = runSimulateLiveTradingReadinessCli();
}
