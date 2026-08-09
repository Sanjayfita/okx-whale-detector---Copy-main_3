BEGIN;

CREATE TABLE IF NOT EXISTS research.market_volumes (
  instrument_id text NOT NULL REFERENCES research.instruments(instrument_id),
  observed_at_ms bigint NOT NULL,
  received_at_ms bigint NOT NULL,
  window_ms bigint NOT NULL CHECK (window_ms > 0),
  contract_volume numeric(38, 18) NOT NULL CHECK (contract_volume >= 0),
  base_volume numeric(38, 18),
  quote_volume numeric(38, 18),
  source text NOT NULL,
  PRIMARY KEY (instrument_id, observed_at_ms, window_ms)
) PARTITION BY RANGE (observed_at_ms);

CREATE TABLE IF NOT EXISTS research.market_volumes_default
  PARTITION OF research.market_volumes DEFAULT;
CREATE INDEX IF NOT EXISTS market_volumes_lookup_idx
  ON research.market_volumes (instrument_id, window_ms, observed_at_ms DESC);

CREATE OR REPLACE FUNCTION research.month_partition_name(
  parent_table text,
  month_start date
) RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT format('%s_%s', parent_table, to_char(month_start, 'YYYYMM'));
$$;

CREATE OR REPLACE PROCEDURE research.ensure_month_partition(
  parent_table regclass,
  timestamp_column text,
  month_start date
)
LANGUAGE plpgsql
AS $$
DECLARE
  month_end date := (month_start + interval '1 month')::date;
  lower_ms bigint := floor(extract(epoch FROM month_start::timestamptz) * 1000);
  upper_ms bigint := floor(extract(epoch FROM month_end::timestamptz) * 1000);
  child_name text := research.month_partition_name(
    split_part(parent_table::text, '.', 2),
    month_start
  );
BEGIN
  IF timestamp_column NOT IN ('observed_at_ms', 'funding_time_ms') THEN
    RAISE EXCEPTION 'Unsupported partition column %', timestamp_column;
  END IF;

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS research.%I PARTITION OF %s FOR VALUES FROM (%s) TO (%s)',
    child_name,
    parent_table,
    lower_ms,
    upper_ms
  );
END;
$$;

INSERT INTO research.schema_migrations (version, name)
VALUES (2, 'market volumes and monthly partition maintenance')
ON CONFLICT (version) DO NOTHING;

COMMIT;
