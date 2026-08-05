# Empirical evidence collection

## Purpose

The evidence workflow turns live, public OKX market data into immutable research
inputs without placing orders. A whale alert remains the event generator. Every
confirmation feature is captured for later analysis and remains disabled in
production.

The repository currently contains no empirical evaluation directory. The supplied
baseline (344 qualified alerts, 1,581 completed observations, 10.0569% win rate,
-0.1799 USDT net expectancy) cannot be regenerated because its source data and date
range are absent. Profitability remains unproven.

## Lifecycle

Run collection only from a clean, committed checkout. Initialization freezes the
current commit, complete application and alpha configuration, watchlist, feature
registry version, outcome horizons, and acceptance targets. Collection and final
analysis refuse to run from another commit, a dirty worktree, or a changed
configuration.

```bash
npm run evidence:init -- eval-YYYY-MM-DD-v1
npm run evidence:collect -- eval-YYYY-MM-DD-v1
```

Inspect health from another terminal:

```bash
npm run evidence:progress -- eval-YYYY-MM-DD-v1
```

Stop the collector gracefully with `Ctrl+C` before finalization. If the process was
interrupted, restart the same command from the exact frozen commit. Startup
reconciles the append-only alerts and outcomes with the derived pending schedule:
missing jobs are reconstructed and jobs whose outcomes were already appended are
removed. Conflicting, orphaned, duplicate, or malformed state fails closed.

Collection and finalization share an exclusive `evaluation.lock`. This prevents two
collectors from writing the same evaluation and prevents collection from starting
while an immutable release is being copied. A same-host lock is archived under
`lease-history/` only when its recorded process is demonstrably dead. An unreadable,
foreign-host, mismatched, or apparently live lock is never stolen; investigate it
manually rather than deleting it blindly.

Once the readiness gate passes, create an immutable release and run the unchanged
alpha analysis automatically:

```bash
npm run evidence:finalize -- eval-YYYY-MM-DD-v1
npm run evidence:verify -- eval-YYYY-MM-DD-v1 <release-fingerprint>
```

Finalization never enables a feature. It can produce `COMPLETE`,
`INSUFFICIENT_DATA`, `INCOMPLETE_DATA`, or `NO_EMPIRICAL_DATA`; only `COMPLETE`
means that the configured analysis could run, not that the strategy is profitable.

## Event-time records

Each accepted alert has three independent evidence components:

| Component        | File                      | Contract                                                                                                                                  |
| ---------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Qualified event  | `qualified-alerts.ndjson` | Alert identity, direction, contemporaneous spread/reference price, frozen source commit, and configuration fingerprint                    |
| Event-time state | `alpha-snapshots.ndjson`  | Confirmed candles, synchronized uncrossed book, public trades, whale lifecycle state, and all 50 extracted feature values as of the alert |
| Future labels    | `outcomes.ndjson`         | Terminal returns at the frozen 1/5/15/30/60-minute horizons, appended only after each horizon is due                                      |

The event-time snapshot stores both the raw inputs and the complete feature vector.
On every read, features are recomputed with the frozen configuration and compared
with the persisted values. A changed value, registry version, configuration
fingerprint, count, timestamp, or source record is rejected. This makes the stored
feature vector convenient to audit without making it the sole source of truth.

Unavailable data remains explicit. Missing features are `null`; they are never
backfilled from the outcome period. A missing snapshot remains a visible incomplete
observation and is never reconstructed with later market state.

The public ticker sampled at a terminal horizon does not observe the full price path.
Such outcomes set `excursionMeasurement` to `UNAVAILABLE`. Their zero MFE/MAE
placeholders are excluded from excursion and retrospective volatility summaries.
Legacy zero/zero records without measurement provenance normalize to
`LEGACY_UNSPECIFIED` and are also excluded. Terminal return labels remain usable.

## Durability and ordering

- Historical evidence is append-only. Every append requests an OS flush before it
  is acknowledged.
- `pending-observations.json` is operational derived state, written to a temporary
  file and atomically renamed. It is always checked against authoritative alerts and
  outcomes after restart.
