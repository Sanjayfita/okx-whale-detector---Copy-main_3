import type { AdaptiveFeatureDiscoveryReport } from '../autonomy/AdaptiveFeatureDiscovery';
import type { AutonomousResearchRankingReport } from '../autonomy/AutonomousResearchRanking';
import type { AutonomousResearchCycleManifest } from '../autonomy/AutonomousResearchLaboratory';
import type { ContinuousResearchReport } from '../autonomy/ContinuousResearchReport';
import type {
  BacktestWorkUnitResult,
  DistributedBacktestPlan,
} from '../autonomy/DistributedBacktest';
import type { ExperimentTaskSnapshot } from '../autonomy/ExperimentScheduler';
import type { AutonomousHypothesisGenerationReport } from '../autonomy/ResearchHypothesis';
import type { SqlPool } from './PostgresResearchStore';

const json = (value: unknown): string => JSON.stringify(value);

const requireAffectedRow = (rowCount: number | null, message: string): void => {
  if (rowCount !== 1) throw new Error(message);
};

export class PostgresAutonomousResearchStore {
  public constructor(private readonly pool: SqlPool) {}

  public async persistCycleBundle(input: {
    readonly cycle: AutonomousResearchCycleManifest;
    readonly hypotheses: AutonomousHypothesisGenerationReport;
    readonly features: AdaptiveFeatureDiscoveryReport;
    readonly backtestPlan: DistributedBacktestPlan;
  }): Promise<void> {
    if (
      input.cycle.hypothesisFamilyFingerprint !==
        input.hypotheses.familyFingerprint ||
      input.cycle.featureFamilyFingerprint !== input.features.familyFingerprint ||
      input.cycle.backtestPlanFingerprint !== input.backtestPlan.planFingerprint
    ) {
      throw new Error('autonomous cycle evidence fingerprints do not match');
    }
    if (
      input.cycle.datasetFingerprint !== input.hypotheses.datasetFingerprint ||
      input.cycle.datasetFingerprint !== input.features.datasetFingerprint ||
      input.cycle.datasetFingerprint !== input.backtestPlan.datasetFingerprint
    ) {
      throw new Error('autonomous cycle dataset fingerprints do not match');
    }
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query(
        `INSERT INTO research.autonomous_research_cycles (
          cycle_id, cycle_fingerprint, dataset_fingerprint, code_commit,
          configuration_hash, hypothesis_family_fingerprint,
          feature_family_fingerprint, candidate_family_fingerprints,
          backtest_plan_fingerprint, hypothesis_count, ready_hypothesis_count,
          feature_candidate_count, ready_feature_count, strategy_candidate_count,
          effective_hypothesis_count, backtest_work_unit_count, status,
          blocking_reasons, created_at_ms, discovery_only, holdout_accessed,
          strategy_promotion_allowed, live_execution_allowed
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12,
          $13, $14, $15, $16, $17, $18::jsonb, $19, $20, $21, $22, $23
        )`,
        [
          input.cycle.cycleId,
          input.cycle.cycleFingerprint,
          input.cycle.datasetFingerprint,
          input.cycle.codeCommit,
          input.cycle.configurationHash,
          input.cycle.hypothesisFamilyFingerprint,
          input.cycle.featureFamilyFingerprint,
          json(input.cycle.candidateFamilyFingerprints),
          input.cycle.backtestPlanFingerprint,
          input.cycle.hypothesisCount,
          input.cycle.readyHypothesisCount,
          input.cycle.featureCandidateCount,
          input.cycle.readyFeatureCount,
          input.cycle.strategyCandidateCount,
          input.cycle.effectiveHypothesisCount,
          input.cycle.backtestWorkUnitCount,
          input.cycle.status,
          json(input.cycle.blockingReasons),
          input.cycle.createdAt,
          input.cycle.discoveryOnly,
          input.cycle.holdoutAccessed,
          input.cycle.strategyPromotionAllowed,
          input.cycle.liveExecutionAllowed,
        ],
      );
      for (const hypothesis of input.hypotheses.hypotheses) {
        await connection.query(
          `INSERT INTO research.autonomous_research_hypotheses (
            cycle_id, hypothesis_id, hypothesis_fingerprint, template_id, kind,
            strategy_id, strategy_version, research_question, rationale,
            falsification_criterion, feature_names, parameter_space,
            required_data_capabilities, search_space_size, complexity_units,
            status, blocking_reasons, discovery_only, holdout_accessed,
            strategy_promotion_allowed, live_execution_allowed
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb,
            $12::jsonb, $13::jsonb, $14, $15, $16, $17::jsonb, $18, $19,
            $20, $21
          )`,
          [
            input.cycle.cycleId,
            hypothesis.hypothesisId,
            hypothesis.hypothesisFingerprint,
            hypothesis.templateId,
            hypothesis.kind,
            hypothesis.strategyId,
            hypothesis.strategyVersion,
            hypothesis.researchQuestion,
            hypothesis.rationale,
            hypothesis.falsificationCriterion,
            json(hypothesis.featureNames),
            json(hypothesis.parameterSpace),
            json(hypothesis.requiredDataCapabilities),
            hypothesis.searchSpaceSize,
            hypothesis.complexityUnits,
            hypothesis.status,
            json(hypothesis.blockingReasons),
            hypothesis.discoveryOnly,
            hypothesis.holdoutAccessed,
            hypothesis.strategyPromotionAllowed,
            hypothesis.liveExecutionAllowed,
          ],
        );
      }
      for (const feature of input.features.candidates) {
        await connection.query(
          `INSERT INTO research.adaptive_feature_candidates (
            cycle_id, feature_id, feature_fingerprint, recipe_id, operation,
            input_feature_names, feature_role, window_ms, total_lookback_ms,
            complexity_units, required_data_capabilities, lineage, status,
            blocking_reasons, discovery_only, holdout_accessed,
            strategy_promotion_allowed, live_execution_allowed
          ) VALUES (
            $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10,
            $11::jsonb, $12::jsonb, $13, $14::jsonb, $15, $16, $17, $18
          )`,
          [
            input.cycle.cycleId,
            feature.featureId,
            feature.featureFingerprint,
            feature.recipeId,
            feature.operation,
            json(feature.inputFeatureNames),
            feature.role,
            feature.windowMs,
            feature.totalLookbackMs,
            feature.complexityUnits,
            json(feature.requiredDataCapabilities),
            json(feature.lineage),
            feature.status,
            json(feature.blockingReasons),
            feature.discoveryOnly,
            feature.holdoutAccessed,
            feature.strategyPromotionAllowed,
            feature.liveExecutionAllowed,
          ],
        );
      }
      for (const task of input.cycle.taskSpecs) {
        await connection.query(
          `INSERT INTO research.autonomous_experiment_tasks (
            task_id, cycle_id, task_type, dependency_task_ids, priority,
            created_at_ms, maximum_attempts, lease_duration_ms, resource_units,
            payload_fingerprint, status, attempt_count, updated_at_ms,
            live_execution_allowed
          ) VALUES (
            $1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10,
            'PENDING', 0, $11, false
          )`,
          [
            task.taskId,
            task.cycleId,
            task.taskType,
            json(task.dependencyTaskIds),
            task.priority,
            task.createdAt,
            task.maximumAttempts,
            task.leaseDurationMs,
            task.resourceUnits,
            task.payloadFingerprint,
            task.createdAt,
          ],
        );
      }
      for (const workUnit of input.backtestPlan.workUnits) {
        await connection.query(
          `INSERT INTO research.distributed_backtest_work_units (
            work_unit_id, cycle_id, work_unit_fingerprint, candidate_id,
            candidate_fingerprint, scenario_id, assumptions_fingerprint,
            fold_id, instrument_id, shard_index, shard_count, observation_ids,
            episode_ids, dataset_fingerprint, code_commit, configuration_hash,
            discovery_only, holdout_accessed, live_execution_allowed
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
            $12::jsonb, $13::jsonb, $14, $15, $16, $17, $18, $19
          )`,
          [
            workUnit.workUnitId,
            input.cycle.cycleId,
            workUnit.workUnitFingerprint,
            workUnit.candidateId,
            workUnit.candidateFingerprint,
            workUnit.scenarioId,
            workUnit.assumptionsFingerprint,
            workUnit.foldId,
            workUnit.instrumentId,
            workUnit.shardIndex,
            workUnit.shardCount,
            json(workUnit.observationIds),
            json(workUnit.episodeIds),
            workUnit.datasetFingerprint,
            workUnit.codeCommit,
            workUnit.configurationHash,
            workUnit.discoveryOnly,
            workUnit.holdoutAccessed,
            workUnit.liveExecutionAllowed,
          ],
        );
      }
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  }

