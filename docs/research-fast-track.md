# Research Fast-Track

This project has two deliberately separated evidence paths:

- **Historical replay:** `data/historical-research/<run-id>`
- **Live forward validation:** `data/evaluations/<evaluation-id>`

Historical records are never copied into a live evaluation and cannot satisfy a live 30-day forward-validation requirement.

## 1. Historical OKX L2 virtual-time replay

### Data contract

Use downloaded/extracted high-resolution OKX L2/order-book history. The replay accepts recursively discovered:

- `.ndjson`, `.jsonl`, `.json` where **each line is one JSON record/envelope**
- `.csv`
- gzip variants of the above (`.gz`)

A JSON/NDJSON record may use the raw OKX books envelope shape (`arg`, `action`, `data`) or an explicit flat record. Every usable update must provide:

- instrument id
- `snapshot` or `update`
- complete explicit bid/ask level arrays for that update
- source timestamp
- `seqId`
- `prevSeqId`

CSV input must contain explicit JSON-encoded `asks` and `bids` columns. The replay **refuses** to reconstruct L2 from only best bid/ask or other lower-quality substitutes. Extract ZIP archives first. A monolithic multi-record JSON array is intentionally not accepted because 30/90/180-day replay is designed as a streaming workflow rather than a full-file memory load.

### Historical instrument metadata

Supply a JSON array containing the contract metadata that applied to the historical period:

```json
[
  {
    "instId": "BTC-USDT-SWAP",
    "instType": "SWAP",
    "quoteCurrency": "USDT",
    "baseUnitsPerSize": 0.01
  }
]
```

`baseUnitsPerSize` must come from the relevant historical contract specification. Do not guess it and do not use current metadata silently when historical metadata is uncertain.

### Optional funding companion

Funding is never inferred from L2. To calculate funding-adjusted expectancy, provide an explicit CSV/NDJSON/JSONL companion with:

- `instId` (or `instrumentId`)
- `fundingTime` (or `timestamp`) in UTC epoch milliseconds
- `fundingRate` as a decimal (for example `0.0001` = 1 bp)

If no companion is supplied, funding-adjusted metrics are reported as unavailable rather than filled with zero.

### Run

One-click Windows launcher:

```text
scripts\windows\RUN-HISTORICAL-L2-REPLAY.cmd
```

Or command line:

```cmd
npm.cmd run historical:l2:replay -- --input "D:\okx-l2\2026-07" --instruments "D:\okx-l2\historical-instruments.json" --funding "D:\okx-l2\funding.csv" --fees-bps 5 --slippage-bps 2
```

The replay:

1. requires a clean committed source tree;
2. SHA-256 fingerprints all source files (and funding companion if supplied);
3. k-way merges many archive files deterministically;
4. advances `ReplayClock` to source timestamps without real sleeping;
5. sends each L2 update through the same `MarketEngine`, whale detector, OKX-only correlated-alert engine, point-in-time evidence admission, scheduler and outcome collector used by live evidence;
6. records source/sequence gaps explicitly;
7. quarantines incomplete episodes rather than fabricating outcomes;
8. writes `historical-replay-summary.json`.

The summary includes standardized 5s, 15s, 30s, 1m, 3m, 5m, 15m, 30m and 60m outcomes when the source range supports them; continuation/reversal; MFE/MAE from the existing standardized outcome path; costs; optional funding-adjusted expectancy; cross-instrument results; entry-delay analysis; stop/target feasibility; time exits; chronological walk-forward thirds; and availability of EMA/volatility/market-structure context derived strictly from completed historical L2 midpoint minutes.

Historical L2 alone does not provide trade volume, funding, or historical trade-flow. Those fields are reported unavailable unless explicit companion data supports them. Spoof/absorption/trade-flow features are never fabricated.

## 2. Quarantine-and-continue live evidence

Live collection is **strict within an episode and tolerant across the month**.

When a required observation cannot be captured within the frozen observation delay:

1. the affected alert is appended to `quarantined-episodes.ndjson`;
2. the exact interruption is appended to `coverage-gaps.ndjson`;
3. all remaining pending horizons for that episode are removed from accepted scheduling;
4. no price is invented or backfilled;
5. unrelated future episodes continue collecting.

Accepted research rows exclude quarantined alert ids. Raw qualified alerts remain auditable. Progress reports separately expose total alerts, valid episodes, quarantined episodes, coverage-gap count/duration, missingness rate and affected time ranges.

Structural failures (malformed journals, conflicting duplicate records, broken configuration/source identity, etc.) remain fail-closed and may still mark collection unhealthy. Quarantine is only for unavailable/incomplete market evidence, not for corruption.

## 3. One-click 30-day live forward validation

Start once:

```text
scripts\windows\START-30-DAY-EVIDENCE.cmd
```

The launcher stores the active evaluation id in:

```text
data\forward-validation\active-30-day.json
```

and always resumes that same evaluation. The persistent `collector-checkpoint.json` fixes the original start and target end timestamps, records session numbers and heartbeats, and allows downtime to be reconstructed after restart.

While the supervisor is open it requests Windows system-awake state using `SetThreadExecutionState`; it does not modify the user's permanent power-plan settings. Logs are written to:

```text
%USERPROFILE%\Desktop\okx-30-day-evidence-logs
```

The child collector:

- heartbeats every minute;
- prints progress every five minutes;
- records unexpected and intentional downtime;
- resumes existing pending jobs without resetting the 30-day target;
- uses a stable per-evaluation alert session id and resumes the persisted alert sequence so process restarts do not reset alert identifiers;
- retains append/idempotency and scheduler reconciliation protections against duplicate records;
- records recovered market-data gaps;
- quarantines an episode if any required horizon is irrecoverably unavailable;
- closes admissions at the fixed day-30 boundary and explicitly quarantines horizons that cannot complete inside the collection period.

Optional reboot/logon resume:

```text
scripts\windows\ENABLE-30-DAY-REBOOT-RESUME.cmd
```

Remove that scheduled task when no longer wanted:

```text
scripts\windows\DISABLE-30-DAY-REBOOT-RESUME.cmd
```

Reboot recovery is best effort: Windows must reach user logon and the repository/data volume/network must be available. Any downtime remains explicit evidence and is never synthesized away.

### Progress

```cmd
npm.cmd run evidence:progress -- <evaluation-id>
```

or machine-readable:

```cmd
npm.cmd run evidence:progress -- <evaluation-id> --json
```

The report distinguishes valid evidence from quarantined evidence and unavailable periods.

## Release/research rule

Do not edit strategy/evidence configuration during the official 30-day evaluation. Historical replay may be used for discovery, but the live forward dataset remains untouched. At finalization, only non-quarantined complete episodes are accepted for research; quarantine/gap files are included in the source fingerprint so missingness cannot be hidden.
