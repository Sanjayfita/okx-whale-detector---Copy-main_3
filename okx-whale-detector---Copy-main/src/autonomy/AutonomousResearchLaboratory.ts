import type { StrategyCandidateGenerationReport } from '../research/StrategyCandidateGenerator';
import { fingerprintResearchValue } from '../research/ResearchFingerprint';
import type { AdaptiveFeatureDiscoveryReport } from './AdaptiveFeatureDiscovery';
import type { DistributedBacktestPlan } from './DistributedBacktest';
import type { ExperimentTaskSpec } from './ExperimentScheduler';
import type { AutonomousHypothesisGenerationReport } from './ResearchHypothesis';

export interface AutonomousResearchCyclePolicy {
  readonly maximumTasks: number;
  readonly defaultMaximumAttempts: number;
  readonly defaultLeaseDurationMs: number;
  readonly lightweightResourceUnits: number;
  readonly backtestResourceUnits: number;
}

export const DEFAULT_AUTONOMOUS_RESEARCH_CYCLE_POLICY: AutonomousResearchCyclePolicy = {
  maximumTasks: 250_000,
  defaultMaximumAttempts: 3,
  defaultLeaseDurationMs: 15 * 60_000,
  lightweightResourceUnits: 1,
  backtestResourceUnits: 4,
};

export interface AutonomousResearchCycleManifest {
  readonly cycleId: string;
  readonly cycleFingerprint: string;
  readonly datasetFingerprint: string;
  readonly codeCommit: string;
  readonly configurationHash: string;
  readonly hypothesisFamilyFingerprint: string;
  readonly featureFamilyFingerprint: string;
  readonly backtestPlanFingerprint: string;
  readonly candidateFamilyFingerprints: readonly string[];
  readonly hypothesisCount: number;
  readonly readyHypothesisCount: number;
  readonly featureCandidateCount: number;
  readonly readyFeatureCount: number;
  readonly strategyCandidateCount: number;
  readonly effectiveHypothesisCount: number;
  readonly backtestWorkUnitCount: number;
  readonly taskSpecs: readonly ExperimentTaskSpec[];
  readonly status: 'READY_TO_SCHEDULE' | 'BLOCKED';
  readonly blockingReasons: readonly string[];
  readonly createdAt: number;
  readonly discoveryOnly: true;
  readonly holdoutAccessed: false;
  readonly strategyPromotionAllowed: false;
  readonly liveExecutionAllowed: false;
}

