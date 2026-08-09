import type { ResearchExperimentManifest } from '../research/ResearchExperimentManifest';
import type { GeneratedStrategyCandidate } from '../research/StrategyCandidateGenerator';
import type { SqlConnection, SqlPool } from './PostgresResearchStore';

export interface StoredStatisticalEvidence {
  readonly evidenceId: string;
  readonly evidenceType: 'STRATEGY_COMPARISON' | 'FEATURE_ABLATION';
  readonly hypothesisId: string;
  readonly independentPairCount: number;
  readonly meanDifference: number | null;
  readonly standardizedEffect: number | null;
  readonly confidenceLower: number | null;
  readonly confidenceUpper: number | null;
  readonly confidenceLevel: number | null;
  readonly probabilityOfImprovement: number | null;
  readonly rawPValue: number | null;
  readonly adjustedPValue: number | null;
  readonly multiplicityMethod: 'HOLM_BONFERRONI';
  readonly hypothesisFamilySize: number;
  readonly status: 'PASSED' | 'REJECTED';
  readonly rejectionReasons: readonly string[];
  readonly liveExecutionAllowed: false;
}

export interface EmpiricalResearchEvidenceBundle {
  readonly manifest: ResearchExperimentManifest;
  readonly candidates: readonly GeneratedStrategyCandidate[];
  readonly statisticalEvidence: readonly StoredStatisticalEvidence[];
}

const serialize = (value: unknown): string => JSON.stringify(value);

const validateEvidence = (
  evidence: StoredStatisticalEvidence,
): void => {
  if (
    evidence.evidenceId.trim().length === 0 ||
    evidence.hypothesisId.trim().length === 0
  ) {
    throw new Error('statistical evidence identifiers must not be empty');
  }
  if (
    !Number.isSafeInteger(evidence.independentPairCount) ||
    evidence.independentPairCount < 0 ||
    !Number.isSafeInteger(evidence.hypothesisFamilySize) ||
    evidence.hypothesisFamilySize <= 0
  ) {
    throw new Error('statistical evidence counts are invalid');
  }
  for (const [name, value] of Object.entries(evidence)) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`non-finite statistical evidence ${name}`);
    }
  }
  if (evidence.liveExecutionAllowed !== false) {
    throw new Error('statistical evidence cannot enable live execution');
  }
};

const rollbackQuietly = async (connection: SqlConnection): Promise<void> => {
  try {
    await connection.query('ROLLBACK');
  } catch {
    // Preserve the original persistence failure.
  }
};

export class PostgresEmpiricalResearchEvidenceStore {
  public constructor(private readonly pool: SqlPool) {}

