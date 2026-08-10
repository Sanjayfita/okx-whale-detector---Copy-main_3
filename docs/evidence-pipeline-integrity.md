# Evidence pipeline integrity operations

`eval-2026-08-10-v1` is **INVALID DIAGNOSTIC EVIDENCE**. Do not finalize it,
use it for research, or modify its persisted evidence. It records the production
failures that motivated this integrity protocol.

## Admission transaction

The evaluation manifest is the only instrument authority after initialization.
Runtime discovery is filtered to that frozen set, and every candidate is checked
again at admission. A valid admitted event is committed only after the durable
event journal, qualified-alert record, all nine deterministic horizon jobs, and
one point-in-time feature snapshot exist.

For each committed event and each frozen horizon, exactly one state must exist:

`PENDING | COMPLETED | MISSED`

Therefore:

`admitted events * 9 = pending + completed + missed`

Duplicates are rejected or treated as an idempotent retry only when their full
payload is identical. An interrupted transaction remains in
`event-initializations.json` and is replayed on startup. A trailing partial
NDJSON write is either newline-completed when valid or preserved byte-for-byte
in `partial-write-recoveries.ndjson` before truncation and state replay.

## Fail-closed behavior

Unexpected instruments, unavailable point-in-time snapshots, conflicting IDs,
incomplete job bundles, persistence failures, and startup reconciliation errors
are written to `evidence-failures.ndjson`. `collection-health.json` becomes
`UNHEALTHY`, new admissions stop, and the collection coordinator shuts down.
An unhealthy evaluation cannot be resumed as if it were clean.

## Operator workflow

Use an ordinary literal ID or an expanded PowerShell variable. Values such as
the literal `$EvaluationId`, traversal, unsafe filesystem characters, a dirty
worktree, a wrong source commit, a concurrent collector, a finalized evaluation,
or a manifest mismatch fail before collection.

```powershell
npm.cmd run evidence:init -- eval-YYYY-MM-DD-canary-vN
npm.cmd run evidence:canary -- eval-YYYY-MM-DD-canary-vN --duration-seconds 600
npm.cmd run evidence:progress -- eval-YYYY-MM-DD-canary-vN
npm.cmd run evidence:verify -- eval-YYYY-MM-DD-canary-vN
```

Run the canary again with the same ID after a graceful stop to prove restart
reconciliation. A clean canary requires real admitted events, exact snapshot and
job accounting, completed short horizons, and zero malformed/schema-invalid
records, unexpected instruments, duplicates, orphans, scheduler gaps, missed or
overdue windows, and critical failures. It never finalizes a research dataset or
starts the 30-day collection.

Graceful shutdown first stops market/event ingestion, continues due-observation
polling for one 10-second tolerance window, and only then clears the scheduler
timer and releases the evaluation lease. This leaves a verification/restart
window without converting near-due jobs into avoidable overdue observations.
Collection and canary npm commands start through `tsx` and do not run a blocking
build before acquiring the evaluation lease; build/typecheck are preflight gates,
not part of a time-sensitive scheduler restart.

Progress reports show invalid JSON and schema defects separately, explicit
missing optional derivative values separately from feature calculation failures,
and observation latency (minimum, mean, p50, p95, and maximum). Missing funding
or open-interest values represented by the schema are unavailable data, not
corruption; point-in-time integrity and required feature calculation failures
remain fatal quality conditions.
