# Empirical evidence collection

## Purpose

The evidence workflow turns live, public OKX market data into immutable research
inputs without placing orders. A whale alert remains the event generator. Every
confirmation feature is captured for later analysis and remains disabled in
production.

The repository currently contains no qualifying immutable empirical release.
Legacy summaries cannot substitute for the source events, point-in-time snapshots,
future observations, and hashes required by this workflow. Profitability remains
unproven.

## Lifecycle

Run collection only from a clean, committed checkout. Initialization freezes the
current commit, complete application and alpha configuration, watchlist, feature
registry version, outcome horizons, and acceptance targets. Collection and final
analysis refuse to run from another commit, a dirty worktree, or a changed
configuration.

```powershell
cd "C:\path\to\okx-whale-detector---Copy-main_3"
$EvaluationId = "eval-YYYY-MM-DD-v1"
npm.cmd run evidence:init -- $EvaluationId
npm.cmd run evidence:canary -- $EvaluationId --duration-seconds 600
```

Run the canary a second time with the same ID after its graceful stop. Begin a
long collection with `evidence:collect` only after the canary reports multiple
real events, completed short horizons, clean exact job accounting, and a clean
restart. See [evidence-pipeline-integrity.md](evidence-pipeline-integrity.md).

Inspect health from another terminal:

