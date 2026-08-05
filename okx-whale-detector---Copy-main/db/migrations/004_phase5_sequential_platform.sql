BEGIN;

CREATE TABLE IF NOT EXISTS research.continuous_collection_checkpoints (
  source_id text PRIMARY KEY,
  instrument_id text NOT NULL REFERENCES research.instruments(instrument_id),
  cursor_value text,
  last_observed_at_ms bigint,
  last_sequence_id bigint,
  updated_at_ms bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS continuous_collection_checkpoint_instrument_idx
  ON research.continuous_collection_checkpoints (instrument_id, updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS research.continuous_collection_manifests (
  manifest_id uuid PRIMARY KEY,
  source_id text NOT NULL,
  instrument_id text NOT NULL REFERENCES research.instruments(instrument_id),
  cycle_started_at_ms bigint NOT NULL,
  cycle_completed_at_ms bigint NOT NULL,
  range_start_ms bigint,
  range_end_ms bigint,
  record_count bigint NOT NULL CHECK (record_count >= 0),
  recovered_record_count bigint NOT NULL CHECK (recovered_record_count >= 0),
  dataset_fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('PERSISTED', 'REJECTED')),
  rejection_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  live_execution_allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS continuous_collection_manifest_source_time_idx
  ON research.continuous_collection_manifests (source_id, cycle_completed_at_ms DESC);
CREATE INDEX IF NOT EXISTS continuous_collection_manifest_fingerprint_idx
  ON research.continuous_collection_manifests (dataset_fingerprint);

CREATE TABLE IF NOT EXISTS research.regime_decisions (
  regime_decision_id uuid PRIMARY KEY,
  instrument_id text NOT NULL REFERENCES research.instruments(instrument_id),
  observed_at_ms bigint NOT NULL,
  directional_regime text NOT NULL,
  overlays jsonb NOT NULL,
  confidence double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  active_strategy_families jsonb NOT NULL,
  blocked_strategy_families jsonb NOT NULL,
  evidence jsonb NOT NULL,
  explanations jsonb NOT NULL,
  code_commit text NOT NULL,
  configuration_hash text NOT NULL,
  dataset_fingerprint text NOT NULL,
  live_execution_allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS regime_decisions_instrument_time_idx
  ON research.regime_decisions (instrument_id, observed_at_ms DESC);
CREATE INDEX IF NOT EXISTS regime_decisions_direction_time_idx
  ON research.regime_decisions (directional_regime, observed_at_ms DESC);

CREATE TABLE IF NOT EXISTS research.ai_research_runs (
  ai_run_id uuid PRIMARY KEY,
  run_key text NOT NULL UNIQUE,
  model_id text NOT NULL,
  model_version text NOT NULL,
  research_role text NOT NULL,
  dataset_fingerprint text NOT NULL,
  code_commit text NOT NULL,
  configuration_hash text NOT NULL,
  seed bigint NOT NULL,
  deterministic boolean NOT NULL,
  direct_signal_output boolean NOT NULL DEFAULT false,
  artifact_fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACCEPTED_FOR_RESEARCH', 'REJECTED')),
  rejection_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  live_execution_allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_research_runs_dataset_idx
  ON research.ai_research_runs (dataset_fingerprint, created_at DESC);

CREATE TABLE IF NOT EXISTS research.ai_feature_decisions (
  ai_run_id uuid NOT NULL REFERENCES research.ai_research_runs(ai_run_id) ON DELETE CASCADE,
  feature_name text NOT NULL,
  median_score double precision NOT NULL,
  positive_fold_fraction double precision NOT NULL,
  median_rank double precision NOT NULL,
  rank_standard_deviation double precision NOT NULL,
  status text NOT NULL CHECK (status IN ('ABLATION_SUPPORTED', 'AI_PRIOR_ONLY', 'REJECTED')),
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (ai_run_id, feature_name)
);

CREATE TABLE IF NOT EXISTS research.portfolio_gateway_decisions (
  portfolio_decision_id uuid PRIMARY KEY,
  observed_at_ms bigint NOT NULL,
  account_equity numeric(38, 18) NOT NULL,
  peak_equity numeric(38, 18) NOT NULL,
  allocation_mode text NOT NULL,
  dynamic_maximum_leverage double precision NOT NULL,
  status text NOT NULL CHECK (status IN ('APPROVED_FOR_PAPER_RESEARCH', 'REJECTED')),
  proposal_decisions jsonb NOT NULL,
  portfolio_decision jsonb NOT NULL,
  rejection_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  code_commit text NOT NULL,
  configuration_hash text NOT NULL,
  live_execution_allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS portfolio_gateway_decisions_time_idx
  ON research.portfolio_gateway_decisions (observed_at_ms DESC);

CREATE TABLE IF NOT EXISTS research.advanced_order_flow_vectors (
  instrument_id text NOT NULL REFERENCES research.instruments(instrument_id),
  observed_at_ms bigint NOT NULL,
  feature_set_id text NOT NULL,
  vector jsonb NOT NULL,
  spoofing_status text NOT NULL,
  hidden_liquidity_status text NOT NULL,
  source_max_observed_at_ms bigint NOT NULL,
  calculation_version integer NOT NULL,
  direct_trading_signal_allowed boolean NOT NULL DEFAULT false,
  live_execution_allowed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (instrument_id, observed_at_ms, feature_set_id)
);
CREATE INDEX IF NOT EXISTS advanced_order_flow_vectors_time_idx
  ON research.advanced_order_flow_vectors (instrument_id, observed_at_ms DESC);

CREATE TABLE IF NOT EXISTS research.timeframe_hierarchy_decisions (
  timeframe_decision_id uuid PRIMARY KEY,
  instrument_id text NOT NULL REFERENCES research.instruments(instrument_id),
  observed_at_ms bigint NOT NULL,
  macro_bias text NOT NULL,
  setup_direction text NOT NULL,
  entry_direction text NOT NULL,
  alignment_score double precision NOT NULL,
  entry_allowed boolean NOT NULL,
  precision_confirmed boolean NOT NULL,
  active_contexts jsonb NOT NULL,
  rejection_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  explanations jsonb NOT NULL,
  configuration_hash text NOT NULL,
  live_execution_allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS timeframe_hierarchy_instrument_time_idx
  ON research.timeframe_hierarchy_decisions (instrument_id, observed_at_ms DESC);

CREATE TABLE IF NOT EXISTS research.scheduled_risk_events (
  event_id text PRIMARY KEY,
  title text NOT NULL,
  category text NOT NULL,
  scheduled_at_ms bigint NOT NULL,
  published_at_ms bigint NOT NULL,
  source_id text NOT NULL,
  source_reliability text NOT NULL,
  severity text NOT NULL,
  scope jsonb NOT NULL,
  cancelled boolean NOT NULL DEFAULT false,
  raw_event jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scheduled_risk_events_time_idx
  ON research.scheduled_risk_events (scheduled_at_ms);
CREATE INDEX IF NOT EXISTS scheduled_risk_events_category_time_idx
  ON research.scheduled_risk_events (category, scheduled_at_ms);

CREATE TABLE IF NOT EXISTS research.event_risk_decisions (
  event_risk_decision_id uuid PRIMARY KEY,
  instrument_id text NOT NULL REFERENCES research.instruments(instrument_id),
  observed_at_ms bigint NOT NULL,
  blocked boolean NOT NULL,
  active_blackouts jsonb NOT NULL,
  ignored_events jsonb NOT NULL,
  explanations jsonb NOT NULL,
  configuration_hash text NOT NULL,
  live_execution_allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_risk_decisions_instrument_time_idx
  ON research.event_risk_decisions (instrument_id, observed_at_ms DESC);

CREATE TABLE IF NOT EXISTS research.trade_explanations (
  explanation_id text PRIMARY KEY,
  trade_id text NOT NULL,
  signal_id text NOT NULL,
  strategy_key text NOT NULL,
  instrument_id text NOT NULL REFERENCES research.instruments(instrument_id),
  generated_at_ms bigint NOT NULL,
  decision_status text NOT NULL CHECK (decision_status IN ('APPROVED', 'BLOCKED', 'EXITED')),
  entry_score double precision NOT NULL,
  exit_score double precision,
  calculation_fingerprint text NOT NULL,
  machine_readable jsonb NOT NULL,
  human_readable text NOT NULL,
  code_commit text NOT NULL,
  configuration_hash text NOT NULL,
  dataset_fingerprint text NOT NULL,
  live_execution_allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trade_explanations_trade_idx
  ON research.trade_explanations (trade_id);
CREATE INDEX IF NOT EXISTS trade_explanations_strategy_time_idx
  ON research.trade_explanations (strategy_key, generated_at_ms DESC);

CREATE TABLE IF NOT EXISTS research.execution_monte_carlo_runs (
  monte_carlo_run_id uuid PRIMARY KEY,
  strategy_key text NOT NULL,
  dataset_fingerprint text NOT NULL,
  code_commit text NOT NULL,
  configuration_hash text NOT NULL,
  iterations integer NOT NULL CHECK (iterations >= 100),
  trade_count integer NOT NULL CHECK (trade_count > 0),
  independent_episode_count integer NOT NULL CHECK (independent_episode_count > 0),
  policy jsonb NOT NULL,
  report jsonb NOT NULL,
  probability_of_ruin double precision NOT NULL,
  probability_of_positive_return double precision NOT NULL,
  live_execution_allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS execution_monte_carlo_strategy_idx
  ON research.execution_monte_carlo_runs (strategy_key, created_at DESC);

CREATE TABLE IF NOT EXISTS research.bayesian_optimization_runs (
  bayesian_run_id uuid PRIMARY KEY,
  strategy_key text NOT NULL,
  dataset_fingerprint text,
  code_commit text NOT NULL,
  configuration_hash text NOT NULL,
  optimizer text NOT NULL,
  parameter_space jsonb NOT NULL,
  policy jsonb NOT NULL,
  stable_neighbor_fraction double precision NOT NULL,
  status text NOT NULL CHECK (status IN ('COMPLETED', 'REJECTED')),
  rejection_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  holdout_evaluated boolean NOT NULL DEFAULT false,
  live_execution_allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bayesian_optimization_strategy_idx
  ON research.bayesian_optimization_runs (strategy_key, created_at DESC);

CREATE TABLE IF NOT EXISTS research.bayesian_optimization_trials (
  bayesian_run_id uuid NOT NULL REFERENCES research.bayesian_optimization_runs(bayesian_run_id) ON DELETE CASCADE,
  trial_index integer NOT NULL CHECK (trial_index >= 0),
  parameters jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('COMPLETED', 'REJECTED', 'FAILED')),
  objective_value double precision,
  predicted_mean double precision,
  predicted_uncertainty double precision,
  acquisition_value double precision,
  evaluation jsonb,
  rejection_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (bayesian_run_id, trial_index)
);

CREATE TABLE IF NOT EXISTS research.shadow_trade_records (
  shadow_record_id uuid PRIMARY KEY,
  signal_id text NOT NULL UNIQUE,
  strategy_key text NOT NULL,
  instrument_id text NOT NULL REFERENCES research.instruments(instrument_id),
  signal_observed_at_ms bigint NOT NULL,
  processed_at_ms bigint NOT NULL,
  book_observed_at_ms bigint NOT NULL,
  direction text NOT NULL CHECK (direction IN ('LONG', 'SHORT')),
  requested_contracts numeric(38, 18) NOT NULL,
  fill_status text NOT NULL,
  fill jsonb NOT NULL,
  paper_reference jsonb,
  shadow_vs_paper_price_bps double precision,
  explanation_fingerprint text NOT NULL,
  live_order_submitted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shadow_trade_strategy_time_idx
  ON research.shadow_trade_records (strategy_key, processed_at_ms DESC);
CREATE INDEX IF NOT EXISTS shadow_trade_instrument_time_idx
  ON research.shadow_trade_records (instrument_id, processed_at_ms DESC);

CREATE TABLE IF NOT EXISTS research.shadow_outcomes (
  shadow_record_id uuid NOT NULL REFERENCES research.shadow_trade_records(shadow_record_id) ON DELETE CASCADE,
  observed_at_ms bigint NOT NULL,
  mark_price numeric(38, 18) NOT NULL,
  return_bps double precision NOT NULL,
  PRIMARY KEY (shadow_record_id, observed_at_ms)
);

CREATE TABLE IF NOT EXISTS research.shadow_daily_reports (
  shadow_report_id uuid PRIMARY KEY,
  day_start_ms bigint NOT NULL,
  day_end_ms bigint NOT NULL,
  strategy_key text,
  report jsonb NOT NULL,
  signal_count integer NOT NULL,
  filled_count integer NOT NULL,
  partial_fill_count integer NOT NULL,
  rejected_count integer NOT NULL,
  missed_opportunity_count integer NOT NULL,
  live_order_submitted boolean NOT NULL DEFAULT false,
  live_execution_allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (day_start_ms, day_end_ms, strategy_key)
);
CREATE INDEX IF NOT EXISTS shadow_daily_reports_time_idx
  ON research.shadow_daily_reports (day_start_ms DESC);

INSERT INTO research.schema_migrations (version, name)
VALUES (4, 'phase 5 sequential quantitative research platform')
ON CONFLICT (version) DO NOTHING;

COMMIT;
