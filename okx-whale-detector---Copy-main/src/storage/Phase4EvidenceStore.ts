import type { PaperTradingReleaseEvidence, ReleaseCandidateDecision, ReleaseCandidateEvidence } from '../release/ReleaseCandidateGate';
import type { FeatureSelectionPolicy, FeatureSelectionReport } from '../research/FeatureSelection';
import type { RobustnessScenarioResult, RobustnessValidationDecision, RobustnessValidationPolicy } from '../research/RobustnessValidation';
import type { SqlConnection, SqlPool } from './PostgresResearchStore';

export interface StoredFeatureSelectionRun {
  readonly runId: string;
  readonly strategyKey: string;
  readonly datasetId: string;
  readonly datasetFingerprint: string;
  readonly codeCommit: string;
  readonly configurationHash: string;
  readonly policy: FeatureSelectionPolicy;
  readonly report: FeatureSelectionReport;
}

export interface StoredRobustnessValidationRun {
  readonly validationId: string;
  readonly strategyKey: string;
  readonly codeCommit: string;
  readonly configurationHash: string;
  readonly policy: RobustnessValidationPolicy;
  readonly decision: RobustnessValidationDecision;
  readonly scenarios: readonly RobustnessScenarioResult[];
}

export interface StoredPaperTradingReleaseRun {
  readonly paperRunId: string;
  readonly strategyKey: string;
  readonly evidence: PaperTradingReleaseEvidence;
}

export interface StoredReleaseCandidateEvaluation {
  readonly evaluationId: string;
  readonly evidence: ReleaseCandidateEvidence;
  readonly decision: ReleaseCandidateDecision;
}

const serialize = (value: unknown): string => JSON.stringify(value);

const requireNonEmpty = (value: string, name: string): void => {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
};

export class PostgresPhase4EvidenceStore {
  public constructor(private readonly pool: SqlPool) {}