- Alert IDs and alert/horizon pairs are unique. Mixed evaluations, mismatched
  instruments, timestamps, prices, direction signs, source commits, or configuration
  fingerprints fail closed.
- NDJSON is streamed with bounded line and record limits. Malformed counts are not
  truncated even though detailed issue retention is bounded.
- Pending alpha contexts are bounded and expire with diagnostics. A missing context
  callback cannot cause unbounded memory growth.
- Outcome jobs use only the horizons frozen in the evaluation manifest.
- Collection acquires the evaluation lease before opening evidence writers and
  releases it only after ingestion stops and queued evidence drains. A failed drain
  deliberately leaves the lease in place for conservative crash recovery.
- Historical files are never edited by the progress, finalization, or verification
  commands.

## Readiness and quality metrics

The default empirical target is:

- at least 1,000 qualified alerts;
- alerts spanning at least 30 UTC calendar days (elapsed time since initialization
  alone does not satisfy this gate);
- at least two observed instruments;
- one valid, non-synthetic event snapshot and persisted feature vector per alert;
- all configured terminal outcomes for every alert;
- no pending or overdue outcome jobs;
- no scheduler coverage gaps, unmatched records, or malformed/inconsistent records.

`evidence:progress` reports raw counts, snapshot and outcome completeness, instrument
coverage, feature-value availability, path-excursion availability, overdue work,
health reasons, active-lease status, and a SHA-256 fingerprint of the current
evidence sources. An active lease blocks final readiness even when all evidence is
complete. A low feature-value availability rate is not automatically corruption: a
feature can be legitimately unavailable because its warm-up history or event-time
source was missing. Missing persisted feature vectors are a readiness failure.

The 30-day gate measures the UTC calendar span between the first and last qualified
alerts. It prevents an idle evaluation directory from satisfying the duration gate,
but it does not prove uninterrupted exchange coverage. Operational outages and
quiet periods must still be reviewed from runtime logs and instrument-level counts.

## Immutable releases

Finalization copies a stable point-in-time view of these exact source files:

- `manifest.json`
- `qualified-alerts.ndjson`
- `alpha-snapshots.ndjson`
- `outcomes.ndjson`
- `pending-observations.json`

Finalization first acquires the same exclusive evaluation lease used by collection.
It hashes the sources before and after copying and refuses a release if evidence
changed during the freeze. It then materializes `alpha-dataset.json`, executes the
existing cost-adjusted alpha research pipeline, writes
`alpha-research-report.json`, and records all hashes in `release-manifest.json`.

The release lives at:

```text
data/evaluations/<evaluation-id>/datasets/<release-fingerprint>/
```

The release fingerprint covers the frozen source fingerprint, semantic dataset
fingerprint, dataset and report file hashes, evaluation configuration, source
commit, research status, and row count. Creation uses exclusive writes and refuses
an existing target. `evidence:verify` recomputes source, dataset, report, quality,
and content-address identities so later corruption is detectable.
Creating a new version never overwrites an earlier version.

The standalone exploratory command also uses a non-overwriting, fingerprinted path:

```text
data/evaluations/<evaluation-id>/reports/alpha-research-report-<dataset-fingerprint>.json
```

The immutable release is the authoritative artifact for final empirical review.

## Remaining limitations

- Public ticker polling supplies terminal midpoint labels, not executable fills.
  The 0.20% round-trip cost remains a fixed research assumption and does not model
  observation-specific spread, depth slippage, latency, partial fills, funding,
  minimum size, leverage, or liquidation.
- Full MFE/MAE requires a separately validated path-sampling design; terminal
  sampling deliberately reports it as unavailable.
- Alert span and instrument counts do not prove balanced coverage across every
  volatility, liquidity, or trend regime. Fold stability, instrument results, drift,
  and final-holdout diagnostics must be reviewed before any production proposal.
- Evaluation data is ignored by Git. Back it up using an access-controlled,
  append-preserving storage process; do not commit potentially large market evidence
  blindly.