```powershell
npm.cmd run evidence:progress -- $EvaluationId
npm.cmd run evidence:progress -- $EvaluationId --json
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

Verify an active evaluation at any time. This checks integrity without claiming
that the sample is large enough:

```powershell
npm.cmd run evidence:verify -- $EvaluationId
```

Once `Readiness status: RESEARCH_READY` appears, stop the collector, finalize,
verify the immutable release, and open its pre-registered research report:

```powershell
npm.cmd run evidence:finalize -- $EvaluationId
$ReleaseFingerprint = "<64-character fingerprint printed by finalize>"
npm.cmd run evidence:verify -- $EvaluationId $ReleaseFingerprint
npm.cmd run evidence:research -- "${EvaluationId}:${ReleaseFingerprint}"
```

Finalization never enables a feature. It can produce `COMPLETE`,
`INSUFFICIENT_DATA`, `INCOMPLETE_DATA`, or `NO_EMPIRICAL_DATA`; only `COMPLETE`
means that the configured analysis could run, not that the strategy is profitable.

## Event-time records

Each accepted alert has three independent evidence components:

| Component        | File                      | Contract                                                                                                                                                                                                     |
| ---------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Qualified event  | `qualified-alerts.ndjson` | Evaluation/event identity, instrument type, exchange/source/reference/local timestamps, direction, spread/reference price, source commit, and configuration fingerprint                                      |
| Event-time state | `alpha-snapshots.ndjson`  | Confirmed candles, synchronized bounded book, public trades, whale price/size/notional/distance/lifecycle state, 50 persisted feature values, temporal-integrity proof, and explicit derivatives missingness |
| Future labels    | `outcomes.ndjson`         | Raw and direction-adjusted returns at 5s/15s/30s/1m/3m/5m/15m/30m/60m plus sampled up/down and favorable/adverse excursions and time-to-extrema                                                              |

The event-time snapshot stores both the raw inputs and the complete feature vector.
On every read, features are recomputed with the frozen configuration and compared
with the persisted values. A changed value, registry version, configuration
fingerprint, count, timestamp, or source record is rejected. This makes the stored
feature vector convenient to audit without making it the sole source of truth.

Unavailable data remains explicit. Missing features are `null`; they are never
backfilled from the outcome period. A missing snapshot remains a visible incomplete
observation and is never reconstructed with later market state.

The collector builds a compact path from the nine pre-registered horizon samples.
It persists raw upward/downward excursion separately from alert-direction MFE/MAE,
including sample count and time-to-extrema. This supports coarse entry-delay and
time-exit research without reducing events to WIN/LOSS. It is not tick replay:
intra-sample extrema can be missed and must never be described as continuous-path
MFE/MAE. Legacy unavailable path values remain excluded from finalization.

Funding and open interest are explicitly `null` with missing-data flags. They are
not backfilled later and their absence does not crash collection. Adding them
requires a separately versioned, rate-limited, point-in-time OKX adapter and a new
evaluation version.

## Durability and ordering

- Historical evidence is append-only. Every append requests an OS flush before it
  is acknowledged.
- `pending-observations.json` is operational derived state, written to a temporary
  file with a unique name, flushed, and atomically renamed with bounded Windows
  lock retries. It is always checked against authoritative alerts and outcomes
  after restart.
- `event-initializations.json` journals the complete pre-commit event bundle.
  An event becomes valid only after its alert, one snapshot, and all nine jobs
  exist. Restart replay is payload-idempotent.
- An invalid trailing partial NDJSON line is archived byte-for-byte before it is
  truncated; pending scheduler or event-journal state then replays the write.
- Alert IDs and alert/horizon pairs are unique. Mixed evaluations, mismatched
  instruments, timestamps, prices, direction signs, source commits, or configuration
  fingerprints fail closed.
- NDJSON is streamed with bounded line and record limits. Malformed counts are not
  truncated even though detailed issue retention is bounded.
- Pending alpha contexts are bounded and expire with diagnostics. A missing context
  callback cannot cause unbounded memory growth.
- Outcome jobs use only the horizons frozen in the evaluation manifest.
- Jobs that miss their allowed timestamp window are atomically changed to durable
  `MISSED` state with a reason. Restarts do not retry or silently discard them.
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
- verified event-time timestamp metadata and sampled path excursions;
- no pending or overdue outcome jobs;
- no scheduler coverage gaps, unmatched records, or malformed/inconsistent records.

`evidence:progress` reports `INSUFFICIENT_DATA`, `COLLECTING`, `RESEARCH_READY`, or
`FINALIZED`, plus raw counts, snapshot and outcome completeness, instrument
coverage, feature-value availability, path-excursion availability, overdue work,
side/event-type distribution, byte size, health reasons, active-lease status, and a
SHA-256 fingerprint of the current evidence sources. `--json` is the machine-readable
quality report. An active lease blocks final readiness even when all evidence is
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

`alpha-dataset.json` is deterministically ordered by event time. The bundled alpha
report uses expanding chronological folds, purge based on outcome availability,
embargo, and an untouched final holdout. Rows are never randomly shuffled.

The standalone exploratory command also uses a non-overwriting, fingerprinted path:

```text
data/evaluations/<evaluation-id>/reports/alpha-research-report-<dataset-fingerprint>.json
```

The immutable release is the authoritative artifact for final empirical review.

## Remaining limitations

- The authoritative live collector uses a resilient OKX-only outcome-price source. Its primary label is the midpoint from the already-validated public OKX order-book WebSocket state. If that stream has not produced a post-due quote within a short grace period, a bounded, batched public OKX REST ticker request may supply the midpoint without extending the frozen observation window. Every observation persists its market-data source provenance so fallback-derived labels remain auditable and can be excluded in sensitivity analysis. If neither transport provides a fresh post-due quote in time, the job is still marked `MISSED` and collection fails closed. These midpoint labels are not executable fills.
  The 0.20% round-trip cost remains a fixed research assumption and does not model
  observation-specific spread, depth slippage, latency, partial fills, funding,
  minimum size, leverage, or liquidation.
- Full tick-path MFE/MAE and flexible intrahorizon entry simulation require a
  separately designed bounded raw-path recorder. Current excursions cover only the
  nine standardized samples and are labeled accordingly.
- Alert span and instrument counts do not prove balanced coverage across every
  volatility, liquidity, or trend regime. Fold stability, instrument results, drift,
  and final-holdout diagnostics must be reviewed before any production proposal.
- Evaluation data is ignored by Git. Back it up using an access-controlled,
  append-preserving storage process; do not commit potentially large market evidence
  blindly.

## Windows operating procedure

1. Commit the implementation and confirm `git status --short` prints nothing.
   Initialization and collection intentionally fail on a dirty or different commit.
2. Open VS Code's PowerShell terminal in the repository and run the initialization
   and collection commands above. Leave that terminal open; Windows sleep, network
   loss, or closing the terminal stops collection.
3. Open a second terminal for `evidence:progress` and `evidence:verify`. Watch
   `Malformed records`, `Missing point-in-time metadata`, `Missed observation
windows`, `Overdue observations`, instrument coverage, snapshot completeness,
   outcome completeness, and the readiness state.
4. To restart after a normal stop, press `Ctrl+C`, wait for shutdown, and run the
   exact same collect command from the exact frozen commit. After a crash or reboot,
   run the same command; reconciliation reconstructs missing pending jobs and loads
   completed sampled paths before collection resumes.
5. Do not finalize while collection is running. Finalize only after the progress
   state is `RESEARCH_READY`, then verify and research the printed release ID.
6. Back up the entire `data\evaluations\<evaluation-id>\` directory, including
   `manifest.json`, all NDJSON files, `pending-observations.json`, `lease-history`,
   and `datasets`. Preserve bytes and filenames; do not open-and-save NDJSON in an
   editor that may rewrite line endings.

Problem indicators are any `UNHEALTHY` state, malformed/unmatched/duplicate record,
missing snapshot, missed or overdue window, scheduler gap, fingerprint mismatch,
or unexpectedly absent instrument/side/event-type coverage. Stop and investigate;
do not edit evidence files to make the counters pass.
