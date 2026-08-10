# Trading System Refactor — Implementation Record

Date: 2026-08-10  
Baseline audit: [Institutional Trading System Audit](institutional-trading-system-audit-2026-08-10.md)  
Scope: measurement integrity, backtest chronology, funding, instrument constraints, paper exit accounting, order-book integrity, tests, and documentation.

## 1. Executive summary

The refactor removes the highest-impact defects that made historical results and paper accounting unsafe to trust:

- confirmed-candle decisions no longer fill on the same candle close;
- funding is no longer inferred from a rate attached to every candle;
- gross PnL is now separated from spread/slippage, fees, and funding;
- backtests require point-in-time instrument constraints and record rejected trades;
- every non-zero paper exit fill is journaled and residual exposure remains open;
- protective paper exits trigger from executable bid/ask rather than midpoint;
- malformed order-book batches and non-advancing sequence IDs invalidate the book atomically;
- versioned datasets receive a SHA-256 fingerprint and deterministic coverage manifest;
- walk-forward planning requires a positive, predeclared label horizon.

The EMA strategy and whale-score parameters were intentionally not optimized. There is no frozen real dataset or labeled outcome sample capable of supporting a strategy change. The completed work makes future measurements more defensible; it does not establish an edge.

**PROFITABILITY IS NOT YET VALIDATED.**

## 2. Original problems

No evidence showed that the previous EMA strategy “performed poorly”: the available paper states contained zero trades, and the small ignored alert file contained no outcomes. The measurable problems were in the evaluation and accounting layer:

- entries were filled at the close that created the signal;
- strategy exits also filled at the same close;
- funding could be charged once per candle instead of once per settlement;
- “gross PnL” already contained adverse spread/slippage while slippage was also reported separately;
- Monte Carlo then subtracted the separately reported slippage again;
- no tick, lot, minimum order, or leverage constraint was required by the platform backtest;
- stop gaps could fill at an unavailable stop price;
- walk-forward labels ended at the observation timestamp;
- a partial paper exit could be economically real in the simulator but absent from the ledger;
- midpoint-based protective triggers could fire before an executable price crossed the level;
- malformed book levels were silently skipped while the sequence advanced;
- live order-book updates did not explicitly reject a duplicate/non-advancing sequence.

These defects could create optimistic or internally inconsistent performance even if the signal itself were unchanged.

## 3. Architecture changes

```text
Versioned dataset document
  ├─ immutable metadata + instrument specification
  ├─ confirmed candles
  └─ timestamped funding settlements
              │
              v
SHA-256 fingerprint + deterministic coverage manifest
              │
              v
confirmed candle decision
              │ pending action
              v
next confirmed candle open
  ├─ adverse spread/slippage
  ├─ adverse tick quantization
  ├─ lot/minimum/leverage normalization
  └─ explicit acceptance or rejection reason
              │
              v
position lifecycle
  ├─ gap-aware, stop-first OHLC protection
  ├─ settlement-event funding
  └─ gross/cost/funding/net attribution
              │
              v
versioned report + CSV + equity curve + extended statistics
```

The paper path remains order-book-driven. It now applies any non-zero reduce-only fill to the ledger, allocates entry fees/funding/risk proportionally, journals the realized leg, and leaves only the residual quantity open. Full-close risk state and notifications occur only after residual exposure reaches zero.

The live public order-book path now validates an entire update before mutation. Any malformed level, timestamp/sequence error, gap, or non-advancing update clears and invalidates the book so it cannot be used for signals.

## 4. Files deleted

- `src/index.backup.ts.txt` — empty tracked backup artifact.
- `src/experimental/WhaleIntelligenceEngine.ts`
- `src/experimental/WhaleDetector.ts`
- `src/experimental/WhaleAnalyzer.ts`
- `src/experimental/WhaleAbsorptionDetector.ts`
- `src/experimental/CandleManager.ts`
- `src/experimental/services/WhaleTracker.ts`
- `src/experimental/market/MarketEngine.ts`

The experimental tree was excluded from compilation and had no imports, symbol consumers, tests, or documentation references outside the baseline/refactor reports. The maintained whale, market, and candle implementations remain under the compiled source tree. Deleted files remain recoverable from Git history.

## 5. Files rewritten or materially modified

