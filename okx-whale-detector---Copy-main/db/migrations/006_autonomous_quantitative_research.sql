BEGIN;

CREATE TABLE IF NOT EXISTS research.autonomous_research_cycles (
  cycle_id text PRIMARY KEY,
  cycle_fingerprint text NOT NULL UNIQUE,
  dataset_fingerprint text NOT NULL,
  code_commit text NOT NULL,
  configuration_hash text NOT NULL,
  hypothesis_family_fingerprint text NOT NULL,
  feature_family_fingerprint text NOT NULL,
  candidate_family_fingerprints jsonb NOT NULL,
  backtest_plan_fingerprint text NOT NULL,
  hypothesis_count integer NOT NULL CHECK (hypothesis_count >= 0),
  ready_hypothesis_count integer NOT NULL CHECK (ready_hypothesis_count >= 0),
  feature_candidate_count integer NOT NULL CHECK (feature_candidate_count >= 0),
  ready_feature_count integer NOT NULL CHECK (ready_feature_count >= 0),
  strategy_candidate_count integer NOT NULL CHECK (strategy_candidate_count >= 0),
  effective_hypothesis_count integer NOT NULL CHECK (effective_hypothesis_count >= 0),
  backtest_work_unit_count integer NOT NULL CHECK (backtest_work_unit_count >= 0),
  status text NOT NULL CHECK (status IN ('READY_TO_SCHEDULE', 'BLOCKED')),
  blocking_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at_ms bigint NOT NULL CHECK (created_at_ms >= 0),
  discovery_only boolean NOT NULL DEFAULT true,
  holdout_accessed boolean NOT NULL DEFAULT false,
  strategy_promotion_allowed boolean NOT NULL DEFAULT false,
  live_execution_allowed boolean NOT NULL DEFAULT false,
  persisted_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ready_hypothesis_count <= hypothesis_count),
  CHECK (ready_feature_count <= feature_candidate_count),
  CHECK (jsonb_typeof(candidate_family_fingerprints) = 'array'),
  CHECK (jsonb_typeof(blocking_reasons) = 'array'),
  CHECK (discovery_only = true),
  CHECK (holdout_accessed = false),
  CHECK (strategy_promotion_allowed = false),
  CHECK (live_execution_allowed = false)
);
CREATE INDEX IF NOT EXISTS autonomous_research_cycles_created_idx
  ON research.autonomous_research_cycles (created_at_ms DESC);
CREATE INDEX IF NOT EXISTS autonomous_research_cycles_dataset_idx
  ON research.autonomous_research_cycles (dataset_fingerprint, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS research.autonomous_research_hypotheses (
  cycle_id text NOT NULL REFERENCES research.autonomous_research_cycles(cycle_id) ON DELETE CASCADE,
  hypothesis_id text NOT NULL,
  hypothesis_fingerprint text NOT NULL,
  template_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('STRATEGY_VARIANT', 'FEATURE_INTERACTION', 'REGIME_CONDITION', 'EXECUTION_FILTER')),
  strategy_id text NOT NULL,
  strategy_version integer NOT NULL CHECK (strategy_version > 0),
  research_question text NOT NULL,
  rationale text NOT NULL,
  falsification_criterion text NOT NULL,
  feature_names jsonb NOT NULL,
  parameter_space jsonb NOT NULL,
  required_data_capabilities jsonb NOT NULL,
  search_space_size bigint NOT NULL CHECK (search_space_size >= 0),
  complexity_units integer NOT NULL CHECK (complexity_units > 0),
  status text NOT NULL CHECK (status IN ('READY_FOR_DISCOVERY', 'BLOCKED')),
  blocking_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  discovery_only boolean NOT NULL DEFAULT true,
  holdout_accessed boolean NOT NULL DEFAULT false,
  strategy_promotion_allowed boolean NOT NULL DEFAULT false,
  live_execution_allowed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (cycle_id, hypothesis_id),
  UNIQUE (cycle_id, hypothesis_fingerprint),
  CHECK (jsonb_typeof(feature_names) = 'array'),
  CHECK (jsonb_typeof(parameter_space) = 'object'),
  CHECK (jsonb_typeof(required_data_capabilities) = 'array'),
  CHECK (jsonb_typeof(blocking_reasons) = 'array'),
  CHECK (discovery_only = true),
  CHECK (holdout_accessed = false),
  CHECK (strategy_promotion_allowed = false),
  CHECK (live_execution_allowed = false)
);
CREATE INDEX IF NOT EXISTS autonomous_hypotheses_strategy_idx
  ON research.autonomous_research_hypotheses (strategy_id, kind, status);

