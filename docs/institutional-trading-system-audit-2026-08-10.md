# Institutional Trading System Audit

Date: 2026-08-10  
Repository: `okx-whale-detector---Copy-main_3`  
Branch reviewed: `agent/trading-platform-foundation`  
Baseline commit: `312d621` (`perf(dashboard): materialize snapshots only on bounded broadcasts`)  
Scope: repository architecture, market-data integrity, backtesting, signal construction, execution, risk, research validity, security, operations, and release readiness.

## A. Executive summary

### Decision

The system is **not ready for a profitability claim, capital allocation, testnet execution, or live execution**.

The repository contains a broad and often thoughtful research/safety foundation: strict TypeScript, extensive tests, deterministic simulations, order-book sequence handling, immutable-evidence concepts, paper accounting, explicit release states, and execution disabled by default. Those controls are valuable. They do not substitute for empirical evidence, however, and several core research and execution paths are not wired together in the running application.

No reproducible historical candle/order-book dataset, finalized evidence release, or labeled whale-event outcome dataset was present. The current tracked paper state and a locally ignored legacy paper state contain zero trades. A locally ignored alert file contains only 19 alerts, all from one instrument over approximately 7.46 hours, with no outcomes. Consequently, every requested profitability statistic is **not estimable** rather than zero.

The primary strategy in the running paper platform is an EMA 20/50 crossover with RSI, ATR, stop, target, and trailing-stop rules. Whale detection is a separate heuristic telemetry path. There is no evidence that either predicts direction, volatility, or net returns after costs.

The most serious implementation findings are:

1. The platform backtester enters at the close of the same candle that generated the signal, creating an execution-timing/look-ahead risk.
2. Funding is charged whenever a candle carries a funding rate instead of only on explicit funding settlement events.
3. Backtests use fixed spread/slippage adjustments while paper execution uses depth-walking and partial fills; instrument constraints, latency, liquidation, and portfolio effects are not consistently modeled.
4. Walk-forward metadata uses the candle timestamp as the label end and is not an integrated candidate-selection pipeline, so it does not purge the actual trade/outcome horizon.
5. A partially filled paper exit is discarded unless the full requested exit is filled. This makes the ledger diverge from real exposure and fees.
6. The advertised continuous collection → immutable store → features → purged validation → release-gate path exists mostly as modules and simulations, not as a single operational runtime.

These are blockers to trusting performance measurements. No parameter tuning or strategy optimization should occur until they are corrected and a frozen, point-in-time dataset is collected.

### Empirical baseline

| Item                                                                      |     Observed result | Interpretation                                                    |
| ------------------------------------------------------------------------- | ------------------: | ----------------------------------------------------------------- |
| Reproducible historical market datasets in repository                     |                   0 | No valid backtest baseline can be reproduced from a clean clone.  |
| Finalized evidence releases available locally                             |                   0 | No immutable research result was available for audit.             |
| Current tracked paper trades / fills                                      |               0 / 0 | No realized strategy sample.                                      |
| Current tracked paper equity observations                                 |              10,305 | Balance remained at 10,000 throughout.                            |
| Ignored legacy paper trades / fills                                       |               0 / 0 | No realized strategy sample.                                      |
| Ignored legacy paper equity observations                                  |              15,646 | Balance remained unchanged.                                       |
| Locally ignored correlated alerts                                         |                  19 | Exploratory only; absent from a clean clone.                      |
| Alert window                                                              |          7.46 hours | Too short for regime or dependence analysis.                      |
| Alert instruments                                                         | 1 (`BTC-USDT-SWAP`) | No cross-instrument evidence.                                     |
| Alert outcomes                                                            |                   0 | Precision, expectancy, calibration, and decay cannot be computed. |
| Net return, profit factor, Sharpe, Sortino, drawdown, win/loss statistics |                 N/A | Missing trades and outcomes; reporting zero would be misleading.  |

The 19 legacy alerts were all OKX/Polymarket “agreement” events: 14 bearish and 5 bullish, with mean displayed confidence about 68.91. These confidence values are deterministic heuristic scores, not calibrated probabilities. The legacy file also represents a different population from the current OKX-only evidence workflow, so it must not be mixed into a formal baseline without an explicit population/version field.

### Direct answers to the audit questions