- `src/backtest/PlatformBacktestEngine.ts`
  - next-event entry and exit execution;
  - explicit funding settlements;
  - gap-aware exits;
  - correct gross/cost attribution;
  - instrument constraints and rejection records;
  - SHA-256 linkage, schema/execution version, latency, extended statistics;
  - positive walk-forward label horizon.
- `src/tools/runPlatformBacktest.ts`
  - versioned dataset parser;
  - rejects ambiguous candle funding;
  - requires deterministic dataset metadata and instrument specification;
  - writes coverage manifest and input fingerprint.
- `src/paper/PaperAccountLedger.ts`
  - partial reduce-only fills, proportional accounting, residual positions, and `POSITION_REDUCE` audit events.
- `src/platform/TradingPlatformEngine.ts`
  - executable-side exit triggers and partial-exit persistence/logging.
- `src/core/OrderBookManager.ts`
  - batch-level validation, non-advancing sequence rejection, and fail-closed invalidation.
- `docs/trading-platform.md`
  - updated dataset schema, funding, chronology, output, and paper-exit documentation.
- Existing focused tests were expanded for all changed behavior.

## 6. Files added

- `src/backtest/BacktestDatasetManifest.ts`
  - deterministic dataset identity, coverage, gap, interval, and eligibility report.
- `src/backtest/BacktestInstrumentSpecification.ts`
  - validation and adverse tick/lot normalization for historical execution.
- `test/BacktestDatasetManifest.test.ts`
  - complete, missing, and unverified coverage cases.
- `test/BacktestInstrumentSpecification.test.ts`
  - quantity and adverse-price normalization plus instrument identity.
- `test/PlatformBacktestInput.test.ts`
  - versioned settlement parsing and legacy candle-funding rejection.
- `docs/institutional-trading-system-audit-2026-08-10.md`
  - immutable pre-change audit baseline.
- `docs/trading-system-refactor-implementation-2026-08-10.md`
  - this implementation record.

## 7. Strategy changes

### Signal logic

Unchanged. The EMA 20/50, RSI, ATR, trend-alignment, and fresh-crossover benchmark remains versioned as before.

### Entry logic

- A confirmed-candle signal becomes pending.
- It can fill only at the next confirmed candle open.
- The fill receives adverse spread/slippage and tick rounding.
- Quantity is floored to the instrument lot and capped by configured leverage.
- Below-minimum orders are rejected with a structured reason.
- A final-candle signal is rejected as `NO_FUTURE_MARKET_EVENT` rather than filled at an impossible price.

### Exit logic

- Strategy exits execute at the next candle open.
- Stops retain conservative stop-first ordering when stop and target coexist in a bar.
- Positions carried into a gap fill at the adverse gap open rather than the stale stop level.
- Paper stops/targets/trailing/liquidation use bid for long exits and ask for short exits.
- Every non-zero paper exit fill reduces exposure and is persisted.

### Risk logic

- Backtest policy now declares leverage.
- Instrument maximum leverage, lot, minimum base quantity, minimum order value, and tick size are mandatory in versioned CLI datasets.
- Existing paper risk limits remain unchanged.
- Portfolio concentration logic is still not connected to the default paper order gate and remains a P1 item.

### Confidence logic

Unchanged. Existing whale “confidence” remains a heuristic score and must not be interpreted as a calibrated probability. No real labeled outcomes were available to replace it honestly.

### Trade rejection logic

The backtest report now records:

- `NO_FUTURE_MARKET_EVENT`;
- `LEVERAGE_LIMIT`;
- `BELOW_MINIMUM_ORDER_SIZE`;
- `BELOW_MINIMUM_ORDER_VALUE`.

The paper runtime continues to log missing/stale books, risk-manager blocks, rejected fills, and insufficient fill ratios.

## 8. Research results

No old-versus-new profitability comparison was run because no reproducible empirical market dataset exists in the repository.

| Metric                               | Old strategy | Refactored strategy |
| ------------------------------------ | -----------: | ------------------: |
| Real empirical trades                |          N/A |                 N/A |
| Win rate                             |          N/A |                 N/A |
| Average winner / loser               |          N/A |                 N/A |
| Net expectancy                       |          N/A |                 N/A |
| Profit factor                        |          N/A |                 N/A |
| Net PnL                              |          N/A |                 N/A |
| Maximum drawdown                     |          N/A |                 N/A |
| Risk-adjusted return                 |          N/A |                 N/A |
| Long / short contribution            |          N/A |                 N/A |
| Per-symbol / per-regime contribution |          N/A |                 N/A |