  public async saveBundle(bundle: EmpiricalResearchEvidenceBundle): Promise<void> {
    if (bundle.manifest.liveExecutionAllowed !== false) {
      throw new Error('experiment manifest cannot enable live execution');
    }
    const candidateIds = new Set<string>();
    for (const candidate of bundle.candidates) {
      if (candidateIds.has(candidate.candidateId)) {
        throw new Error(`duplicate candidate ${candidate.candidateId}`);
      }
      candidateIds.add(candidate.candidateId);
      if (
        candidate.hypothesisFamilyId !== bundle.manifest.hypothesisFamilyId ||
        candidate.liveExecutionAllowed !== false ||
        candidate.holdoutAccessed !== false
      ) {
        throw new Error(`candidate ${candidate.candidateId} conflicts with manifest`);
      }
    }
    const evidenceIds = new Set<string>();
    for (const evidence of bundle.statisticalEvidence) {
      validateEvidence(evidence);
      if (evidenceIds.has(evidence.evidenceId)) {
        throw new Error(`duplicate statistical evidence ${evidence.evidenceId}`);
      }
      evidenceIds.add(evidence.evidenceId);
    }

    const connection = await this.pool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query(
        `INSERT INTO research.research_experiment_manifests (
          experiment_id, scope, hypothesis_family_id, strategy_ids,
          feature_names, discovery_dataset_fingerprint,
          holdout_dataset_fingerprint, code_commit, configuration_hash,
          candidate_family_fingerprint, candidate_count, hypothesis_count,
          split_audit, frozen_at_ms, started_at_ms, completed_at_ms,
          holdout_access_count, significance_method, multiplicity_method,
          status, rejection_reasons, manifest_fingerprint,
          strategy_promotion_allowed, live_execution_allowed
        ) VALUES (
          $1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,
          $14,$15,$16,$17,$18,$19,$20,$21::jsonb,$22,$23,$24
        )`,
        [
          bundle.manifest.experimentId,
          bundle.manifest.scope,
          bundle.manifest.hypothesisFamilyId,
          serialize(bundle.manifest.strategyIds),
          serialize(bundle.manifest.featureNames),
          bundle.manifest.discoveryDatasetFingerprint,
          bundle.manifest.holdoutDatasetFingerprint,
          bundle.manifest.codeCommit,
          bundle.manifest.configurationHash,
          bundle.manifest.candidateFamilyFingerprint,
          bundle.manifest.candidateCount,
          bundle.manifest.hypothesisCount,
          serialize(bundle.manifest.splitAudit),
          bundle.manifest.frozenAt,
          bundle.manifest.startedAt,
          bundle.manifest.completedAt,
          bundle.manifest.holdoutAccessCount,
          bundle.manifest.significanceMethod,
          bundle.manifest.multiplicityMethod,
          bundle.manifest.status,
          serialize(bundle.manifest.rejectionReasons),
          bundle.manifest.manifestFingerprint,
          bundle.manifest.strategyPromotionAllowed,
          bundle.manifest.liveExecutionAllowed,
        ],
      );
      for (const quality of bundle.manifest.dataQuality) {
        await connection.query(
          `INSERT INTO research.research_data_quality_assessments (
            experiment_id, source_name, input_count, selected_count,
            excluded_future_observation_count,
            excluded_unavailable_at_decision_count,
            excluded_outside_lookback_count, latest_observed_at_ms,
            latest_received_at_ms, age_ms, status, rejection_reasons
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
          [
            bundle.manifest.experimentId,
            quality.sourceName,
            quality.inputCount,
            quality.selectedCount,
            quality.excludedFutureObservationCount,
            quality.excludedUnavailableAtDecisionCount,
            quality.excludedOutsideLookbackCount,
            quality.latestObservedAt,
            quality.latestReceivedAt,
            quality.ageMs,
            quality.status,
            serialize(quality.rejectionReasons),
          ],
        );
      }
      for (const candidate of bundle.candidates) {
        await connection.query(
          `INSERT INTO research.strategy_candidate_specifications (
            experiment_id, candidate_id, strategy_id, strategy_version,
            hypothesis_family_id, parameters, candidate_fingerprint,
            discovery_scope, holdout_accessed, live_execution_allowed
          ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)`,
          [
            bundle.manifest.experimentId,
            candidate.candidateId,
            candidate.strategyId,
            candidate.strategyVersion,
            candidate.hypothesisFamilyId,
            serialize(candidate.parameters),
            candidate.candidateFingerprint,
            candidate.discoveryScope,
            candidate.holdoutAccessed,
            candidate.liveExecutionAllowed,
          ],
        );
      }
      for (const evidence of bundle.statisticalEvidence) {
        await connection.query(
          `INSERT INTO research.statistical_evidence_runs (
            evidence_id, experiment_id, evidence_type, hypothesis_id,
            independent_pair_count, mean_difference, standardized_effect,
            confidence_lower, confidence_upper, confidence_level,
            probability_of_improvement, raw_p_value, adjusted_p_value,
            multiplicity_method, hypothesis_family_size, status,
            rejection_reasons, live_execution_allowed
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
            $17::jsonb,$18
          )`,
          [
            evidence.evidenceId,
            bundle.manifest.experimentId,
            evidence.evidenceType,
            evidence.hypothesisId,
            evidence.independentPairCount,
            evidence.meanDifference,
            evidence.standardizedEffect,
            evidence.confidenceLower,
            evidence.confidenceUpper,
            evidence.confidenceLevel,
            evidence.probabilityOfImprovement,
            evidence.rawPValue,
            evidence.adjustedPValue,
            evidence.multiplicityMethod,
            evidence.hypothesisFamilySize,
            evidence.status,
            serialize(evidence.rejectionReasons),
            evidence.liveExecutionAllowed,
          ],
        );
      }
      await connection.query('COMMIT');
    } catch (error: unknown) {
      await rollbackQuietly(connection);
      throw error;
    } finally {
      connection.release();
    }
  }
}