| Question                                                   | Finding                                                                                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Are whale events predictive of direction?                  | Unknown; no labeled outcomes.                                                                                                                                                  |
| Are whale events predictive of volatility?                 | Unknown; no labeled paths or matched controls.                                                                                                                                 |
| Which event types, horizons, regimes, or instruments work? | Unknown. The available 19 events cover one instrument and less than one day.                                                                                                   |
| Is the EMA strategy profitable after costs?                | Unknown; zero observed paper trades and no reproducible historical run.                                                                                                        |
| Are entries and exits justified empirically?               | No. They are sensible heuristics but have not been validated.                                                                                                                  |
| Is “confidence” calibrated?                                | No. It is a rule-based score.                                                                                                                                                  |
| Are backtest results currently trustworthy?                | No, because of same-close entry, funding-event ambiguity, execution-model mismatch, and incomplete purging.                                                                    |
| Is the system overfit?                                     | It cannot yet be measured. The current candidate-comparison path permits selection on the same data and therefore creates substantial overfitting risk.                        |
| Can costs destroy the apparent edge?                       | Yes. A base-tier taker round trip is already about 10 bps in fees before spread, slippage, latency, and funding. No measured edge is available to compare against that hurdle. |
| Is live trading safe?                                      | Live order placement is absent/disabled, which is appropriate. The surrounding system is not ready to authorize it.                                                            |

## B. Architecture and end-to-end data flow

The repository has two principal runtime paths and a larger set of research libraries.

### Lean paper-trading runtime

```text
OKX REST candle history ─┐
                        ├─> confirmed candle history ─> EMA/RSI/ATR evaluator
OKX candle WebSocket ───┘                                  │
OKX order-book stream ─> sequence-checked execution book   │
                                                           v
                                               TradingRiskManager
                                                           │
                                                           v
                                               ExecutionSimulator
                                         (depth, fees, latency, partial fill)
                                                           │
                                                           v
                                               PaperAccountLedger
                                                           │
                                      JSON state + dashboard + notifications
```

This is the default path created by `startTradingPlatform`. `WITH_RESEARCH_RUNTIME` is false by default. The strategy registry currently selects the EMA trend-crossover strategy. The path is paper-only; it contains no OKX private-order client.

### Optional whale/research runtime

```text
OKX instrument discovery + public WebSockets
                 │
       order books / trades / candles
                 │
                 v
       MarketEngine + MarketState
          │              │
          │              └─> recorder queue / market recordings
          v
 trade-flow and whale detectors
          │
          v
 heuristic MarketSignal
          │
          ├─> optional Polymarket signal
          v
 ExternalSignalCorrelationEngine
          │
          v
 alert JSONL / evaluation and evidence CLIs
```

This path can feed platform observations, but it does not replace the primary EMA decision engine. Its “confidence” combines fixed detector rules and hard-coded correlation weights. It should be treated as research telemetry.

### Modules that are not a production data pipeline

The repository also contains `ContinuousDerivativesCollector`, PostgreSQL research stores, feature extraction, alpha analysis, purged-walk-forward utilities, Monte Carlo tools, release/evidence builders, portfolio engines, and professional risk components. They are extensively tested or exercised through simulations, but important parts are not instantiated by the default runtime:

- `ContinuousDerivativesCollector` is not wired into a source runtime.
- PostgreSQL research stores are constructed in tests; the paper application persists JSON and does not consume the research database as its source of truth.
- `FeaturePipeline` is not consumed by the running strategy.
- Candidate ranking, purged validation, evidence release, and runtime promotion are separate workflows rather than one enforced chain.
- Advanced portfolio and professional-risk modules do not gate orders in the default paper engine.

Therefore, architecture diagrams describing a complete institutional research pipeline are aspirational. The operational system is a smaller paper strategy plus an optional research/alert runtime.

## C. Defects and risk register

### P0 — blocks valid evidence or corrupts execution accounting

