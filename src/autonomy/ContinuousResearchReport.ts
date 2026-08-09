import { fingerprintResearchValue } from '../research/ResearchFingerprint';
import type { AutonomousResearchRankingReport } from './AutonomousResearchRanking';
import type { AutonomousResearchCycleManifest } from './AutonomousResearchLaboratory';
import type { DistributedBacktestAggregationReport } from './DistributedBacktest';
import type { ExperimentSchedulerSnapshot } from './ExperimentScheduler';

export interface ResearchEvidenceInventory {
  readonly realMarketData: boolean;
  readonly immutableDataset: boolean;
  readonly integrityPassed: boolean;
  readonly leakageChecksPassed: boolean;
  readonly collectionDays: number;
  readonly instrumentCount: number;
  readonly observedRegimes: readonly string[];
  readonly requiredRegimes: readonly string[];
  readonly availableDataCapabilities: readonly string[];
  readonly requiredDataCapabilities: readonly string[];
  readonly unresolvedGapCount: number;
}

export interface ContinuousResearchReport {
  readonly reportId: string;
  readonly reportFingerprint: string;
  readonly cycleId: string;
  readonly cycleFingerprint: string;
  readonly generatedAt: number;
  readonly cycleStatus: AutonomousResearchCycleManifest['status'];
  readonly taskCounts: ExperimentSchedulerSnapshot['counts'];
  readonly taskCompletionFraction: number;
  readonly dataCollectionDays: number;
  readonly instrumentCount: number;
  readonly regimeCoverageFraction: number;
  readonly dataCapabilityCoverageFraction: number;
  readonly unresolvedGapCount: number;
  readonly backtestStatus: DistributedBacktestAggregationReport['status'] | 'NOT_AVAILABLE';
  readonly rankedCandidateCount: number;
  readonly replicationPriorityCount: number;
  readonly blockers: readonly string[];
  readonly nextActions: readonly string[];
  readonly researchState:
    | 'ACQUIRING_EVIDENCE'
    | 'RUNNING_EXPERIMENTS'
    | 'REVIEWING_DISCOVERY_RESULTS'
    | 'BLOCKED';
  readonly profitabilityClaimed: false;
  readonly strategyPromotionAllowed: false;
  readonly liveExecutionAllowed: false;
}

