BEGIN;

CREATE TABLE IF NOT EXISTS research.research_experiment_manifests (
  experiment_id text PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN ('PURGED_DISCOVERY', 'FROZEN_HOLDOUT')),
  hypothesis_family_id text NOT NULL,
  strategy_ids jsonb NOT NULL,
  feature_names jsonb NOT NULL,
  discovery_dataset_fingerprint text NOT NULL,
  holdout_dataset_fingerprint text NOT NULL,
  code_commit text NOT NULL,
  configuration_hash text NOT NULL,
  candidate_family_fingerprint text NOT NULL,
  candidate_count integer NOT NULL CHECK (candidate_count >= 0),
  hypothesis_count integer NOT NULL CHECK (hypothesis_count >= 0),
  split_audit jsonb NOT NULL,
  frozen_at_ms bigint NOT NULL,
  started_at_ms bigint NOT NULL,
  completed_at_ms bigint NOT NULL,
  holdout_access_count integer NOT NULL CHECK (holdout_access_count >= 0),
  significance_method text NOT NULL,
  multiplicity_method text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACCEPTED_FOR_RESEARCH', 'REJECTED')),
  rejection_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  manifest_fingerprint text NOT NULL UNIQUE,
  strategy_promotion_allowed boolean NOT NULL DEFAULT false,
  live_execution_allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (discovery_dataset_fingerprint <> holdout_dataset_fingerprint),
  CHECK (strategy_promotion_allowed = false),
  CHECK (live_execution_allowed = false)
);
CREATE INDEX IF NOT EXISTS research_experiment_scope_time_idx
  ON research.research_experiment_manifests (scope, completed_at_ms DESC);
CREATE INDEX IF NOT EXISTS research_experiment_family_idx
  ON research.research_experiment_manifests (hypothesis_family_id, created_at DESC);

CREATE TABLE IF NOT EXISTS research.research_data_quality_assessments (
  experiment_id text NOT NULL REFERENCES research.research_experiment_manifests(experiment_id) ON DELETE CASCADE,
  source_name text NOT NULL,
  input_count bigint NOT NULL CHECK (input_count >= 0),
  selected_count bigint NOT NULL CHECK (selected_count >= 0),
  excluded_future_observation_count bigint NOT NULL CHECK (excluded_future_observation_count >= 0),
  excluded_unavailable_at_decision_count bigint NOT NULL CHECK (excluded_unavailable_at_decision_count >= 0),
  excluded_outside_lookback_count bigint NOT NULL CHECK (excluded_outside_lookback_count >= 0),
  latest_observed_at_ms bigint,
  latest_received_at_ms bigint,
  age_ms bigint,
  status text NOT NULL CHECK (status IN ('PASSED', 'REJECTED')),
  rejection_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (experiment_id, source_name)
);

CREATE TABLE IF NOT EXISTS research.strategy_candidate_specifications (
  experiment_id text NOT NULL REFERENCES research.research_experiment_manifests(experiment_id) ON DELETE CASCADE,
  candidate_id text NOT NULL,
  strategy_id text NOT NULL,
  strategy_version integer NOT NULL CHECK (strategy_version > 0),
  hypothesis_family_id text NOT NULL,
  parameters jsonb NOT NULL,
  candidate_fingerprint text NOT NULL,
  discovery_scope text NOT NULL CHECK (discovery_scope = 'PURGED_DISCOVERY'),
  holdout_accessed boolean NOT NULL DEFAULT false,
  live_execution_allowed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (experiment_id, candidate_id),
  UNIQUE (experiment_id, candidate_fingerprint),
  CHECK (holdout_accessed = false),
  CHECK (live_execution_allowed = false)
);
CREATE INDEX IF NOT EXISTS strategy_candidate_family_idx
  ON research.strategy_candidate_specifications (hypothesis_family_id, strategy_id);

CREATE TABLE IF NOT EXISTS research.statistical_evidence_runs (
  evidence_id text PRIMARY KEY,
  experiment_id text NOT NULL REFERENCES research.research_experiment_manifests(experiment_id) ON DELETE CASCADE,
  evidence_type text NOT NULL CHECK (evidence_type IN ('STRATEGY_COMPARISON', 'FEATURE_ABLATION')),
  hypothesis_id text NOT NULL,
  independent_pair_count integer NOT NULL CHECK (independent_pair_count >= 0),
  mean_difference double precision,
  standardized_effect double precision,
  confidence_lower double precision,
  confidence_upper double precision,
  confidence_level double precision CHECK (confidence_level > 0.5 AND confidence_level < 1),
  probability_of_improvement double precision CHECK (probability_of_improvement >= 0 AND probability_of_improvement <= 1),
  raw_p_value double precision CHECK (raw_p_value >= 0 AND raw_p_value <= 1),
  adjusted_p_value double precision CHECK (adjusted_p_value >= 0 AND adjusted_p_value <= 1),
  multiplicity_method text NOT NULL,
  hypothesis_family_size integer NOT NULL CHECK (hypothesis_family_size > 0),
  status text NOT NULL CHECK (status IN ('PASSED', 'REJECTED')),
  rejection_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  live_execution_allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (experiment_id, evidence_type, hypothesis_id),
  CHECK (live_execution_allowed = false)
);
CREATE INDEX IF NOT EXISTS statistical_evidence_experiment_idx
  ON research.statistical_evidence_runs (experiment_id, evidence_type);

INSERT INTO research.schema_migrations (version, name)
VALUES (5, 'empirical research hardening and experiment evidence')
ON CONFLICT (version) DO NOTHING;

COMMIT;