| Finding                                                 | Evidence and impact                                                                                                                                                                                           | Required disposition                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| No reproducible empirical dataset or finalized evidence | Backtest/evidence CLIs require external inputs; none were present. Paper states contain no trades.                                                                                                            | Freeze and fingerprint a representative market dataset before any tuning or promotion.                                    |
| Same-candle-close entry                                 | `PlatformBacktestEngine` updates indicators with a confirmed candle and fills a new position at that candle’s close. A live order cannot reliably fill at a price known only after the candle closes.         | Execute on the next eligible quote/bar after configurable decision and transport latency.                                 |
| Funding charged per populated candle                    | The backtester applies `fundingRatePercent` on each candle containing it. OKX funding is settled at explicit timestamps, normally every eight hours but sometimes every one, two, or four hours.              | Represent funding as timestamped settlement events and charge only positions held at the settlement timestamp.            |
| Backtest/paper execution mismatch                       | Backtest fills are fixed bps adjustments; paper fills walk order-book depth and can be partial. Contract value, tick/lot size, minimums, leverage tiers, and realistic liquidation are not uniformly modeled. | Use a shared execution/instrument model for both paths and expose all assumptions in the report.                          |
| Incomplete purging and selection controls               | Walk-forward rows set label end equal to candle time, not the eventual position/outcome horizon. Candidate comparison can run many candidates against the same dataset.                                       | Build folds from true information and label intervals, embargo adjacent samples, and reserve an untouched final test set. |
| Partial paper exits are discarded                       | If an exit cannot fill the entire requested quantity, the simulator reports real partial execution but `TradingPlatformEngine` leaves the ledger position unchanged.                                          | Apply every non-zero exit fill to quantity, cash, fees, P&L, and residual exposure.                                       |

### P1 — high risk to signal quality, safety, or research validity

| Finding                                                                      | Impact                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Research architecture is not operationally connected                         | Data collection, immutable storage, feature generation, validation, release, and runtime selection can drift or be bypassed.                                                                                           |
| Whale thresholds are fixed in quote notional                                 | A fixed 500,000-quote threshold is not normalized for symbol liquidity, depth, volatility, or contract structure. It creates inconsistent event meaning across instruments and regimes.                                |
| Confidence is uncalibrated                                                   | Fixed OKX/external weights, agreement bonus, and contradiction penalty create a presentation score, not an empirical probability.                                                                                      |
| Live order-book updates may advance state after malformed levels are skipped | Silently omitting invalid levels while accepting the sequence can leave an incomplete book that appears current. An invalid update should quarantine/resynchronize the book.                                           |
| Live sequence handling does not explicitly reject non-advancing `seqId`      | The live manager validates `prevSeqId` but does not consistently enforce or classify a non-advancing `seqId`; the evaluation reconstructor is stricter. The discrepancy needs an explicit protocol rule and tests.     |
| Protective exits are triggered from midpoint                                 | A long sell stop should be evaluated using an executable bid and a short buy stop using an executable ask. Midpoint triggers can be optimistic or delayed.                                                             |
| Portfolio concentration controls are disconnected                            | Default paper orders are not gated by sector/correlation clusters, gross notional, directional concentration, aggregate margin, or funding exposure. Three individually valid positions can form one concentrated bet. |
| Event-population mismatch                                                    | Legacy alerts require external agreement while current evidence simulations emphasize OKX-only signals. Results are incomparable without versioned population definitions.                                             |

### P2 — material engineering and operational debt

- Metrics are fragmented across `PerformanceAnalytics`, `BacktestStatistics`, and report builders with different edge-case semantics.
- The primary report omits several institutional metrics: median winner/loser, breakevens, gross versus net expectancy, Sortino, Calmar, average drawdown, recovery duration, loss/win streaks, exposure, turnover, long/short contribution, instrument contribution, and regime contribution.
- The dashboard application has no authentication, TLS termination, or CSRF protection. Production compose binds it to loopback, but the application default is `0.0.0.0`; accidental network exposure would allow unauthenticated settings changes and kill-switch actions.
- Notification HTTP calls have no explicit timeout/abort policy and do not enforce HTTPS.
- Paper journals for trades, fills, funding, and ledger events are unbounded. Equity history is capped at 50,000 points, but local zero-trade state already occupies substantial space and creates duplicate temporary snapshots.
- The full test suite is slow and had one suite-level five-second timeout that passed in isolation, indicating timing fragility under contention.
- Formatting verification reports issues in 798 files and is not enforced in CI.
- The development dependency graph currently reports 15 high-severity advisories, while the production dependency audit reports zero. These are toolchain/supply-chain findings, not production runtime vulnerabilities, but they require tracked remediation.

### P3 — maintainability and clarity

- Several source files exceed 700–1,300 lines and combine data preparation, statistics, and reporting.
- Parallel concepts under `src/paper` and `src/paperTrading`, and under `src/strategy` and `src/strategies`, obscure which implementation is authoritative.
- `src/experimental` is tracked but excluded from TypeScript compilation.
- `src/index.backup.ts.txt` is a tracked backup artifact.
- Documentation needs a clear distinction between operational paths, research-only libraries, simulations, and planned architecture.