  public async persistTaskSnapshot(task: ExperimentTaskSnapshot): Promise<void> {
    const result = await this.pool.query(
      `UPDATE research.autonomous_experiment_tasks
       SET status = $2, attempt_count = $3, leased_by = $4,
           lease_expires_at_ms = $5, result_fingerprint = $6,
           failure_reason = $7, updated_at_ms = $8
       WHERE task_id = $1`,
      [
        task.taskId,
        task.status,
        task.attemptCount,
        task.leasedBy,
        task.leaseExpiresAt,
        task.resultFingerprint,
        task.failureReason,
        task.updatedAt,
      ],
    );
    requireAffectedRow(result.rowCount, `unknown autonomous task ${task.taskId}`);
  }

  public async persistBacktestResult(result: BacktestWorkUnitResult): Promise<void> {
    await this.pool.query(
      `INSERT INTO research.distributed_backtest_results (
        result_fingerprint, work_unit_id, worker_id, started_at_ms,
        completed_at_ms, observation_count, independent_episode_count,
        trade_count, net_pnl, gross_profit, gross_loss,
        maximum_drawdown_fraction, status, failure_reason,
        live_execution_allowed
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      )`,
      [
        result.resultFingerprint,
        result.workUnitId,
        result.workerId,
        result.startedAt,
        result.completedAt,
        result.observationCount,
        result.independentEpisodeCount,
        result.tradeCount,
        result.netPnl,
        result.grossProfit,
        result.grossLoss,
        result.maximumDrawdownFraction,
        result.status,
        result.failureReason,
        result.liveExecutionAllowed,
      ],
    );
  }