CREATE TABLE IF NOT EXISTS research.adaptive_feature_candidates (
  cycle_id text NOT NULL REFERENCES research.autonomous_research_cycles(cycle_id) ON DELETE CASCADE,
  feature_id text NOT NULL,
  feature_fingerprint text NOT NULL,
  recipe_id text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('IDENTITY', 'LAG', 'CHANGE', 'Z_SCORE', 'RATIO', 'INTERACTION')),
  input_feature_names jsonb NOT NULL,
  feature_role text NOT NULL CHECK (feature_role IN ('ALPHA', 'REGIME', 'RISK_FILTER', 'EXECUTION_FILTER')),
  window_ms bigint CHECK (window_ms IS NULL OR window_ms > 0),
  total_lookback_ms bigint NOT NULL CHECK (total_lookback_ms >= 0),
  complexity_units integer NOT NULL CHECK (complexity_units > 0),
  required_data_capabilities jsonb NOT NULL,
  lineage jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('READY_FOR_ABLATION', 'BLOCKED')),
  blocking_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  discovery_only boolean NOT NULL DEFAULT true,
  holdout_accessed boolean NOT NULL DEFAULT false,
  strategy_promotion_allowed boolean NOT NULL DEFAULT false,
  live_execution_allowed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (cycle_id, feature_id),
  UNIQUE (cycle_id, feature_fingerprint),
  CHECK (jsonb_typeof(input_feature_names) = 'array'),
  CHECK (jsonb_typeof(required_data_capabilities) = 'array'),
  CHECK (jsonb_typeof(lineage) = 'array'),
  CHECK (jsonb_typeof(blocking_reasons) = 'array'),
  CHECK (discovery_only = true),
  CHECK (holdout_accessed = false),
  CHECK (strategy_promotion_allowed = false),
  CHECK (live_execution_allowed = false)
);
CREATE INDEX IF NOT EXISTS adaptive_feature_status_idx
  ON research.adaptive_feature_candidates (status, feature_role, operation);