  private async withTransaction<T>(
    operation: (connection: SqlConnection) => Promise<T>,
  ): Promise<T> {
    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      const result = await operation(connection);
      await connection.query('COMMIT');
      return result;
    } catch (error: unknown) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  }

  public async saveFeatureSelection(
    run: StoredFeatureSelectionRun,
  ): Promise<void> {
    requireNonEmpty(run.runId, 'feature selection runId');
    requireNonEmpty(run.strategyKey, 'strategyKey');
    requireNonEmpty(run.datasetId, 'datasetId');
    requireNonEmpty(run.datasetFingerprint, 'datasetFingerprint');
    requireNonEmpty(run.codeCommit, 'codeCommit');
    requireNonEmpty(run.configurationHash, 'configurationHash');

    await this.withTransaction(async (connection) => {
      await connection.query(
        `INSERT INTO research.feature_selection_runs (
          feature_selection_run_id, strategy_key, dataset_id,
          dataset_fingerprint, code_commit, configuration_hash, status,
          policy, selected_features, rejection_reasons
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb)`,
        [
          run.runId,
          run.strategyKey,
          run.datasetId,
          run.datasetFingerprint,
          run.codeCommit,
          run.configurationHash,
          run.report.status,
          serialize(run.policy),
          serialize(run.report.selectedFeatures),
          serialize(run.report.rejectionReasons),
        ],
      );
      for (const decision of run.report.decisions) {
        await connection.query(
          `INSERT INTO research.feature_selection_results (
            feature_selection_run_id, feature_name, feature_role, status,
            median_importance, positive_importance_fraction,
            importance_coefficient_of_variation, selection_score,
            documented_purpose, rationale, rejection_reasons
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb)`,
          [
            run.runId,
            decision.featureName,
            decision.role,
            decision.status,
            decision.medianImportance,
            decision.positiveImportanceFraction,
            decision.importanceCoefficientOfVariation,
            decision.selectionScore,
            decision.documentedPurpose,
            serialize(decision.rationale),
            serialize(decision.rejectionReasons),
          ],
        );
      }
    });
  }

  public async saveRobustnessValidation(
    run: StoredRobustnessValidationRun,
  ): Promise<void> {
    requireNonEmpty(run.validationId, 'robustness validationId');
    requireNonEmpty(run.strategyKey, 'strategyKey');
    requireNonEmpty(run.codeCommit, 'codeCommit');
    requireNonEmpty(run.configurationHash, 'configurationHash');
    if (run.decision.strategyId !== run.strategyKey) {
      throw new Error('robustness strategy evidence mismatch');
    }

    await this.withTransaction(async (connection) => {
      await connection.query(
        `INSERT INTO research.robustness_validation_runs (
          robustness_validation_id, strategy_key, dataset_fingerprint,
          code_commit, configuration_hash, status, scenario_count,
          positive_regime_fraction, total_baseline_trades,
          minimum_stress_expectancy, maximum_drawdown_percent, policy,
          rejection_reasons
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb)`,
        [
          run.validationId,
          run.strategyKey,
          run.decision.datasetFingerprint,
          run.codeCommit,
          run.configurationHash,
          run.decision.status,
          run.decision.scenarioCount,
          run.decision.positiveRegimeFraction,
          run.decision.totalBaselineTrades,
          run.decision.minimumObservedStressExpectancy,
          run.decision.maximumObservedDrawdownPercent,
          serialize(run.policy),
          serialize(run.decision.rejectionReasons),
        ],
      );
      for (const scenario of run.scenarios) {
        if (scenario.strategyId !== run.strategyKey) {
          throw new Error(`scenario strategy mismatch for ${scenario.scenarioId}`);
        }
        await connection.query(
          `INSERT INTO research.robustness_scenarios (
            robustness_validation_id, scenario_id, regime, scenario_kind,
            source_kind, independent_episode_count, assumptions, metrics
          ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)`,
          [
            run.validationId,
            scenario.scenarioId,
            scenario.regime,
            scenario.scenarioKind,
            scenario.sourceKind,
            scenario.independentEpisodeCount,
            serialize(scenario.assumptions),
            serialize(scenario.statistics),
          ],
        );
      }
    });
  }

  public async savePaperTradingReleaseRun(
    run: StoredPaperTradingReleaseRun,
  ): Promise<void> {
    requireNonEmpty(run.paperRunId, 'paperRunId');
    requireNonEmpty(run.strategyKey, 'strategyKey');
    requireNonEmpty(run.evidence.codeCommit, 'codeCommit');
    requireNonEmpty(run.evidence.configurationHash, 'configurationHash');
    await this.pool.query(
      `INSERT INTO research.paper_trading_release_runs (
        paper_run_id, strategy_key, source_kind, code_commit,
        configuration_hash, started_at_ms, ended_at_ms,
        order_intent_count, trade_count, data_gap_count,
        duplicate_fill_count, reconciliation_error_rate, metrics
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
      [
        run.paperRunId,
        run.strategyKey,
        run.evidence.sourceKind,
        run.evidence.codeCommit,
        run.evidence.configurationHash,
        run.evidence.startedAt,
        run.evidence.endedAt,
        run.evidence.orderIntentCount,
        run.evidence.statistics.tradeCount,
        run.evidence.dataGapCount,
        run.evidence.duplicateFillCount,
        run.evidence.reconciliationErrorRate,
        serialize(run.evidence.statistics),
      ],
    );
  }

  public async saveReleaseCandidateEvaluation(
    evaluation: StoredReleaseCandidateEvaluation,
  ): Promise<void> {
    requireNonEmpty(evaluation.evaluationId, 'release evaluationId');
    if (evaluation.evidence.strategyId !== evaluation.decision.strategyId) {
      throw new Error('release candidate strategy evidence mismatch');
    }
    await this.pool.query(
      `INSERT INTO research.release_candidate_evaluations (
        release_evaluation_id, strategy_key, strategy_version, code_commit,
        configuration_hash, status, ready_for_review, merge_allowed,
        tag_allowed, suggested_tag, evidence, rejection_reasons
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)`,
      [
        evaluation.evaluationId,
        evaluation.evidence.strategyId,
        evaluation.evidence.strategyVersion,
        evaluation.evidence.codeCommit,
        evaluation.evidence.configurationHash,
        evaluation.decision.status,
        evaluation.decision.readyForReview,
        evaluation.decision.mergeAllowed,
        evaluation.decision.tagAllowed,
        evaluation.decision.suggestedTag,
        serialize(evaluation.evidence),
        serialize(evaluation.decision.rejectionReasons),
      ],
    );
  }

  public close(): Promise<void> {
    return this.pool.end();
  }
}
