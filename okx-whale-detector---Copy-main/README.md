# OKX derivatives quantitative research laboratory

A TypeScript/Node.js platform for collecting, validating, replaying, optimizing, explaining, scheduling, and shadow-testing OKX perpetual-futures and expiry-futures research strategies.

## Safety and interpretation

Whale and order-book detectors emit **heuristic research telemetry**. They are no longer the maintained primary trading-entry strategy, are not a guarantee of future price direction, and their confidence scores must not be treated as a probability of profit.

Current status:

- Market scope: OKX `SWAP` and `FUTURES` only.
- Primary strategy: `ema-trend-crossover-v1` — EMA 20/50 crossover with RSI momentum confirmation and ATR volatility/risk controls.
- Historical whale/derivatives-flow rules: retained only as research comparators and baseline evidence.
- Research architecture: permanent `main`-branch foundation with point-in-time empirical controls and Phase 6 autonomous research operations.
- Strategy profitability: **not validated**.
- Strategy release: **BLOCKED** because corrected real-market discovery, frozen holdout, prolonged paper, shadow, and paired-baseline evidence are absent.
- Autonomous research: discovery-only hypothesis, feature, scheduling, distributed-backtest, ranking, and reporting infrastructure.
- Testnet/live order execution: **disabled**.

Passing an engineering gate means the software can support controlled experiments. It does not promote a strategy or prove positive expectancy.

## Maintained primary strategy

The primary entry boundary is `createPrimaryStrategyLaboratory()`, which contains only `ema-trend-crossover-v1`.

Entry is intentionally simple:

- bullish/bearish EMA crossover;
- price and slow-EMA slope trend confirmation;
- RSI momentum confirmation;
- ATR low/extreme-volatility filter;
- no entry while a position is already open.

Risk and exits are explicit:

- planned loss is capped at **1% of current account equity** per trade;
- stop distance is the greater of configured stop-loss percentage or ATR × multiplier;
- take-profit distance is always at least two times the actual stop distance;
- optional percentage trailing stop;
- opposite EMA crossover also exits an open position;
- if stop and target are touched in the same candle, research logic assumes the stop occurred first.

Strategy parameters live in `src/config/tradingStrategyConfig.ts`. See [Primary EMA trend strategy](docs/ema-trend-primary-strategy.md) for the complete rule set and rationale.

## Installation and validation

Install the exact locked dependencies:

```bash
npm ci
```

Run type checking, linting, and the complete test suite:

```bash
npm run check
```

Build production JavaScript:

```bash
npm run build
```

Start the development runtime:

```bash
npm run dev
```

Start the compiled production runtime:

```bash
npm start
```

Run the deterministic Phase 6 laboratory simulation:

```bash
npm run build --silent
node dist/tools/simulateAutonomousResearch.js
```

The simulation intentionally reports insufficient evidence. It is an engineering demonstration, not a profitable backtest.

The root GitHub Actions workflow starts PostgreSQL 16 and executes every migration in lexical order with `ON_ERROR_STOP` before type checking, linting, the complete test suite, and the production build.

## Watched symbols

The legacy static watched-symbol list is defined in `src/config/symbols.ts`. Derivatives-only profiles and dynamic discovery are implemented by the newer configuration modules under `src/config`.

Do not mix old spot observations with a new derivatives evaluation. Existing spot-compatible records remain readable only for historical audit and migration.

## Project structure