const requireNonNegative = (value: number, name: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be finite and non-negative`);
  }
};

const coverageFraction = (
  available: readonly string[],
  required: readonly string[],
): number => {
  const normalizedRequired = [...new Set(required)].sort();
  if (normalizedRequired.length === 0) return 1;
  const availableSet = new Set(available);
  return (
    normalizedRequired.filter((requirement) => availableSet.has(requirement)).length /
    normalizedRequired.length
  );
};

export const buildContinuousResearchReport = (input: {
  readonly cycle: AutonomousResearchCycleManifest;
  readonly scheduler: ExperimentSchedulerSnapshot;
  readonly inventory: ResearchEvidenceInventory;
  readonly generatedAt: number;
  readonly backtest?: DistributedBacktestAggregationReport;
  readonly ranking?: AutonomousResearchRankingReport;
}): ContinuousResearchReport => {
  if (!Number.isSafeInteger(input.generatedAt) || input.generatedAt < 0) {
    throw new Error('generatedAt must be a non-negative safe integer');
  }
  requireNonNegative(input.inventory.collectionDays, 'collectionDays');
  requireNonNegative(input.inventory.instrumentCount, 'instrumentCount');
  requireNonNegative(input.inventory.unresolvedGapCount, 'unresolvedGapCount');
  const blockers = [...input.cycle.blockingReasons];
  if (!input.inventory.realMarketData) blockers.push('REAL_MARKET_DATA_REQUIRED');
  if (!input.inventory.immutableDataset) blockers.push('IMMUTABLE_DATASET_REQUIRED');
  if (!input.inventory.integrityPassed) blockers.push('DATA_INTEGRITY_NOT_PASSED');
  if (!input.inventory.leakageChecksPassed) blockers.push('LEAKAGE_CHECKS_NOT_PASSED');
  if (input.inventory.collectionDays < 180) blockers.push('COLLECTION_DURATION_BELOW_180_DAYS');
  if (input.inventory.instrumentCount < 3) blockers.push('INSTRUMENT_COUNT_BELOW_THREE');
  if (input.inventory.unresolvedGapCount > 0) blockers.push('UNRESOLVED_DATA_GAPS');
  const regimeCoverageFraction = coverageFraction(
    input.inventory.observedRegimes,
    input.inventory.requiredRegimes,
  );
  const dataCapabilityCoverageFraction = coverageFraction(
    input.inventory.availableDataCapabilities,
    input.inventory.requiredDataCapabilities,
  );
  if (regimeCoverageFraction < 1) blockers.push('REQUIRED_REGIME_COVERAGE_INCOMPLETE');
  if (dataCapabilityCoverageFraction < 1) {
    blockers.push('REQUIRED_DATA_CAPABILITIES_INCOMPLETE');
  }
  if (input.scheduler.counts.FAILED > 0) blockers.push('EXPERIMENT_TASK_FAILURES');
  if (input.scheduler.counts.BLOCKED > 0) blockers.push('EXPERIMENT_TASKS_BLOCKED');
  if (input.backtest?.status === 'INCOMPLETE') blockers.push('BACKTEST_RESULTS_INCOMPLETE');
  if (input.backtest?.status === 'REJECTED') blockers.push('BACKTEST_RESULTS_REJECTED');
  const uniqueBlockers = [...new Set(blockers)].sort();
  const totalTasks = input.scheduler.tasks.length;
  const taskCompletionFraction =
    totalTasks === 0 ? 0 : input.scheduler.counts.COMPLETED / totalTasks;
  const nextActions: string[] = [];
  if (!input.inventory.realMarketData || input.inventory.collectionDays < 180) {
    nextActions.push('CONTINUE_REAL_MARKET_COLLECTION');
  }
  if (input.inventory.unresolvedGapCount > 0 || !input.inventory.integrityPassed) {
    nextActions.push('REPAIR_AND_REVERIFY_DATASET');
  }
  if (dataCapabilityCoverageFraction < 1) {
    nextActions.push('ACQUIRE_MISSING_DATA_CAPABILITIES');
  }
  if (regimeCoverageFraction < 1) nextActions.push('CONTINUE_REGIME_COVERAGE');
  if (input.scheduler.counts.PENDING > 0 || input.scheduler.counts.LEASED > 0) {
    nextActions.push('EXECUTE_READY_EXPERIMENT_TASKS');
  }
  if (input.scheduler.counts.FAILED > 0) nextActions.push('TRIAGE_FAILED_TASKS');
  if (input.backtest?.status === 'COMPLETE' && input.ranking === undefined) {
    nextActions.push('RUN_MULTIPLICITY_CORRECTED_VALIDATION');
  }
  if ((input.ranking?.replicationPriorityCount ?? 0) > 0) {
    nextActions.push('REPLICATE_PRIORITY_CANDIDATES_ON_NEW_DISCOVERY_FOLDS');
  }
  if (nextActions.length === 0) nextActions.push('AWAIT_ADDITIONAL_INDEPENDENT_EVIDENCE');
  const researchState: ContinuousResearchReport['researchState'] =
    input.cycle.status === 'BLOCKED' ||
    input.scheduler.counts.FAILED > 0 ||
    input.scheduler.counts.BLOCKED > 0
      ? 'BLOCKED'
      : !input.inventory.realMarketData ||
          input.inventory.collectionDays < 180 ||
          regimeCoverageFraction < 1 ||
          dataCapabilityCoverageFraction < 1
        ? 'ACQUIRING_EVIDENCE'
        : input.scheduler.counts.PENDING > 0 || input.scheduler.counts.LEASED > 0
          ? 'RUNNING_EXPERIMENTS'
          : 'REVIEWING_DISCOVERY_RESULTS';
  const reportFingerprint = fingerprintResearchValue({
    cycleFingerprint: input.cycle.cycleFingerprint,
    generatedAt: input.generatedAt,
    schedulerFingerprint: input.scheduler.schedulerFingerprint,
    inventory: input.inventory,
    backtestStatus: input.backtest?.status ?? 'NOT_AVAILABLE',
    rankingRows: input.ranking?.rows.map((row) => ({
      candidateFingerprint: row.candidateFingerprint,
      rank: row.researchPriorityRank,
      evidenceStatus: row.evidenceStatus,
    })) ?? [],
    blockers: uniqueBlockers,
    nextActions,
  });
  return {
    reportId: `research-report-${reportFingerprint.slice(0, 20)}`,
    reportFingerprint,
    cycleId: input.cycle.cycleId,
    cycleFingerprint: input.cycle.cycleFingerprint,
    generatedAt: input.generatedAt,
    cycleStatus: input.cycle.status,
    taskCounts: input.scheduler.counts,
    taskCompletionFraction,
    dataCollectionDays: input.inventory.collectionDays,
    instrumentCount: input.inventory.instrumentCount,
    regimeCoverageFraction,
    dataCapabilityCoverageFraction,
    unresolvedGapCount: input.inventory.unresolvedGapCount,
    backtestStatus: input.backtest?.status ?? 'NOT_AVAILABLE',
    rankedCandidateCount: input.ranking?.rankedCount ?? 0,
    replicationPriorityCount: input.ranking?.replicationPriorityCount ?? 0,
    blockers: uniqueBlockers,
    nextActions,
    researchState,
    profitabilityClaimed: false,
    strategyPromotionAllowed: false,
    liveExecutionAllowed: false,
  };
};

export const renderContinuousResearchReportMarkdown = (
  report: ContinuousResearchReport,
): string => [
  `# Autonomous research cycle ${report.cycleId}`,
  '',
  `- State: **${report.researchState}**`,
  `- Cycle status: **${report.cycleStatus}**`,
  `- Task completion: ${(report.taskCompletionFraction * 100).toFixed(2)}%`,
  `- Data collection: ${report.dataCollectionDays.toFixed(2)} days across ${report.instrumentCount} instruments`,
  `- Regime coverage: ${(report.regimeCoverageFraction * 100).toFixed(2)}%`,
  `- Data capability coverage: ${(report.dataCapabilityCoverageFraction * 100).toFixed(2)}%`,
  `- Backtest aggregation: **${report.backtestStatus}**`,
  `- Ranked discovery candidates: ${report.rankedCandidateCount}`,
  `- Replication priorities: ${report.replicationPriorityCount}`,
  '',
  '## Blockers',
  '',
  ...(report.blockers.length === 0
    ? ['- None recorded.']
    : report.blockers.map((blocker) => `- ${blocker}`)),
  '',
  '## Next actions',
  '',
  ...report.nextActions.map((action) => `- ${action}`),
  '',
  '> Discovery evidence only. No profitability claim, strategy promotion, or live execution is authorized.',
  '',
].join('\n');
