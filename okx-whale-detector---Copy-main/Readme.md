# OKX Whale Detector

A TypeScript research tool that watches selected OKX spot order books and reports large visible liquidity.

## Important limitation

The detector produces heuristic research signals. A wall can be cancelled, moved, spoofed, or filled. Output is not a guarantee of future price direction and must not be treated as a probability of profit.

## Requirements

- Node.js 24
- npm

## Install

```bash
npm ci
```

## Verify

```bash
npm run check
```

## Development

```bash
npm run dev
```

## Production build

```bash
npm run build
npm start
```

## Watched symbols

Edit `src/config/symbols.ts`.

## Project structure

- `src/clients/okx`: OKX WebSocket boundary
- `src/core`: order-book and detector logic
- `src/market`: per-symbol orchestration
- `src/research`: frozen evidence, feature extraction, labels, and statistical analysis
- `src/tools`: offline and operational command entrypoints
- `src/types`: shared TypeScript types
- `test`: automated regression tests
- `docs`: research methodology and architecture

## Data-integrity rules

- Detector output is allowed only after a full snapshot.
- Every incremental update must pass sequence-continuity checks.
- On a gap or reconnect, local market state is reset and a new snapshot is required.
- Signal generation pauses while either side of the book is empty or while the
  best bid is greater than or equal to the best ask. OKX can publish crossed
  books during pre-open periods, but those books are not valid signal inputs.
- Exchange timestamps must be non-negative integer milliseconds and incremental
  order-book timestamps cannot move backwards.
- Public and candle WebSockets send a heartbeat after 20 seconds. A connection
  that does not return any message before the next heartbeat is terminated and
  reconnected, after which subscriptions are restored.
- Linear swap contract size is converted with `ctVal * ctMult` in the contract
  value currency before quote notional is calculated. This changes whale and
  trade-flow notionals for any instrument whose `ctMult` is not `1`.

## Evidence and statistical evaluation

The evidence commands are research-only and never authorize order execution:

```bash
npm run evidence:init -- <evaluation-id>
npm run evidence:collect -- <evaluation-id>
npm run evidence:progress -- <evaluation-id>
npm run evidence:finalize -- <evaluation-id>
npm run evidence:verify -- <evaluation-id> <release-fingerprint>
npm run evidence:profitability -- <evaluation-id>
npm run evidence:statistics -- <evaluation-id>
npm run alpha:research -- <evaluation-id>
```

Whale-conditioned alpha research now records versioned event-time snapshots and
evaluates 50 configurable confirmation candidates with purged walk-forward folds,
episode-cluster bootstrap intervals, permutation importance, mutual information,
information coefficient, linear-model SHAP contributions, multiple-testing
correction, conditional-uplift tests, partial dependence, calibration, drift,
Bayesian-bootstrap sensitivity, Monte Carlo diagnostics, interactions, and a final
chronological holdout. Reports contain canonical configuration and dataset
fingerprints. All confirmation features remain disabled in production. See
[`docs/alpha-research.md`](docs/alpha-research.md) for feature definitions,
configuration defaults, commands, statistical gates, and limitations, and
[`docs/research-platform.md`](docs/research-platform.md) for architecture and
extension rules. See
[`docs/evidence-collection.md`](docs/evidence-collection.md) for collection,
resumption, quality gates, immutable releases, and verification.

The default profitability policy uses a 0.20% round-trip cost and a 100 USDT
hypothetical position. The persisted evidence reader rejects malformed schemas,
duplicate alert IDs, duplicate alert/horizon outcomes, mixed evaluation IDs,
mismatched instruments or timestamps, inconsistent prices and returns, crossed
entry spreads, and incorrect long/short return signs. Rejected records are
reported and block statistical qualification.

Progress is ready for final evaluation only after at least 1,000 alerts span 30 UTC
calendar days and two instruments, every accepted alert has a validated event-time
snapshot with persisted reproducible feature values and all configured horizon
outcomes, no pending jobs remain, and no unmatched or malformed records were found.
Elapsed time since initialization alone does not satisfy the duration gate.
Collection and finalization use one exclusive, crash-recoverable evaluation lease,
so concurrent writers and collection during immutable release creation fail closed.

Live outcome prices retain the OKX exchange timestamp. Tickers older than 10
seconds, more than 5 seconds ahead of the local clock, or captured more than 10
seconds after a requested horizon are rejected; the horizon remains pending
rather than being mislabeled with a later price.

Statistical sample requirements are counted by independent alert, not by the
number of overlapping holding-horizon observations. Bootstrap input first
averages the available horizons for each alert, and chronological partitions
purge labels whose observation windows cross a later split boundary. The report
still shows the total matched outcome count separately.

Research NDJSON is streamed with bounded line, record, and diagnostic limits. Alpha
contexts are paired by alert ID on a bounded pending map, and a snapshot is blocked
when its authoritative qualified-alert write fails. Pending contexts expire after a
configurable age (60 seconds by default), so a missing callback cannot permanently
saturate the bounded map.

### Frozen strategy baseline

The current supplied baseline is negative after the stated cost assumption:

- Qualified alerts: 344
- Completed observations: 1,581
- Win rate: 10.0569%
- Net expectancy: -0.1799 USDT per observation
- Hypothetical net PnL: -284.4494 USDT
- Bootstrap lower bound: -0.2069%
- Purged test mean: -0.2425%
- Round-trip cost: 0.20%

The repository does not include the underlying evidence dataset or its date
range, so these figures cannot be regenerated from a clean checkout. Synthetic
simulation output is useful for regression testing only and is not evidence of
profitability. The strategy remains statistically negative on the supplied
baseline and profitability is unproven.

## Known research limitations

- The primary detector measures displayed liquidity. Displayed walls can be
  cancelled or spoofed and are not directional evidence by themselves.
- The main evidence cost is a fixed round-trip percentage. It does not yet
  estimate spread, latency, depth-dependent slippage, partial fills, funding,
  tick size, minimum size, leverage, or liquidation risk per observation.
- Live terminal ticker collection explicitly marks MFE/MAE as unavailable. Those
  placeholders are excluded from path and volatility-regime summaries; richer path
  sampling is still required before those analyses are defensible.
- The legacy report's MFE/MAE regime is explicitly retrospective outcome-path
  volatility and is unavailable at decision time.
- Continuous-return calibration is implemented; no classifier or calibrated win
  probability is currently claimed.
- EMA, structure, liquidity, order-flow, volatility, volume, momentum, session,
  and whale-lifecycle fields are implemented only as research features. None is
  a production trigger or filter, and synthetic rankings cannot promote one.
- A positive synthetic fixture or in-sample parameter result must never be
  described as profitable performance.

## Compatibility notes

- Spot sizing and swaps with `ctMult = 1` are unchanged.
- Invalid or internally inconsistent historical evidence that was previously
  accepted by the report generators is now counted as malformed and excluded.
- Qualified evidence is directional; `NEUTRAL` records are rejected because
  they do not define a long or short outcome sign.
- Trade-flow timestamps may arrive up to five seconds ahead of the local clock,
  but future-dated trades are not used until their exchange timestamp is reached.
- The bounded live candle buffer increased from 100 to 1,200 observations to
  support the configured slow EMA on the default 5x aggregate. The detector's
  existing signal rules are unchanged.
- Public trades are retained for up to 60 seconds for event-time alpha snapshots;
  the behavior classifier still uses its existing 5-second lookback.
- Importing `src/index.ts` no longer starts network clients. `npm run dev` and
  `npm start` continue to execute the entrypoint normally.

## Security

This project currently uses public market data and does not require an OKX API key. Do not add withdrawal-capable credentials.