- `src/autonomy` — bounded hypothesis generation, adaptive feature specifications, experiment scheduling, distributed backtests, discovery ranking, cycle manifests, and continuous reporting.
- `src/config/symbols.ts` — legacy watched-symbol configuration.
- `src/config` — derivatives profiles, discovery, thresholds, runtime policies, and the maintained EMA strategy configuration.
- `src/clients/okx` — OKX REST and WebSocket adapters.
- `src/core` — market-state, order-book, detector, candle-history, and telemetry orchestration.
- `src/types` — shared TypeScript contracts.
- `src/data` — canonical records, point-in-time availability, integrity validation, historical recovery, and continuous collection.
- `src/storage` and `db/migrations` — PostgreSQL persistence contracts and normalized research, autonomous-cycle, task, work-unit, result, ranking, and report schemas.
- `src/features` and `src/orderflow` — receipt-time-bounded features, block-aware importance, and support-aware advanced order flow.
- `src/regime` and `src/timeframe` — explainable market classification and top-down timeframe context.
- `src/strategy` and `src/research` — the maintained EMA entry strategy plus historical research comparators, bounded candidate generation, experiment manifests, feature selection, purged optimization, significance, robustness, Monte Carlo, comparison, and audit reporting.
- `src/portfolio` and `src/risk` — Kelly/risk-parity research, correlation-complete portfolio controls, and point-in-time event filtering.
- `src/explainability` — structured machine-readable and human-readable trade explanations.
- `src/backtest`, `src/paper`, and `src/shadow` — depth-aware execution, paper execution, and live-data shadow evaluation.
- `src/release` — research-platform merge and empirical strategy-release gates; neither enables live execution.
- `src/analytics` — shared CLI and optional web analytics.
- `src/tools` — operational and research command-line tools.
- `test` — unit, integration, chronology, autonomy, research, database, and regression tests.

## Empirical research controls

Every historical feature input is selected using both exchange observation time and local receipt time. Each source has a bounded lookback and freshness policy. Feature output records observations excluded as future, unavailable at decision time, or outside the allowed window.

Strategy and feature search is organized into frozen hypothesis families. Reports record the full search-space size, effective hypothesis count, rejected constraints, and deterministic fingerprints before optimization.

Paired feature and strategy evidence uses independent episodes, bootstrap confidence intervals, sign-randomization tests, standardized effects, and Holm-Bonferroni correction. Strategy comparison requires a shared frozen opportunity universe and represents no-trade outcomes as zero rather than omitting them.

`ResearchExperimentManifest` binds data fingerprints, commit, configuration, candidate family, split diagnostics, source-quality evidence, freeze chronology, and holdout-access count. Migration 005 persists those manifests, candidates, source assessments, and corrected significance results atomically.

`ResearchAuditReport` consolidates data exclusions, split leakage, hypothesis burden, feature evidence, paired significance, robustness, Monte Carlo tail risk, and release blockers. It never authorizes strategy promotion or execution.

## Phase 6 autonomous research controls

Phase 6 automates research throughput without automating strategy promotion.

- `ResearchFingerprint` creates canonical content identities across machines.
- `ResearchHypothesis` expands human-approved, falsifiable templates under search and complexity budgets.
- `AdaptiveFeatureDiscovery` creates lineage-aware transformation specifications and rejects target-derived or unavailable inputs.
- `ExperimentScheduler` enforces dependency DAGs, leases, retries, resources, and idempotent result fingerprints.
- `DistributedBacktest` partitions discovery observations by complete episodes and rejects missing, duplicate, unexpected, or mismatched worker results.
- `AutonomousResearchRanking` prioritizes replication using lower confidence bounds, adjusted p-values, tail risk, drawdown, complexity, and hypothesis burden.
- `AutonomousResearchLaboratory` binds one cycle to dataset, code, configuration, families, work plan, and exact task graph.
- `ContinuousResearchReport` publishes evidence coverage, task progress, blockers, and deterministic next actions.
- Migration 006 and `PostgresAutonomousResearchStore` persist cycles, hypotheses, features, tasks, work units, results, rankings, and reports.

All Phase 6 objects remain discovery-only and set holdout access, strategy promotion, and live execution to false.

## Research workflow

```text
Continuous real-market derivatives collection
  -> integrity, sequence, watermark and gap validation
  -> immutable point-in-time discovery dataset
  -> canonical research fingerprints
  -> bounded falsifiable hypothesis generation
  -> adaptive feature candidate specifications
  -> block-aware importance and familywise-corrected ablation
  -> bounded strategy candidate families
  -> autonomous cycle and experiment DAG
  -> deterministic distributed discovery backtests
  -> complete-result aggregation
  -> episode-safe purged walk-forward evaluation
  -> complete-universe paired strategy comparison
  -> regime and adverse-cost robustness
  -> systemic execution Monte Carlo and expected-shortfall review
  -> uncertainty-aware replication priority
  -> continuous research report
  -> freeze one candidate
  -> untouched holdout accessed exactly once
  -> reconciled paper trading
  -> prolonged shadow trading
  -> empirical strategy-release review
```