  public async persistRanking(
    cycleId: string,
    ranking: AutonomousResearchRankingReport,
  ): Promise<void> {
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      for (const row of ranking.rows) {
        await connection.query(
          `INSERT INTO research.autonomous_candidate_rankings (
            cycle_id, candidate_id, candidate_fingerprint,
            research_priority_rank, conservative_research_score,
            evidence_status, blocking_reasons, independent_episode_count,
            trade_count, hypothesis_family_size, complexity_units,
            discovery_evidence_only, strategy_promotion_allowed,
            live_execution_allowed
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11,
            $12, $13, $14
          )`,
          [
            cycleId,
            row.candidateId,
            row.candidateFingerprint,
            row.researchPriorityRank,
            row.conservativeResearchScore,
            row.evidenceStatus,
            json(row.blockingReasons),
            row.independentEpisodeCount,
            row.tradeCount,
            row.hypothesisFamilySize,
            row.complexityUnits,
            row.discoveryEvidenceOnly,
            row.strategyPromotionAllowed,
            row.liveExecutionAllowed,
          ],
        );
      }
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  }

  public async persistContinuousReport(
    report: ContinuousResearchReport,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO research.continuous_research_reports (
        report_id, report_fingerprint, cycle_id, generated_at_ms,
        research_state, cycle_status, task_counts, task_completion_fraction,
        data_collection_days, instrument_count, regime_coverage_fraction,
        data_capability_coverage_fraction, unresolved_gap_count,
        backtest_status, ranked_candidate_count, replication_priority_count,
        blockers, next_actions, profitability_claimed,
        strategy_promotion_allowed, live_execution_allowed
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17::jsonb, $18::jsonb, $19, $20, $21
      )`,
      [
        report.reportId,
        report.reportFingerprint,
        report.cycleId,
        report.generatedAt,
        report.researchState,
        report.cycleStatus,
        json(report.taskCounts),
        report.taskCompletionFraction,
        report.dataCollectionDays,
        report.instrumentCount,
        report.regimeCoverageFraction,
        report.dataCapabilityCoverageFraction,
        report.unresolvedGapCount,
        report.backtestStatus,
        report.rankedCandidateCount,
        report.replicationPriorityCount,
        json(report.blockers),
        json(report.nextActions),
        report.profitabilityClaimed,
        report.strategyPromotionAllowed,
        report.liveExecutionAllowed,
      ],
    );
  }
}