## D. Profitability and cost diagnosis

No defensible profitability diagnosis can be produced from the available evidence. The correct baseline is “insufficient data,” not “break-even.”

The default backtest policy charges 5 bps per fill in fees, 2 bps full spread, and 1 bp slippage per side. With half the spread applied on each side, that implies approximately:

```text
entry: 5 bps fee + 1 bp half-spread + 1 bp slippage
exit:  5 bps fee + 1 bp half-spread + 1 bp slippage
round trip: approximately 14 bps, before funding and market impact
```

That 5-bps taker assumption matches the current lowest-level OKX futures/perpetual taker rate; opening and closing transactions are each charged. See the [official OKX contract transaction fee guide](https://www.okx.com/en-us/help/how-to-calculate-the-contract-transaction-fee). The research modules also contain a 20-bps round-trip assumption, so cost assumptions are not yet canonical.

Funding must be event-driven. OKX states that default settlements occur at 00:00, 08:00, and 16:00 UTC, while some contracts can use one-, two-, or four-hour intervals and the exchange may adjust them. Only positions held at settlement are charged or credited. See the [official OKX funding mechanism](https://www.okx.com/en-us/help/perps-funding-fee-mechanism).

Before a strategy can be considered economically interesting, its untouched out-of-sample gross expectancy must exceed fees, spread, slippage, funding, adverse latency, unfilled quantity, and model uncertainty by a stable margin. No such gross expectancy has been measured here.

Minimum reporting requirements for every future baseline are:

- Gross and net P&L and expectancy, with each cost component shown separately.
- Trade count, wins, losses, breakevens, win/loss rate, average and median winner/loser, payoff ratio, profit factor, and expectancy in currency, percent, and R.
- Annualized return, volatility, Sharpe, Sortino, Calmar, maximum and average drawdown, recovery duration, and longest win/loss streak.
- Time in market, turnover, average holding time, gross/net exposure, long/short contribution, and contribution by instrument and regime.
- Capacity curves across order size, latency, participation limit, spread, slippage, and fee tier.
- Confidence intervals from block/bootstrap or trade-sequence resampling and Monte Carlo drawdown distributions.

## E. Backtest and validation integrity

### Positive controls already present

- Confirmed-candle handling is explicit.
- Stops are evaluated before targets when both are touched in the same bar, which is a conservative ambiguity rule.
- Open positions are force-closed at the end of a run.
- Deterministic seeding and recording-integrity tools exist.
- Evaluation tooling represents missing and ambiguous observations explicitly.
- Market-record reconstruction has strong timestamp/alignment concepts.

### Required corrections

1. **Decision timestamp:** the indicator state must end at the last confirmed input available at decision time.
2. **Execution timestamp:** fill no earlier than the next executable quote or bar after decision latency.
3. **Market events:** store candles, trades, order-book deltas/snapshots, funding settlements, instrument-spec changes, and outages as distinct timestamped event types.
4. **Shared fill engine:** backtest, replay, and paper modes should invoke the same deterministic execution contract, with mode-specific market inputs only.
5. **Instrument rules:** quantize price and size; enforce minimum size/notional, contract value, leverage and margin tiers, maintenance margin, and liquidation behavior.
6. **Data revisions:** freeze raw inputs by content hash and retain parser/config versions. Never silently replace a dataset under the same release ID.
7. **Walk-forward design:** derive each sample’s `informationEndAt` and `labelEndAt` from its true horizon or trade close; purge overlapping labels and embargo adjacent observations.
8. **Model selection:** tune only inside training/validation folds. Open the final test set once after the design is frozen.
9. **Multiple testing:** record every candidate and trial, compare against simple baselines, and apply false-discovery or deflated-Sharpe controls where appropriate.
10. **Stress testing:** rerun with worse fees, spread, latency, depth, missing updates, funding, and adverse fill ordering.

The order-book implementation correctly uses sequence continuity rather than a checksum. OKX deprecated the checksum field on 2026-06-23 and directs clients to `seqId`/`prevSeqId`; the repository’s lack of checksum validation is therefore not a defect. See [OKX’s checksum deprecation notice](https://www.okx.com/en-us/help/okx-order-book-channels-checksum-field-deprecation) and [API changelog](https://www.okx.com/docs-v5/log_en/).

## F. Data-quality assessment

### What is strong

- The public WebSocket path validates message structure and uses integer-safe sequence identifiers.
- Book gaps and stale/unusable books pause signal use and trigger resynchronization.
- Crossed and one-sided books are rejected for signal use.
- Receipt time and exchange/event time are represented separately in research tooling.
- Recording and evidence modules contain integrity and non-overwrite concepts.

### What remains unproven or unsafe

- No long-duration raw recording was available for replay.
- There is no audited coverage report for gaps, duplicates, stale intervals, reconnects, clock skew, or per-symbol data availability.
- Silently skipped malformed book levels can create a partial but sequence-current book.
- The actual continuous collector and PostgreSQL store are not the runtime’s enforced source of truth.
- Local research data is ignored by Git and lacks a checked-in manifest that would make the audit reproducible.
- The event universe has no stable, versioned definition spanning OKX-only, external-confirmed, and confidence-change alerts.
- No survivorship/delisting policy was demonstrated for the instrument universe.
- No contract-spec history was available to prove point-in-time tick size, lot size, contract value, fee tier, or funding interval.

The first acceptable dataset should include at least the configured release threshold of 180 days and three instruments, but duration alone is not sufficient. It must cover different volatility/trend/liquidity regimes, include maintenance/outage periods, and provide a completeness report. The existing autonomy simulation correctly remains blocked below these thresholds; its fixture output is not evidence.

## G. Feature and signal audit

The alpha-research simulation produces 260 synthetic rows, four folds, and a ranked 50-feature registry, but explicitly returns `NO_EMPIRICAL_DATA` and enables zero production features. This is the correct disposition.

No feature-importance or ablation result can be carried into production because:

- all observed rankings are synthetic;
- there is no frozen real dataset;
- point-in-time joins have not been exercised end to end by the running platform;
- no stability analysis exists across instruments, regimes, horizons, and transaction-cost assumptions;
- no holdout calibration set exists for the displayed confidence.

The current whale signal is primarily a distance-weighted displayed bid/ask notional imbalance around the book. Displayed liquidity can be canceled, spoofed, replenished, or split, so size alone is neither intent nor direction. The fixed quote-notional threshold also changes economic meaning across BTC, metals, and altcoins.

Future features should be normalized using only past information: percentile versus trailing depth, share of near-touch depth, order persistence, replenishment/cancellation behavior, signed trade response, spread, realized volatility, liquidity regime, and distance from touch. Each feature must have a documented timestamp, lookback, missing-value rule, and leakage test.

## H. Entry, exit, and strategy findings

### Current EMA strategy

The active evaluator uses:

- EMA 20/50 fresh crossover;
- close and slow-EMA slope alignment;
- RSI 50–70 for long and 30–50 for short;
- ATR between 0.25% and 5% of price;
- stop distance `max(1%, 1.5 × ATR)`;
- target distance `max(2%, 2R)`;
- 1% trailing distance;
- opposite crossover exit.

This is a coherent deterministic baseline, but none of these values is supported by audited out-of-sample results. The absence of trades in the local paper states may reflect short coverage, fresh-crossover sparsity, upstream data availability, or gating; it does not prove that the strategy is safe or ineffective.

### Whale alerts

Whale events do not currently drive an empirically selected entry policy. Correlated alerts combine a 0.7 OKX weight, 0.3 external weight, an agreement bonus of 8, and contradiction penalty of 15. Those constants encode judgment. Calling the output “confidence” risks probability-like interpretation without calibration.

### Exit-model mismatch

- Backtests infer stop/target touches from OHLC ranges.
- Paper execution triggers from midpoint and then fills against the book.
- Stop-first ordering is conservative within a bar, but a bar cannot reconstruct the intrabar path.
- Trailing stops update at bar granularity and differ from event-driven paper behavior.
- Partial exits are currently lost from accounting unless fully filled.

Exit attribution must report why each position closed, its maximum favorable/adverse excursion, path to target/stop, holding time, spread/depth at exit, and the difference between theoretical trigger price and realized fill.

## I. Risk-management and execution-safety audit

The default paper risk manager has useful hard limits: 1% risk per trade, 3% daily loss, 10% drawdown, three concurrent positions, a 30-minute cooldown, maximum leverage of 5, 12 daily trades, and a four-loss-streak stop. The platform’s default paper leverage is 2 and is checked against maintenance margin assumptions.

These are guardrails, not evidence-based optimal values. They also do not fully address portfolio risk. The order path needs atomic checks for:

- aggregate gross and net notional;
- correlated/clustered exposure;
- per-instrument and per-side concentration;
- margin utilization and liquidation distance under stress;
- funding exposure and settlement proximity;
- order-book staleness, spread, depth, participation, and impact;
- daily realized plus unrealized loss;
- repeated rejections, reconnect churn, clock drift, and data degradation.

The separate portfolio/professional-risk libraries contain some of these concepts, but they are not authoritative gates in the paper runtime. Integrating one canonical risk gateway is more important than adding new risk parameters.

Every non-zero fill must be treated as real exposure. Entry logic largely does this by opening the filled quantity, but exit logic violates it. That issue must be fixed before paper results can be trusted.

## J. Code quality, security, CI, and operations

### Verification performed

| Check                                            | Result                                                                                                                                                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean dependency install                         | Passed using `npm.cmd ci --prefer-offline --no-audit --no-fund`. The initial `npm` invocation was blocked only by local PowerShell script policy.                                                                            |
| Build                                            | Passed.                                                                                                                                                                                                                      |
| Typecheck                                        | Passed.                                                                                                                                                                                                                      |
| ESLint                                           | Passed.                                                                                                                                                                                                                      |
| Full tests                                       | 342 files passed, 1 failed; 1,771 tests passed, 1 failed. The single five-second timeout passed on isolated rerun (all 6 tests passed), indicating suite-load timing fragility rather than a reproduced correctness failure. |
| Production dependency audit                      | 0 vulnerabilities.                                                                                                                                                                                                           |
| Full dependency audit                            | 15 high-severity development-toolchain findings, 0 critical.                                                                                                                                                                 |
| Formatting                                       | Failed; 798 files reported style differences.                                                                                                                                                                                |
| Docker Compose development and production config | Parsed successfully.                                                                                                                                                                                                         |
| Docker image/runtime and PostgreSQL migrations   | Not locally executed because the Docker daemon and `psql` were unavailable.                                                                                                                                                  |
| Backtest CLI                                     | Correctly rejected missing input; no dataset was available.                                                                                                                                                                  |
| Evidence/recording CLIs                          | Correctly rejected missing release/recording input.                                                                                                                                                                          |
| Offline simulations                              | Completed deterministically, but use controlled synthetic fixtures and are not profitability evidence.                                                                                                                       |

### Security and live safety

- No OKX private trading client, live order endpoint, or committed private credential was found.
- Runtime and release structures keep live execution false; production startup also requires explicit remote-paper settings and rejects contradictory live mode.
- `.env` files are ignored; examples use placeholders.
- Static-path containment, request-body limits, and `nosniff` headers are present.
- CI is broad: Node 24, PostgreSQL, migrations, install/audit/check/build, dashboard checks, Compose checks, container build/hardening, and backup/restore scripts.

Remaining issues:

- Network access is the dashboard’s security boundary. Preserve loopback binding or add authentication, TLS, CSRF protection, and role separation before remote access.
- Add explicit notification timeouts, safe retry/backoff, URL-scheme validation, and secret redaction.
- Track development supply-chain advisories even where upstream fixes are unavailable; pin or replace affected tooling when fixes exist.
- Add formatting, real recording replay, dataset-integrity, and empirical evidence-gate jobs to CI.
- Test container hardening and database migrations in a working daemon environment before release.

## K. Evidence-supported strategy recommendation

The evidence does **not** support a new trading rule or optimized parameter set. It supports a safer research design.

The next candidate should remain a non-trading research specification:

1. Define one immutable event taxonomy and version it. Include all qualifying whale events, not only alerts that agree with an external signal.
2. Build matched non-event controls by instrument, time-of-day, volatility, spread, and liquidity regime.
3. Separate targets:
   - direction: future mid/mark return net of an executable-entry reference;
   - volatility: future absolute return/range and adverse/favorable excursion;
   - tradability: depth, spread, fill probability, and net return after costs.
4. Measure multiple fixed horizons chosen before looking at results; account for overlapping outcomes.
5. Normalize whale size by trailing, point-in-time liquidity and persistence. Treat external agreement as a feature, not a qualification rule.
6. Compare against simple baselines: no-signal unconditional return, EMA-only, book-imbalance-only, and a regularized model with predeclared features.
7. Calibrate probability only on held-out folds. Until calibration is stable, rename the displayed value from `confidence` to `heuristicScore`.
8. Select an entry/exit policy only if the signal’s untouched out-of-sample net expectancy survives stress costs and is stable across time and instruments.
9. Run shadow/paper mode long enough to observe the expected sample size and operational failures before considering testnet.

The EMA strategy should be retained unchanged as a versioned benchmark while this evidence is collected. Replacing or tuning it now would erase the baseline and increase researcher degrees of freedom.

## L. Exact implementation plan

This is a recommended change plan, not work performed during this audit.

### Create

- `src/backtest/BacktestMarketEvent.ts`: discriminated timestamped events for candle confirmation, quote/book state, funding settlement, instrument specification, and outage/reconnect boundaries.
- `src/backtest/BacktestDatasetManifest.ts`: source hashes, coverage, instruments, parser version, gaps, duplicates, clock checks, fee/spec versions, and release ID.
- `src/backtest/PortfolioBacktestEngine.ts`: one event clock, shared cash/margin, concurrent instruments, atomic portfolio-risk checks, and contribution accounting.
- `src/research/EventPopulationDefinition.ts`: versioned inclusion/exclusion rules for OKX-only, external features, and control observations.
- `src/research/OutcomeLabel.ts`: explicit observation start/end, executable reference prices, path outcomes, and censoring.
- `src/research/EmpiricalResearchPipeline.ts`: enforced dataset → feature → fold → candidate → holdout → evidence-release chain.
- Tests covering next-event fills, funding settlement boundaries, partial exits, book corruption/resync, purging across trade horizons, instrument quantization, and portfolio exposure.

### Modify or rewrite

- `src/backtest/PlatformBacktestEngine.ts`: fill only after the decision timestamp; consume explicit funding events; delegate fills to the shared execution model; expose gross/spread/slippage/fee/funding P&L separately.
- `src/backtest/runPlatformBacktest.ts`: require a dataset manifest and frozen strategy/config identifiers; emit a complete reproducibility bundle.
- `src/backtest/BacktestStatistics.ts` and `src/backtest/PerformanceAnalytics.ts`: consolidate into one canonical metric implementation with defined annualization, no-loss, zero-variance, and missing-data semantics.
- `src/platform/TradingPlatformEngine.ts`: book every non-zero partial exit and maintain residual position state; trigger long exits from executable bid and short exits from executable ask.
- `src/market/OrderBookManager.ts`: invalidate the entire update on a malformed level; explicitly classify non-advancing/reset sequences and resynchronize according to the current OKX protocol.
- `src/data/ContinuousDerivativesCollector.ts`: wire it to an executable collector entry point, immutable raw storage, coverage telemetry, reconnect metrics, and manifest generation.
- PostgreSQL research stores: make them the documented empirical source of truth, add runtime construction/configuration, and test migrations plus restart/replay behavior.
- `src/research/PurgedWalkForward.ts`: purge using true outcome/trade intervals and enforce an embargo; integrate it with candidate selection rather than producing metadata only.
- `src/signals/ExternalSignalCorrelationEngine.ts` and output schemas: rename uncalibrated confidence, version weights, and prohibit probability labels until calibration tests pass.
- `src/risk/TradingRiskManager.ts`: delegate to or merge with the canonical portfolio-risk gateway so all execution modes enforce the same limits.
- `.github/workflows/ci.yml`: add format, frozen-recording replay, dataset manifest, empirical-gate, and development-advisory tracking jobs.
- `README.md` and architecture docs: label each component as operational, research-only, simulation-only, or planned.

### Rename or consolidate after compatibility migration

- Consolidate `src/paperTrading` into `src/paper/evaluation` or retire it if it is only an older standalone engine.
- Consolidate `src/strategy` and `src/strategies` under one strategy interface/registry while preserving strategy IDs.
- Move non-production `src/experimental` work outside the compiled source tree or give it an independently tested package/configuration.

### Delete after verifying no consumers

- `src/index.backup.ts.txt`.
- Superseded experimental implementations and duplicate metric/engine code after the canonical replacements pass equivalence tests.

Do not delete the current EMA implementation or change its parameters during P0 work. Its unchanged version is needed as the benchmark.

## M. Validation and release plan

### Phase 0 — measurement integrity

- Fix same-close entry, funding events, partial exits, executable trigger prices, malformed book handling, and sequence semantics.
- Establish one execution model and one metric implementation.
- Add deterministic regression fixtures for every P0 defect.

Exit criterion: every fill and cash movement can be replayed exactly from frozen input events, and accounting identities reconcile to zero unexplained difference.

### Phase 1 — empirical data release

- Collect at least 180 days and at least three instruments, including different liquidity/volatility regimes.
- Freeze raw data and manifests; publish coverage/gap/clock/spec reports.
- Generate all whale events and matched controls without using future outcomes.

Exit criterion: an independent clean checkout can reproduce the same dataset hashes, event counts, and labels.

### Phase 2 — preregistered research

- Freeze hypotheses, horizons, features, costs, folds, embargo, baselines, and rejection criteria before results.
- Run purged walk-forward evaluation and one untouched final holdout.
- Report all trials and negative findings.

Exit criterion: positive net expectancy with uncertainty bounds, stability across time/instruments, adequate sample size, and survival under adverse cost/latency scenarios. A single aggregate Sharpe or profitable fold is insufficient.

### Phase 3 — shadow and paper validation

- Run live public data in shadow mode, then remote paper mode.
- Compare predicted versus realized fill, latency, slippage, funding, data gaps, and signal rates.
- Reconcile every day from event log to ledger to report.

Exit criterion: no unexplained accounting differences, no lost partial fills, stable operational metrics, and forward performance consistent with the preregistered uncertainty range.

### Phase 4 — testnet readiness review

- Require manual approval, least-privilege credentials, withdrawal disabled, IP restrictions, secret rotation, authenticated operations access, incident runbooks, alerts, and independently tested kill switches.
- Start with minimal limits and adversarial failure drills.

Exit criterion: explicit human authorization after evidence and operational sign-off. This audit does not authorize testnet or live trading.

## N. Prioritized roadmap and expected impact

| Priority | Work item                                                 | Expected benefit                                   | Evidence required                                         | Risk                       | Complexity      |
| -------- | --------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------- | -------------------------- | --------------- |
| P0       | Correct decision/fill timing                              | Removes a major optimistic bias                    | Next-event regression tests and replay equivalence        | Medium implementation risk | Medium          |
| P0       | Model explicit funding settlements                        | Prevents repeated/missed funding charges           | Exchange-timestamp fixtures across 1/2/4/8-hour schedules | Low                        | Medium          |
| P0       | Apply all partial exits                                   | Restores exposure and ledger truth                 | Property tests and cash/position reconciliation           | Medium                     | Medium          |
| P0       | Unify execution and instrument constraints                | Makes backtest/paper results comparable            | Golden fills across modes and contract specs              | Medium-high                | High            |
| P0       | Build frozen empirical dataset and manifest               | Makes all research reproducible                    | Hash-stable release with coverage audit                   | Low operational risk       | High/time-bound |
| P0       | Integrate true purged walk-forward plus untouched holdout | Controls leakage and selection bias                | Interval-overlap tests and preregistered final run        | Medium                     | High            |
| P1       | Wire continuous collection/store/research/release         | Prevents bypass and architecture drift             | End-to-end restart/replay/integrity test                  | Medium                     | High            |
| P1       | Normalize and version whale events                        | Makes events comparable across instruments/regimes | Distribution and stability reports                        | Research risk              | Medium          |
| P1       | Connect canonical portfolio risk gate                     | Limits concentrated and aggregate exposure         | Multi-instrument stress scenarios                         | Medium                     | High            |
| P1       | Harden order-book invalid-update behavior                 | Avoids current-looking partial books               | Corruption, gap, reset, and reconnect fixtures            | Low                        | Medium          |
| P1       | Replace confidence with calibrated outputs                | Prevents false certainty                           | Reliability diagrams, Brier/log loss, holdout calibration | Research risk              | Medium          |
| P2       | Consolidate metrics and expand attribution                | Produces auditable performance reports             | Cross-checked hand calculations and edge cases            | Low                        | Medium          |
| P2       | Harden dashboard and notifications                        | Reduces remote operational/security risk           | Auth/TLS/timeout tests and deployment review              | Low                        | Medium          |
| P2       | Stabilize suite, formatting, and dev dependencies         | Improves repeatability and supply-chain posture    | Green CI with tracked exceptions                          | Low                        | Medium          |
| P3       | Consolidate duplicate modules and remove dead artifacts   | Clarifies authoritative code paths                 | Import/reference audit and equivalence tests              | Medium refactor risk       | Medium          |

### Final disposition

The repository should remain in **research and paper-only mode**. Its strongest asset is the safety-oriented scaffold; its largest gap is the absence of one operational, reproducible empirical chain and trustworthy execution accounting. Correct measurement first, collect representative data second, test preregistered hypotheses third, and only then evaluate whether any edge exists.

No finding in this audit establishes expected profitability, and no implementation change can guarantee it.