`ResearchPlatformMergeGate` determines whether engineering changes may become the maintained `main` foundation. `ReleaseCandidateGate` independently determines whether a frozen strategy has enough real-market evidence for later release review. Live order submission remains disabled.

## Order-book and collection integrity

A valid local order book begins from a **full snapshot** and then applies only updates that pass sequence-continuity checks.

When a sequence gap, invalid predecessor, crossed book, malformed update, or reconnect invalidates continuity, the local market state is reset. A new full snapshot is required before the instrument is synchronized again. Research features and signals must never use a partially reconstructed or unverified book.

Historical sequence-aware depth must come from persisted event-time capture or a verified archive. A current REST snapshot cannot reconstruct missing historical depth.

Continuous sources must reach declared complete-source watermarks. Interior or trailing gaps block checkpoint advancement unless bounded recovery fills them. Exchange timestamps, local receipt timestamps, duplicate identities, watermarks, and sequence values are validated before persistence.

## Execution and portfolio integrity

Any non-zero simulated market fill remains a real partial position. Entry fees, unfilled quantity, residual exit exposure, and missed opportunities remain in backtest, paper, and shadow evidence.

Execution Monte Carlo combines systemic and idiosyncratic fee, funding, slippage, and latency shocks. Favorable funding receipts are haircutted, favorable trades can be missed more often, ruin is path-dependent, and reports include expected shortfall and drawdown-threshold probability.

Portfolio exposure is netted by instrument before gross exposure, net exposure, leverage, group limits, and historical VaR are evaluated. Missing scenario returns and missing required pair correlations fail closed. Risk-reducing hedges may reduce an already saturated portfolio, but no strategy bypasses the portfolio gateway.

## Documentation

- [Primary EMA trend strategy](docs/ema-trend-primary-strategy.md)
- [Phase 6 autonomous quantitative research laboratory](docs/phase6-autonomous-quantitative-research.md)
- [Empirical research hardening audit](docs/empirical-research-hardening.md)
- [Final foundation technical review](docs/final-foundation-technical-review.md)
- [Phase 5 complete quantitative research platform](docs/phase5-complete-quantitative-research-platform.md)
- [Phase 4 trading edge and release assessment](docs/phase4-trading-edge-release-assessment.md)
- [Phase 3 quantitative research platform](docs/phase3-quantitative-research-platform.md)
- [Derivatives strategy refactor and validation audit](docs/derivatives-strategy-refactor.md)

## Evidence required before strategy promotion

A strategy must pass all of the following on a corrected immutable derivatives dataset:

1. Dataset integrity, chronology, sequence, duplicate, corruption, watermark, and gap checks.
2. Point-in-time source availability using observation and receipt timestamps.
3. Independent-episode analysis with zero discovery/test/holdout episode overlap.
4. Explainable regime and multi-timeframe evaluation across multiple instruments.
5. A bounded fingerprinted hypothesis and candidate family with the cumulative hypothesis count recorded.
6. Block-aware feature importance and paired ablation with Holm-corrected significance and redundancy removal.
7. Purged walk-forward optimization using discovery data only.
8. A shared frozen opportunity universe including no-trade outcomes.
9. Stable parameter-neighborhood and independent replication checks.
10. Complete distributed work results with no duplicates, missing units, or fingerprint mismatch.
11. Fee, spread, slippage, latency, funding, depth, missed-fill, partial-fill, and residual-exposure stress across required regimes.
12. Correlation-complete portfolio scenarios and systemic Monte Carlo with acceptable expected shortfall, drawdown, and path-dependent ruin.
13. A frozen one-time evaluation on an untouched final holdout.
14. Prolonged realistic live-market paper execution and reconciliation.
15. Prolonged live-data shadow trading with unfilled-quantity, missed-opportunity, and paper-comparison reports.
16. Statistically significant paired improvement over the Original Whale Strategy baseline after familywise correction.
17. Green migrations, dependency audit, tests, lint, type checking, production build, and GitHub Actions.

A strategy must not be promoted merely because it has a higher in-sample win rate, a better research-priority score, an optimizer result, an autonomous ranking, or a small number of large winners.
