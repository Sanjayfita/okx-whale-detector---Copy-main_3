BEGIN;

CREATE TABLE IF NOT EXISTS research.feature_selection_runs (
  feature_selection_run_id uuid PRIMARY KEY,
  strategy_key text NOT NULL,
  dataset_id text NOT NULL,
  dataset_fingerprint text NOT NULL,
  code_commit text NOT NULL,
  configuration_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('SELECTION_PASSED', 'REJECTED')),
  policy jsonb NOT NULL,
  selected_features jsonb NOT NULL,
  rejection_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feature_selection_strategy_created_idx
  ON research.feature_selection_runs (strategy_key, created_at DESC);
CREATE INDEX IF NOT EXISTS feature_selection_dataset_idx
  ON research.feature_selection_runs (dataset_fingerprint, created_at DESC);

CREATE TABLE IF NOT EXISTS research.feature_selection_results (
  feature_selection_run_id uuid NOT NULL
    REFERENCES research.feature_selection_runs(feature_selection_run_id)
    ON DELETE CASCADE,
  feature_name text NOT NULL,
  feature_role text NOT NULL CHECK (
    feature_role IN ('ALPHA', 'REGIME', 'RISK_FILTER', 'EXECUTION_FILTER')
  ),
  status text NOT NULL CHECK (status IN ('RETAINED', 'REJECTED')),
  median_importance double precision,
  positive_importance_fraction double precision,
  importance_coefficient_of_variation double precision,
  selection_score double precision,
  documented_purpose text NOT NULL,
  rationale jsonb NOT NULL DEFAULT '[]'::jsonb,
  rejection_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (feature_selection_run_id, feature_name)
);

CREATE TABLE IF NOT EXISTS research.robustness_validation_runs (
  robustness_validation_id uuid PRIMARY KEY,
  strategy_key text NOT NULL,
  dataset_fingerprint text,
  code_commit text NOT NULL,
  configuration_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('ROBUSTNESS_PASSED', 'REJECTED')),
  scenario_count integer NOT NULL CHECK (scenario_count >= 0),
  positive_regime_fraction double precision NOT NULL CHECK (
    positive_regime_fraction >= 0 AND positive_regime_fraction <= 1
  ),
  total_baseline_trades integer NOT NULL CHECK (total_baseline_trades >= 0),
  minimum_stress_expectancy double precision,
  maximum_drawdown_percent double precision,
  policy jsonb NOT NULL,
  rejection_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS robustness_strategy_created_idx
  ON research.robustness_validation_runs (strategy_key, created_at DESC);
CREATE INDEX IF NOT EXISTS robustness_dataset_created_idx
  ON research.robustness_validation_runs (
    dataset_fingerprint,
    created_at DESC
  );

CREATE TABLE IF NOT EXISTS research.robustness_scenarios (
  robustness_validation_id uuid NOT NULL
    REFERENCES research.robustness_validation_runs(robustness_validation_id)
    ON DELETE CASCADE,
  scenario_id text NOT NULL,
  regime text NOT NULL CHECK (
    regime IN (
      'BULL_TREND',
      'BEAR_TREND',
      'SIDEWAYS',
      'HIGH_VOLATILITY',
      'LOW_VOLATILITY'
    )
  ),
  scenario_kind text NOT NULL CHECK (
    scenario_kind IN (
      'BASELINE',
      'HIGH_FEES',
      'HIGH_SLIPPAGE',
      'HIGH_FUNDING',
      'COMBINED_ADVERSE'
    )
  ),
  source_kind text NOT NULL CHECK (
    source_kind IN ('REAL_MARKET', 'SYNTHETIC', 'MIXED')
  ),
  independent_episode_count integer NOT NULL CHECK (
    independent_episode_count > 0
  ),
  assumptions jsonb NOT NULL,
  metrics jsonb NOT NULL,
  PRIMARY KEY (robustness_validation_id, scenario_id),
  UNIQUE (robustness_validation_id, regime, scenario_kind)
);

CREATE TABLE IF NOT EXISTS research.paper_trading_release_runs (
  paper_run_id uuid PRIMARY KEY,
  strategy_key text NOT NULL,
  source_kind text NOT NULL CHECK (
    source_kind IN ('LIVE_MARKET', 'HISTORICAL_REPLAY', 'SYNTHETIC')
  ),
  code_commit text NOT NULL,
  configuration_hash text NOT NULL,
  started_at_ms bigint NOT NULL,
  ended_at_ms bigint NOT NULL CHECK (ended_at_ms > started_at_ms),
  order_intent_count integer NOT NULL CHECK (order_intent_count >= 0),
  trade_count integer NOT NULL CHECK (trade_count >= 0),
  data_gap_count integer NOT NULL CHECK (data_gap_count >= 0),
  duplicate_fill_count integer NOT NULL CHECK (duplicate_fill_count >= 0),
  reconciliation_error_rate double precision NOT NULL CHECK (
    reconciliation_error_rate >= 0
  ),
  metrics jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS paper_release_strategy_created_idx
  ON research.paper_trading_release_runs (strategy_key, created_at DESC);

CREATE TABLE IF NOT EXISTS research.release_candidate_evaluations (
  release_evaluation_id uuid PRIMARY KEY,
  strategy_key text NOT NULL,
  strategy_version text NOT NULL,
  code_commit text NOT NULL,
  configuration_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('RELEASE_CANDIDATE', 'BLOCKED')),
  ready_for_review boolean NOT NULL,
  merge_allowed boolean NOT NULL,
  tag_allowed boolean NOT NULL,
  suggested_tag text,
  evidence jsonb NOT NULL,
  rejection_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT merge_allowed OR status = 'RELEASE_CANDIDATE'),
  CHECK (NOT tag_allowed OR status = 'RELEASE_CANDIDATE'),
  CHECK (NOT ready_for_review OR status = 'RELEASE_CANDIDATE')
);
CREATE INDEX IF NOT EXISTS release_candidate_strategy_evaluated_idx
  ON research.release_candidate_evaluations (
    strategy_key,
    evaluated_at DESC
  );
CREATE INDEX IF NOT EXISTS release_candidate_status_evaluated_idx
  ON research.release_candidate_evaluations (status, evaluated_at DESC);

INSERT INTO research.schema_migrations (version, name)
VALUES (3, 'phase 4 validation and release evidence')
ON CONFLICT (version) DO NOTHING;

COMMIT;