CREATE TABLE IF NOT EXISTS research.autonomous_experiment_tasks (
  task_id text PRIMARY KEY,
  cycle_id text NOT NULL REFERENCES research.autonomous_research_cycles(cycle_id) ON DELETE CASCADE,
  task_type text NOT NULL CHECK (task_type IN ('HYPOTHESIS_GENERATION', 'FEATURE_DISCOVERY', 'CANDIDATE_GENERATION', 'BACKTEST_SHARD', 'RESULT_AGGREGATION', 'STATISTICAL_VALIDATION', 'CONTINUOUS_REPORT')),
  dependency_task_ids jsonb NOT NULL,
  priority integer NOT NULL,
  created_at_ms bigint NOT NULL CHECK (created_at_ms >= 0),
  maximum_attempts integer NOT NULL CHECK (maximum_attempts > 0),
  lease_duration_ms bigint NOT NULL CHECK (lease_duration_ms > 0),
  resource_units integer NOT NULL CHECK (resource_units > 0),
  payload_fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'LEASED', 'COMPLETED', 'FAILED', 'BLOCKED')) DEFAULT 'PENDING',
  attempt_count integer NOT NULL CHECK (attempt_count >= 0) DEFAULT 0,
  leased_by text,
  lease_expires_at_ms bigint,
  result_fingerprint text,
  failure_reason text,
  updated_at_ms bigint NOT NULL CHECK (updated_at_ms >= 0),
  live_execution_allowed boolean NOT NULL DEFAULT false,
  CHECK (jsonb_typeof(dependency_task_ids) = 'array'),
  CHECK (attempt_count <= maximum_attempts),
  CHECK (live_execution_allowed = false),
  CHECK ((status = 'LEASED') = (leased_by IS NOT NULL AND lease_expires_at_ms IS NOT NULL)),
  CHECK (status <> 'COMPLETED' OR result_fingerprint IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS autonomous_tasks_claim_idx
  ON research.autonomous_experiment_tasks (status, priority DESC, created_at_ms, task_id);
CREATE INDEX IF NOT EXISTS autonomous_tasks_cycle_idx
  ON research.autonomous_experiment_tasks (cycle_id, status);

CREATE TABLE IF NOT EXISTS research.distributed_backtest_work_units (
  work_unit_id text PRIMARY KEY,
  cycle_id text NOT NULL REFERENCES research.autonomous_research_cycles(cycle_id) ON DELETE CASCADE,
  work_unit_fingerprint text NOT NULL UNIQUE,
  candidate_id text NOT NULL,
  candidate_fingerprint text NOT NULL,
  scenario_id text NOT NULL,
  assumptions_fingerprint text NOT NULL,
  fold_id text NOT NULL,
  instrument_id text NOT NULL,
  shard_index integer NOT NULL CHECK (shard_index >= 0),
  shard_count integer NOT NULL CHECK (shard_count > 0),
  observation_ids jsonb NOT NULL,
  episode_ids jsonb NOT NULL,
  dataset_fingerprint text NOT NULL,
  code_commit text NOT NULL,
  configuration_hash text NOT NULL,
  discovery_only boolean NOT NULL DEFAULT true,
  holdout_accessed boolean NOT NULL DEFAULT false,
  live_execution_allowed boolean NOT NULL DEFAULT false,
  CHECK (shard_index < shard_count),
  CHECK (jsonb_typeof(observation_ids) = 'array'),
  CHECK (jsonb_typeof(episode_ids) = 'array'),
  CHECK (jsonb_array_length(observation_ids) > 0),
  CHECK (jsonb_array_length(episode_ids) > 0),
  CHECK (discovery_only = true),
  CHECK (holdout_accessed = false),
  CHECK (live_execution_allowed = false)
);
CREATE INDEX IF NOT EXISTS distributed_work_units_candidate_idx
  ON research.distributed_backtest_work_units (cycle_id, candidate_id, scenario_id);

CREATE TABLE IF NOT EXISTS research.distributed_backtest_results (
  result_fingerprint text PRIMARY KEY,
  work_unit_id text NOT NULL UNIQUE REFERENCES research.distributed_backtest_work_units(work_unit_id) ON DELETE CASCADE,
  worker_id text NOT NULL,
  started_at_ms bigint NOT NULL CHECK (started_at_ms >= 0),
  completed_at_ms bigint NOT NULL CHECK (completed_at_ms >= 0),
  observation_count bigint NOT NULL CHECK (observation_count >= 0),
  independent_episode_count bigint NOT NULL CHECK (independent_episode_count >= 0),
  trade_count bigint NOT NULL CHECK (trade_count >= 0),
  net_pnl double precision NOT NULL,
  gross_profit double precision NOT NULL CHECK (gross_profit >= 0),
  gross_loss double precision NOT NULL CHECK (gross_loss >= 0),
  maximum_drawdown_fraction double precision NOT NULL CHECK (maximum_drawdown_fraction >= 0 AND maximum_drawdown_fraction <= 1),
  status text NOT NULL CHECK (status IN ('COMPLETED', 'FAILED')),
  failure_reason text,
  live_execution_allowed boolean NOT NULL DEFAULT false,
  persisted_at timestamptz NOT NULL DEFAULT now(),
  CHECK (completed_at_ms >= started_at_ms),
  CHECK ((status = 'FAILED') = (failure_reason IS NOT NULL)),
  CHECK (live_execution_allowed = false)
);

CREATE TABLE IF NOT EXISTS research.autonomous_candidate_rankings (
  cycle_id text NOT NULL REFERENCES research.autonomous_research_cycles(cycle_id) ON DELETE CASCADE,
  candidate_id text NOT NULL,
  candidate_fingerprint text NOT NULL,
  research_priority_rank integer CHECK (research_priority_rank > 0),
  conservative_research_score double precision,
  evidence_status text NOT NULL CHECK (evidence_status IN ('REPLICATION_PRIORITY', 'EXPLORATORY_ONLY', 'BLOCKED')),
  blocking_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  independent_episode_count bigint NOT NULL CHECK (independent_episode_count >= 0),
  trade_count bigint NOT NULL CHECK (trade_count >= 0),
  hypothesis_family_size bigint NOT NULL CHECK (hypothesis_family_size > 0),
  complexity_units integer NOT NULL CHECK (complexity_units > 0),
  discovery_evidence_only boolean NOT NULL DEFAULT true,
  strategy_promotion_allowed boolean NOT NULL DEFAULT false,
  live_execution_allowed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (cycle_id, candidate_id),
  UNIQUE (cycle_id, candidate_fingerprint),
  UNIQUE (cycle_id, research_priority_rank),
  CHECK (jsonb_typeof(blocking_reasons) = 'array'),
  CHECK (discovery_evidence_only = true),
  CHECK (strategy_promotion_allowed = false),
  CHECK (live_execution_allowed = false)
);

CREATE TABLE IF NOT EXISTS research.continuous_research_reports (
  report_id text PRIMARY KEY,
  report_fingerprint text NOT NULL UNIQUE,
  cycle_id text NOT NULL REFERENCES research.autonomous_research_cycles(cycle_id) ON DELETE CASCADE,
  generated_at_ms bigint NOT NULL CHECK (generated_at_ms >= 0),
  research_state text NOT NULL CHECK (research_state IN ('ACQUIRING_EVIDENCE', 'RUNNING_EXPERIMENTS', 'REVIEWING_DISCOVERY_RESULTS', 'BLOCKED')),
  cycle_status text NOT NULL CHECK (cycle_status IN ('READY_TO_SCHEDULE', 'BLOCKED')),
  task_counts jsonb NOT NULL,
  task_completion_fraction double precision NOT NULL CHECK (task_completion_fraction >= 0 AND task_completion_fraction <= 1),
  data_collection_days double precision NOT NULL CHECK (data_collection_days >= 0),
  instrument_count integer NOT NULL CHECK (instrument_count >= 0),
  regime_coverage_fraction double precision NOT NULL CHECK (regime_coverage_fraction >= 0 AND regime_coverage_fraction <= 1),
  data_capability_coverage_fraction double precision NOT NULL CHECK (data_capability_coverage_fraction >= 0 AND data_capability_coverage_fraction <= 1),
  unresolved_gap_count bigint NOT NULL CHECK (unresolved_gap_count >= 0),
  backtest_status text NOT NULL CHECK (backtest_status IN ('COMPLETE', 'INCOMPLETE', 'REJECTED', 'NOT_AVAILABLE')),
  ranked_candidate_count integer NOT NULL CHECK (ranked_candidate_count >= 0),
  replication_priority_count integer NOT NULL CHECK (replication_priority_count >= 0),
  blockers jsonb NOT NULL,
  next_actions jsonb NOT NULL,
  profitability_claimed boolean NOT NULL DEFAULT false,
  strategy_promotion_allowed boolean NOT NULL DEFAULT false,
  live_execution_allowed boolean NOT NULL DEFAULT false,
  persisted_at timestamptz NOT NULL DEFAULT now(),
  CHECK (replication_priority_count <= ranked_candidate_count),
  CHECK (jsonb_typeof(task_counts) = 'object'),
  CHECK (jsonb_typeof(blockers) = 'array'),
  CHECK (jsonb_typeof(next_actions) = 'array'),
  CHECK (profitability_claimed = false),
  CHECK (strategy_promotion_allowed = false),
  CHECK (live_execution_allowed = false)
);
CREATE INDEX IF NOT EXISTS continuous_reports_cycle_time_idx
  ON research.continuous_research_reports (cycle_id, generated_at_ms DESC);

INSERT INTO research.schema_migrations (version, name)
VALUES (6, 'autonomous quantitative research laboratory')
ON CONFLICT (version) DO NOTHING;

COMMIT;
