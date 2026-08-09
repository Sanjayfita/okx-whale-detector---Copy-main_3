BEGIN;

CREATE SCHEMA IF NOT EXISTS research;

CREATE TABLE IF NOT EXISTS research.schema_migrations (
  version integer PRIMARY KEY,
  name text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS research.instruments (
  instrument_id text PRIMARY KEY,
  instrument_type text NOT NULL CHECK (instrument_type IN ('SWAP', 'FUTURES')),
  base_currency text NOT NULL,
  quote_currency text NOT NULL,
  settlement_currency text NOT NULL,
  contract_value numeric(38, 18) NOT NULL CHECK (contract_value > 0),
  contract_value_currency text NOT NULL,
  tick_size numeric(38, 18) NOT NULL CHECK (tick_size > 0),
  lot_size numeric(38, 18) NOT NULL CHECK (lot_size > 0),
  minimum_contracts numeric(38, 18) NOT NULL CHECK (minimum_contracts > 0),
  maximum_leverage numeric(20, 8),
  listing_time_ms bigint,
  expiry_time_ms bigint,
  metadata_observed_at_ms bigint NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS research.market_trades (
  instrument_id text NOT NULL REFERENCES research.instruments(instrument_id),
  observed_at_ms bigint NOT NULL,
  received_at_ms bigint NOT NULL,
  trade_id text NOT NULL,
  taker_side text NOT NULL CHECK (taker_side IN ('BUY', 'SELL')),
  price numeric(38, 18) NOT NULL CHECK (price > 0),
  contracts numeric(38, 18) NOT NULL CHECK (contracts > 0),
  source text NOT NULL,
  PRIMARY KEY (instrument_id, observed_at_ms, trade_id)
) PARTITION BY RANGE (observed_at_ms);

CREATE TABLE IF NOT EXISTS research.market_trades_default
  PARTITION OF research.market_trades DEFAULT;
CREATE INDEX IF NOT EXISTS market_trades_time_idx
  ON research.market_trades (observed_at_ms DESC);
CREATE INDEX IF NOT EXISTS market_trades_instrument_time_idx
  ON research.market_trades (instrument_id, observed_at_ms DESC);

CREATE TABLE IF NOT EXISTS research.order_book_snapshots (
  instrument_id text NOT NULL REFERENCES research.instruments(instrument_id),
  observed_at_ms bigint NOT NULL,
  received_at_ms bigint NOT NULL,
  sequence_id bigint NOT NULL DEFAULT -1,
  best_bid numeric(38, 18) NOT NULL CHECK (best_bid > 0),
  best_ask numeric(38, 18) NOT NULL CHECK (best_ask > best_bid),
  depth_per_side integer NOT NULL CHECK (depth_per_side > 0),
  checksum text,
  source text NOT NULL,
  PRIMARY KEY (instrument_id, observed_at_ms, sequence_id)
) PARTITION BY RANGE (observed_at_ms);

CREATE TABLE IF NOT EXISTS research.order_book_snapshots_default
  PARTITION OF research.order_book_snapshots DEFAULT;
CREATE INDEX IF NOT EXISTS order_book_snapshots_instrument_time_idx
  ON research.order_book_snapshots (instrument_id, observed_at_ms DESC);

CREATE TABLE IF NOT EXISTS research.order_book_levels (
  instrument_id text NOT NULL,
  observed_at_ms bigint NOT NULL,
  sequence_id bigint NOT NULL DEFAULT -1,
  side text NOT NULL CHECK (side IN ('BID', 'ASK')),
  level_index integer NOT NULL CHECK (level_index >= 0),
  price numeric(38, 18) NOT NULL CHECK (price > 0),
  contracts numeric(38, 18) NOT NULL CHECK (contracts >= 0),
  order_count integer,
  PRIMARY KEY (
    instrument_id,
    observed_at_ms,
    sequence_id,
    side,
    level_index
  )
) PARTITION BY RANGE (observed_at_ms);

CREATE TABLE IF NOT EXISTS research.order_book_levels_default
  PARTITION OF research.order_book_levels DEFAULT;
CREATE INDEX IF NOT EXISTS order_book_levels_lookup_idx
  ON research.order_book_levels (
    instrument_id,
    observed_at_ms DESC,
    sequence_id,
    side,
    level_index
  );

CREATE TABLE IF NOT EXISTS research.candles (
  instrument_id text NOT NULL REFERENCES research.instruments(instrument_id),
  observed_at_ms bigint NOT NULL,
  received_at_ms bigint NOT NULL,
  interval_ms bigint NOT NULL CHECK (interval_ms > 0),
  open numeric(38, 18) NOT NULL CHECK (open > 0),
  high numeric(38, 18) NOT NULL CHECK (high > 0),
  low numeric(38, 18) NOT NULL CHECK (low > 0),
  close numeric(38, 18) NOT NULL CHECK (close > 0),
  contract_volume numeric(38, 18) NOT NULL CHECK (contract_volume >= 0),
  base_volume numeric(38, 18),
  quote_volume numeric(38, 18),
  confirmed boolean NOT NULL,
  source text NOT NULL,
  PRIMARY KEY (instrument_id, observed_at_ms, interval_ms)
) PARTITION BY RANGE (observed_at_ms);

CREATE TABLE IF NOT EXISTS research.candles_default
  PARTITION OF research.candles DEFAULT;
CREATE INDEX IF NOT EXISTS candles_lookup_idx
  ON research.candles (instrument_id, interval_ms, observed_at_ms DESC);

CREATE TABLE IF NOT EXISTS research.open_interest (
  instrument_id text NOT NULL REFERENCES research.instruments(instrument_id),
  observed_at_ms bigint NOT NULL,
  received_at_ms bigint NOT NULL,
  contracts numeric(38, 18) NOT NULL CHECK (contracts >= 0),
  base_currency_amount numeric(38, 18),
  quote_currency_amount numeric(38, 18),
  source text NOT NULL,
  PRIMARY KEY (instrument_id, observed_at_ms)
) PARTITION BY RANGE (observed_at_ms);

CREATE TABLE IF NOT EXISTS research.open_interest_default
  PARTITION OF research.open_interest DEFAULT;
CREATE INDEX IF NOT EXISTS open_interest_lookup_idx
  ON research.open_interest (instrument_id, observed_at_ms DESC);

CREATE TABLE IF NOT EXISTS research.funding_rates (
  instrument_id text NOT NULL REFERENCES research.instruments(instrument_id),
  observed_at_ms bigint NOT NULL,
  received_at_ms bigint NOT NULL,
  funding_time_ms bigint NOT NULL,
  funding_rate numeric(30, 18) NOT NULL,
  realized_rate numeric(30, 18),
  source text NOT NULL,
  PRIMARY KEY (instrument_id, funding_time_ms)
) PARTITION BY RANGE (funding_time_ms);

CREATE TABLE IF NOT EXISTS research.funding_rates_default
  PARTITION OF research.funding_rates DEFAULT;
CREATE INDEX IF NOT EXISTS funding_rates_lookup_idx
  ON research.funding_rates (instrument_id, funding_time_ms DESC);

CREATE TABLE IF NOT EXISTS research.liquidation_events (
  instrument_id text NOT NULL REFERENCES research.instruments(instrument_id),
  observed_at_ms bigint NOT NULL,
  received_at_ms bigint NOT NULL,
  liquidation_side text NOT NULL
    CHECK (liquidation_side IN ('LONG_LIQUIDATED', 'SHORT_LIQUIDATED')),
  price numeric(38, 18) NOT NULL CHECK (price > 0),
  contracts numeric(38, 18) NOT NULL CHECK (contracts > 0),
  source text NOT NULL,
  event_hash text NOT NULL,
  PRIMARY KEY (instrument_id, observed_at_ms, event_hash)
) PARTITION BY RANGE (observed_at_ms);

CREATE TABLE IF NOT EXISTS research.liquidation_events_default
  PARTITION OF research.liquidation_events DEFAULT;
CREATE INDEX IF NOT EXISTS liquidation_events_lookup_idx
  ON research.liquidation_events (instrument_id, observed_at_ms DESC);

CREATE TABLE IF NOT EXISTS research.mark_index_prices (
  instrument_id text NOT NULL REFERENCES research.instruments(instrument_id),
  observed_at_ms bigint NOT NULL,
  received_at_ms bigint NOT NULL,
  mark_price numeric(38, 18) NOT NULL CHECK (mark_price > 0),
  index_price numeric(38, 18) NOT NULL CHECK (index_price > 0),
  basis_bps numeric(20, 8) GENERATED ALWAYS AS (
    ((mark_price - index_price) / index_price) * 10000
  ) STORED,
  source text NOT NULL,
  PRIMARY KEY (instrument_id, observed_at_ms)
) PARTITION BY RANGE (observed_at_ms);

CREATE TABLE IF NOT EXISTS research.mark_index_prices_default
  PARTITION OF research.mark_index_prices DEFAULT;
CREATE INDEX IF NOT EXISTS mark_index_prices_lookup_idx
  ON research.mark_index_prices (instrument_id, observed_at_ms DESC);

CREATE TABLE IF NOT EXISTS research.best_quotes (
  instrument_id text NOT NULL REFERENCES research.instruments(instrument_id),
  observed_at_ms bigint NOT NULL,
  received_at_ms bigint NOT NULL,
  best_bid numeric(38, 18) NOT NULL CHECK (best_bid > 0),
  best_ask numeric(38, 18) NOT NULL CHECK (best_ask > best_bid),
  bid_contracts numeric(38, 18),
  ask_contracts numeric(38, 18),
  spread_bps numeric(20, 8) GENERATED ALWAYS AS (
    ((best_ask - best_bid) / ((best_ask + best_bid) / 2)) * 10000
  ) STORED,
  source text NOT NULL,
  PRIMARY KEY (instrument_id, observed_at_ms)
) PARTITION BY RANGE (observed_at_ms);

CREATE TABLE IF NOT EXISTS research.best_quotes_default
  PARTITION OF research.best_quotes DEFAULT;
CREATE INDEX IF NOT EXISTS best_quotes_lookup_idx
  ON research.best_quotes (instrument_id, observed_at_ms DESC);

CREATE TABLE IF NOT EXISTS research.feature_sets (
  feature_set_id uuid PRIMARY KEY,
  name text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  definition_hash text NOT NULL,
  documentation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS research.features (
  feature_set_id uuid NOT NULL REFERENCES research.feature_sets(feature_set_id),
  instrument_id text NOT NULL REFERENCES research.instruments(instrument_id),
  observed_at_ms bigint NOT NULL,
  feature_name text NOT NULL,
  feature_value double precision NOT NULL,
  source_max_observed_at_ms bigint NOT NULL,
  calculation_version integer NOT NULL,
  PRIMARY KEY (feature_set_id, instrument_id, observed_at_ms, feature_name)
) PARTITION BY RANGE (observed_at_ms);

CREATE TABLE IF NOT EXISTS research.features_default
  PARTITION OF research.features DEFAULT;
CREATE INDEX IF NOT EXISTS features_lookup_idx
  ON research.features (
    feature_set_id,
    instrument_id,
    observed_at_ms DESC,
    feature_name
  );

CREATE TABLE IF NOT EXISTS research.strategy_definitions (
  strategy_id uuid PRIMARY KEY,
  name text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  implementation_hash text NOT NULL,
  parameter_schema jsonb NOT NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS research.signals (
  signal_id uuid PRIMARY KEY,
  strategy_id uuid NOT NULL REFERENCES research.strategy_definitions(strategy_id),
  instrument_id text NOT NULL REFERENCES research.instruments(instrument_id),
  observed_at_ms bigint NOT NULL,
  direction text NOT NULL CHECK (direction IN ('LONG', 'SHORT', 'FLAT')),
  score double precision NOT NULL,
  parameters jsonb NOT NULL,
  feature_values jsonb NOT NULL,
  episode_id text NOT NULL,
  live_execution_allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signals_strategy_time_idx
  ON research.signals (strategy_id, observed_at_ms DESC);
CREATE INDEX IF NOT EXISTS signals_instrument_time_idx
  ON research.signals (instrument_id, observed_at_ms DESC);
CREATE INDEX IF NOT EXISTS signals_episode_idx
  ON research.signals (episode_id);

CREATE TABLE IF NOT EXISTS research.backtests (
  backtest_id uuid PRIMARY KEY,
  strategy_id uuid NOT NULL REFERENCES research.strategy_definitions(strategy_id),
  dataset_id text NOT NULL,
  code_commit text NOT NULL,
  configuration_hash text NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  status text NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'REJECTED', 'FAILED')),
  training_range int8range,
  test_range int8range,
  untouched_holdout boolean NOT NULL DEFAULT false,
  metrics jsonb,
  rejection_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS backtests_strategy_created_idx
  ON research.backtests (strategy_id, created_at DESC);
CREATE INDEX IF NOT EXISTS backtests_dataset_idx
  ON research.backtests (dataset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS research.walk_forward_runs (
  walk_forward_run_id uuid PRIMARY KEY,
  strategy_id uuid NOT NULL REFERENCES research.strategy_definitions(strategy_id),
  dataset_id text NOT NULL,
  code_commit text NOT NULL,
  configuration jsonb NOT NULL,
  purge_ms bigint NOT NULL CHECK (purge_ms >= 0),
  embargo_ms bigint NOT NULL CHECK (embargo_ms >= 0),
  holdout_range int8range NOT NULL,
  status text NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'REJECTED', 'FAILED')),
  aggregate_metrics jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS research.walk_forward_folds (
  walk_forward_run_id uuid NOT NULL
    REFERENCES research.walk_forward_runs(walk_forward_run_id) ON DELETE CASCADE,
  fold_index integer NOT NULL CHECK (fold_index >= 0),
  train_range int8range NOT NULL,
  test_range int8range NOT NULL,
  selected_parameters jsonb NOT NULL,
  train_metrics jsonb,
  test_metrics jsonb,
  status text NOT NULL CHECK (status IN ('PLANNED', 'COMPLETED', 'REJECTED', 'FAILED')),
  PRIMARY KEY (walk_forward_run_id, fold_index)
);

CREATE TABLE IF NOT EXISTS research.hyperparameter_experiments (
  experiment_id uuid PRIMARY KEY,
  strategy_id uuid NOT NULL REFERENCES research.strategy_definitions(strategy_id),
  dataset_id text NOT NULL,
  code_commit text NOT NULL,
  search_space jsonb NOT NULL,
  optimizer text NOT NULL,
  objective_definition jsonb NOT NULL,
  seed bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'REJECTED', 'FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS research.hyperparameter_trials (
  experiment_id uuid NOT NULL
    REFERENCES research.hyperparameter_experiments(experiment_id) ON DELETE CASCADE,
  trial_index integer NOT NULL CHECK (trial_index >= 0),
  parameters jsonb NOT NULL,
  fold_metrics jsonb NOT NULL,
  objective_value double precision,
  overfit_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('COMPLETED', 'REJECTED', 'FAILED')),
  PRIMARY KEY (experiment_id, trial_index)
);

CREATE TABLE IF NOT EXISTS research.orders (
  order_id uuid PRIMARY KEY,
  backtest_id uuid REFERENCES research.backtests(backtest_id),
  signal_id uuid REFERENCES research.signals(signal_id),
  instrument_id text NOT NULL REFERENCES research.instruments(instrument_id),
  submitted_at_ms bigint NOT NULL,
  side text NOT NULL CHECK (side IN ('BUY', 'SELL')),
  order_type text NOT NULL,
  requested_contracts numeric(38, 18) NOT NULL CHECK (requested_contracts > 0),
  limit_price numeric(38, 18),
  status text NOT NULL,
  rejection_reason text,
  latency_ms bigint NOT NULL DEFAULT 0,
  raw_context jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS orders_instrument_time_idx
  ON research.orders (instrument_id, submitted_at_ms DESC);

CREATE TABLE IF NOT EXISTS research.trades (
  fill_id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES research.orders(order_id),
  instrument_id text NOT NULL REFERENCES research.instruments(instrument_id),
  filled_at_ms bigint NOT NULL,
  price numeric(38, 18) NOT NULL CHECK (price > 0),
  contracts numeric(38, 18) NOT NULL CHECK (contracts > 0),
  fee numeric(38, 18) NOT NULL,
  funding numeric(38, 18) NOT NULL DEFAULT 0,
  slippage_bps numeric(20, 8) NOT NULL,
  liquidity_role text NOT NULL CHECK (liquidity_role IN ('MAKER', 'TAKER'))
);
CREATE INDEX IF NOT EXISTS trades_order_idx ON research.trades (order_id);
CREATE INDEX IF NOT EXISTS trades_instrument_time_idx
  ON research.trades (instrument_id, filled_at_ms DESC);

CREATE TABLE IF NOT EXISTS research.risk_events (
  risk_event_id uuid PRIMARY KEY,
  observed_at_ms bigint NOT NULL,
  instrument_id text REFERENCES research.instruments(instrument_id),
  event_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'BLOCKING', 'CRITICAL')),
  reason text NOT NULL,
  account_equity numeric(38, 18),
  portfolio_exposure numeric(38, 18),
  context jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS risk_events_time_idx
  ON research.risk_events (observed_at_ms DESC);
CREATE INDEX IF NOT EXISTS risk_events_type_time_idx
  ON research.risk_events (event_type, observed_at_ms DESC);

INSERT INTO research.schema_migrations (version, name)
VALUES (1, 'research platform core schema')
ON CONFLICT (version) DO NOTHING;

COMMIT;