Reporting N/A is mandatory: a zero-trade state is not evidence of breakeven performance.

## 9. Validation results

- Build: passed.
- TypeScript backend and dashboard typecheck: passed.
- ESLint: passed.
- Complete Vitest suite: **346 files passed; 1,788 tests passed; 0 failed**.
- Focused chronology/funding/manifest/instrument tests: passed.
- Focused paper ledger/platform/recovery tests: passed.
- Focused order-book and market-engine tests: passed.
- New gap-stop test confirms an existing position fills at the worse gap open.
- New partial-exit tests confirm cash, fees, risk, quantity, fills, and audit events reconcile.

There are no training, validation, holdout, or walk-forward return results because no real dataset was supplied. The walk-forward planner now receives a non-zero outcome horizon, but a full candidate-selection experiment was not fabricated.

## 10. Robustness results

The repository’s existing deterministic Monte Carlo tests continue to pass. Backtest trades now provide pre-cost gross PnL and measured decision-to-entry latency to the Monte Carlo bridge, preventing base slippage from being hidden in gross PnL and then subtracted again.

No new market-performance robustness distribution is reported. Such a distribution requires enough independent real trades and episodes; synthetic fixtures test engineering behavior only.

## 11. Remaining risks

- No frozen, representative real dataset or labeled whale outcomes.
- No empirical signal calibration, ablation, train/validation/untouched-test result, or completed walk-forward run.
- The candle backtester still uses configured bps cost assumptions rather than historical order-book depth and partial fills.
- It remains single-instrument per engine run; portfolio correlation and aggregate margin are not modeled in this path.
- Intrabar OHLC paths remain ambiguous despite conservative stop-first and gap rules.
- Instrument specification history must be collected point in time; current metadata must not be retroactively applied.
- The default paper engine does not yet use the separate professional portfolio-risk gateway.
- Whale thresholds and external-correlation weights remain uncalibrated.
- Paper trade analytics treat each realized partial exit leg as a journal trade record; lifecycle-level aggregation should be added if partial exits become a strategy feature.
- Dashboard authentication/network hardening, notification timeouts, development dependency advisories, and duplicate legacy modules remain open.
- Docker runtime and local PostgreSQL migrations were not executed because the local daemon/CLI were unavailable during the audit.

## 12. Commands run

Important commands included:

```text
npm.cmd ci --prefer-offline --no-audit --no-fund
npm.cmd run build
npm.cmd run typecheck
npm.cmd run lint
npm.cmd test -- --run <focused suites>
npm.cmd test -- --reporter=dot
npm audit --omit=dev --json
npm audit --json
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.prod.yml config --quiet
node_modules\.bin\prettier.cmd --write <changed files>
git diff --check
```

The backtest CLI was not run against real data because no qualifying dataset document was available.

## 13. Repository status

| Capability              | Status                                                             |
| ----------------------- | ------------------------------------------------------------------ |
| Build                   | PASS                                                               |
| Tests                   | PASS — 1,788/1,788                                                 |
| Lint                    | PASS                                                               |
| TypeScript              | PASS                                                               |
| Dataset parser/manifest | PASS in deterministic tests                                        |
| Research pipeline       | Engineering modules pass; no empirical release available           |
| Paper trading           | Accounting/execution tests pass; no prolonged forward trade sample |
| Live trading            | Disabled; no private-order implementation was enabled              |

## 14. Next highest-value improvements

1. Collect and freeze point-in-time candles, book/trade events, funding settlements, and instrument-spec history with manifests for at least the documented duration/instrument gate.
2. Replace candle bps fills with a chronological market-event replay that delegates to the same depth/partial-fill simulator used by paper execution.
3. Integrate true outcome/trade intervals into candidate walk-forward evaluation and reserve one untouched holdout.
4. Connect one canonical portfolio-risk gateway to the paper order path.
5. Build lifecycle-level partial-exit aggregation and reconciliation reports.
6. Run preregistered whale-event direction, volatility, and tradability studies with matched controls; calibrate or rename confidence only after held-out evidence.

No strategy should be promoted, and no live-order path should be added, until those evidence gates pass.