const requireText = (value: string, name: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${name} must not be empty`);
  return normalized;
};

const requirePositiveInteger = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
};

const taskSpec = (input: {
  readonly taskId: string;
  readonly cycleId: string;
  readonly taskType: ExperimentTaskSpec['taskType'];
  readonly dependencies: readonly string[];
  readonly priority: number;
  readonly createdAt: number;
  readonly resourceUnits: number;
  readonly payload: unknown;
  readonly policy: AutonomousResearchCyclePolicy;
}): ExperimentTaskSpec => ({
  taskId: input.taskId,
  cycleId: input.cycleId,
  taskType: input.taskType,
  dependencyTaskIds: [...new Set(input.dependencies)].sort(),
  priority: input.priority,
  createdAt: input.createdAt,
  maximumAttempts: input.policy.defaultMaximumAttempts,
  leaseDurationMs: input.policy.defaultLeaseDurationMs,
  resourceUnits: input.resourceUnits,
  payloadFingerprint: fingerprintResearchValue(input.payload),
});

export const buildAutonomousResearchCycle = (input: {
  readonly cycleId: string;
  readonly datasetFingerprint: string;
  readonly codeCommit: string;
  readonly configurationHash: string;
  readonly createdAt: number;
  readonly hypothesisReport: AutonomousHypothesisGenerationReport;
  readonly featureReport: AdaptiveFeatureDiscoveryReport;
  readonly candidateReports: readonly StrategyCandidateGenerationReport[];
  readonly backtestPlan: DistributedBacktestPlan;
  readonly policy?: Partial<AutonomousResearchCyclePolicy>;
}): AutonomousResearchCycleManifest => {
  const policy: AutonomousResearchCyclePolicy = {
    ...DEFAULT_AUTONOMOUS_RESEARCH_CYCLE_POLICY,
    ...input.policy,
  };
  requirePositiveInteger(policy.maximumTasks, 'maximumTasks');
  requirePositiveInteger(
    policy.defaultMaximumAttempts,
    'defaultMaximumAttempts',
  );
  requirePositiveInteger(
    policy.defaultLeaseDurationMs,
    'defaultLeaseDurationMs',
  );
  requirePositiveInteger(policy.lightweightResourceUnits, 'lightweightResourceUnits');
  requirePositiveInteger(policy.backtestResourceUnits, 'backtestResourceUnits');
  const cycleId = requireText(input.cycleId, 'cycleId');
  const datasetFingerprint = requireText(input.datasetFingerprint, 'datasetFingerprint');
  const codeCommit = requireText(input.codeCommit, 'codeCommit');
  const configurationHash = requireText(input.configurationHash, 'configurationHash');
  if (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
    throw new Error('createdAt must be a non-negative safe integer');
  }
  const blockingReasons: string[] = [];
  if (input.hypothesisReport.datasetFingerprint !== datasetFingerprint) {
    blockingReasons.push('HYPOTHESIS_DATASET_FINGERPRINT_MISMATCH');
  }
  if (input.featureReport.datasetFingerprint !== datasetFingerprint) {
    blockingReasons.push('FEATURE_DATASET_FINGERPRINT_MISMATCH');
  }
  if (input.backtestPlan.datasetFingerprint !== datasetFingerprint) {
    blockingReasons.push('BACKTEST_DATASET_FINGERPRINT_MISMATCH');
  }
  if (input.hypothesisReport.status !== 'GENERATED') {
    blockingReasons.push('HYPOTHESIS_GENERATION_REJECTED');
  }
  if (input.featureReport.status !== 'GENERATED') {
    blockingReasons.push('FEATURE_DISCOVERY_REJECTED');
  }
  if (input.backtestPlan.status !== 'PLANNED') {
    blockingReasons.push('BACKTEST_PLAN_REJECTED');
  }
  if (input.hypothesisReport.readyCount === 0) {
    blockingReasons.push('NO_READY_HYPOTHESES');
  }
  if (input.featureReport.readyCount === 0) {
    blockingReasons.push('NO_READY_FEATURE_CANDIDATES');
  }
  if (input.candidateReports.length === 0) {
    blockingReasons.push('NO_STRATEGY_CANDIDATE_FAMILIES');
  }
  if (input.candidateReports.some((report) => report.status !== 'GENERATED')) {
    blockingReasons.push('CANDIDATE_FAMILY_REJECTED');
  }

  const hypothesisTaskId = `${cycleId}:hypotheses`;
  const featureTaskId = `${cycleId}:features`;
  const tasks: ExperimentTaskSpec[] = [
    taskSpec({
      taskId: hypothesisTaskId,
      cycleId,
      taskType: 'HYPOTHESIS_GENERATION',
      dependencies: [],
      priority: 100,
      createdAt: input.createdAt,
      resourceUnits: policy.lightweightResourceUnits,
      payload: {
        familyFingerprint: input.hypothesisReport.familyFingerprint,
        generatedCount: input.hypothesisReport.generatedCount,
      },
      policy,
    }),
    taskSpec({
      taskId: featureTaskId,
      cycleId,
      taskType: 'FEATURE_DISCOVERY',
      dependencies: [hypothesisTaskId],
      priority: 90,
      createdAt: input.createdAt,
      resourceUnits: policy.lightweightResourceUnits,
      payload: {
        familyFingerprint: input.featureReport.familyFingerprint,
        generatedCount: input.featureReport.generatedCount,
      },
      policy,
    }),
  ];

  const candidateTaskByCandidateId = new Map<string, string>();
  for (const report of input.candidateReports
    .slice()
    .sort((left, right) => left.familyFingerprint.localeCompare(right.familyFingerprint))) {
    const candidateTaskId = `${cycleId}:candidates:${report.familyFingerprint.slice(0, 16)}`;
    tasks.push(
      taskSpec({
        taskId: candidateTaskId,
        cycleId,
        taskType: 'CANDIDATE_GENERATION',
        dependencies: [hypothesisTaskId, featureTaskId],
        priority: 80,
        createdAt: input.createdAt,
        resourceUnits: policy.lightweightResourceUnits,
        payload: {
          familyFingerprint: report.familyFingerprint,
          hypothesisFamilyId: report.hypothesisFamilyId,
          effectiveHypothesisCount: report.effectiveHypothesisCount,
        },
        policy,
      }),
    );
    for (const candidate of report.candidates) {
      if (candidateTaskByCandidateId.has(candidate.candidateId)) {
        blockingReasons.push(`DUPLICATE_CANDIDATE_ID:${candidate.candidateId}`);
      }
      candidateTaskByCandidateId.set(candidate.candidateId, candidateTaskId);
    }
  }

  const backtestTaskIds: string[] = [];
  for (const workUnit of input.backtestPlan.workUnits) {
    const candidateTaskId = candidateTaskByCandidateId.get(workUnit.candidateId);
    if (candidateTaskId === undefined) {
      blockingReasons.push(`BACKTEST_CANDIDATE_NOT_REGISTERED:${workUnit.candidateId}`);
      continue;
    }
    const taskId = `${cycleId}:work:${workUnit.workUnitId}`;
    backtestTaskIds.push(taskId);
    tasks.push(
      taskSpec({
        taskId,
        cycleId,
        taskType: 'BACKTEST_SHARD',
        dependencies: [candidateTaskId],
        priority: 50,
        createdAt: input.createdAt,
        resourceUnits: policy.backtestResourceUnits,
        payload: workUnit,
        policy,
      }),
    );
  }

  const aggregationTaskId = `${cycleId}:aggregate`;
  const validationTaskId = `${cycleId}:validate`;
  const reportTaskId = `${cycleId}:report`;
  tasks.push(
    taskSpec({
      taskId: aggregationTaskId,
      cycleId,
      taskType: 'RESULT_AGGREGATION',
      dependencies: backtestTaskIds,
      priority: 40,
      createdAt: input.createdAt,
      resourceUnits: policy.lightweightResourceUnits,
      payload: { backtestPlanFingerprint: input.backtestPlan.planFingerprint },
      policy,
    }),
    taskSpec({
      taskId: validationTaskId,
      cycleId,
      taskType: 'STATISTICAL_VALIDATION',
      dependencies: [aggregationTaskId],
      priority: 30,
      createdAt: input.createdAt,
      resourceUnits: policy.lightweightResourceUnits,
      payload: {
        effectiveHypothesisCount: input.candidateReports.reduce(
          (sum, report) => sum + report.effectiveHypothesisCount,
          0,
        ),
      },
      policy,
    }),
    taskSpec({
      taskId: reportTaskId,
      cycleId,
      taskType: 'CONTINUOUS_REPORT',
      dependencies: [validationTaskId],
      priority: 20,
      createdAt: input.createdAt,
      resourceUnits: policy.lightweightResourceUnits,
      payload: { cycleId },
      policy,
    }),
  );
  if (tasks.length > policy.maximumTasks) {
    blockingReasons.push('CYCLE_TASK_LIMIT_EXCEEDED');
  }
  const taskIds = tasks.map((task) => task.taskId);
  if (new Set(taskIds).size !== taskIds.length) {
    blockingReasons.push('DUPLICATE_CYCLE_TASK_ID');
  }
  const effectiveHypothesisCount = input.candidateReports.reduce(
    (sum, report) => sum + report.effectiveHypothesisCount,
    0,
  );
  const candidateFamilyFingerprints = input.candidateReports
    .map((report) => report.familyFingerprint)
    .sort();
  const cycleFingerprint = fingerprintResearchValue({
    cycleId,
    datasetFingerprint,
    codeCommit,
    configurationHash,
    hypothesisFamilyFingerprint: input.hypothesisReport.familyFingerprint,
    featureFamilyFingerprint: input.featureReport.familyFingerprint,
    candidateFamilyFingerprints,
    backtestPlanFingerprint: input.backtestPlan.planFingerprint,
    taskPayloadFingerprints: tasks.map((task) => task.payloadFingerprint).sort(),
  });
  return {
    cycleId,
    cycleFingerprint,
    datasetFingerprint,
    codeCommit,
    configurationHash,
    hypothesisFamilyFingerprint: input.hypothesisReport.familyFingerprint,
    featureFamilyFingerprint: input.featureReport.familyFingerprint,
    backtestPlanFingerprint: input.backtestPlan.planFingerprint,
    candidateFamilyFingerprints,
    hypothesisCount: input.hypothesisReport.generatedCount,
    readyHypothesisCount: input.hypothesisReport.readyCount,
    featureCandidateCount: input.featureReport.generatedCount,
    readyFeatureCount: input.featureReport.readyCount,
    strategyCandidateCount: input.candidateReports.reduce(
      (sum, report) => sum + report.candidates.length,
      0,
    ),
    effectiveHypothesisCount,
    backtestWorkUnitCount: input.backtestPlan.workUnitCount,
    taskSpecs: blockingReasons.length === 0 ? tasks : [],
    status: blockingReasons.length === 0 ? 'READY_TO_SCHEDULE' : 'BLOCKED',
    blockingReasons: [...new Set(blockingReasons)].sort(),
    createdAt: input.createdAt,
    discoveryOnly: true,
    holdoutAccessed: false,
    strategyPromotionAllowed: false,
    liveExecutionAllowed: false,
  };
};
