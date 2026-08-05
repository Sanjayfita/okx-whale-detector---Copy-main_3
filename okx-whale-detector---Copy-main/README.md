# OKX derivatives quantitative research platform

A TypeScript/Node.js platform for collecting, validating, replaying, optimizing, explaining, and shadow-testing OKX perpetual-futures and expiry-futures strategies.

## Safety and interpretation

The detector emits **heuristic research signals**. They are not a guarantee of future price direction, and confidence scores must not be treated as a probability of profit.

Current status:

- Market scope: OKX `SWAP` and `FUTURES` only.
- Research-platform engineering: implemented through shadow trading and reviewed as the maintained foundation.
- Strategy profitability: **not validated**.
- Strategy release: **BLOCKED** because corrected real-market discovery, frozen holdout, prolonged paper, shadow, and paired-baseline evidence are absent.
- Paper and shadow research: available only after their prerequisite data and validation gates.
- Testnet/live order execution: **disabled**.

Merging the research platform into `main` means the software passed its engineering gate. It does not promote a strategy or prove positive expectancy.

## Installation and supported commands

Install the exact locked dependencies:

```bash
npm ci
```

Run type checking, linting, and the complete test suite:

```bash
npm run check
```

Start the TypeScript development runtime:

```bash
npm run dev
```

Build the production JavaScript output:

```bash
npm run build
```

Run the compiled application after building:

```bash
npm start
```

Inspect a generated research analytics report:

```bash
npm run build
node dist/tools/quantResearchDashboard.js inspect path/to/report.json
```

Serve the optional local web dashboard:

```bash
npm run build
node dist/tools/quantResearchDashboard.js serve path/to/report.json 8787
```

The root GitHub Actions workflow starts PostgreSQL 16 and executes every migration in lexical order with `ON_ERROR_STOP` before running type checking, lint, the complete test suite, and the production build.

## Watched symbols

The legacy static watched-symbol list is defined in `src/config/symbols.ts`. Derivatives-only symbol profiles and dynamic discovery are implemented by the newer configuration modules under `src/config`.

Do not mix old spot observations with a new derivatives evaluation. Existing spot-compatible records remain readable only for historical audit and migration.

## Project structure

- `src/config/symbols.ts` — legacy watched-symbol configuration.
- `src/config` — derivatives profiles, discovery, thresholds, and runtime policies.
- `src/clients/okx` — OKX REST and WebSocket adapters.
- `src/core` — market-state, order-book, and detector orchestration.
- `src/types` — shared TypeScript contracts.
- `src/data` — canonical records, integrity validation, historical recovery, and supervised continuous collection.
- `src/storage` and `db/migrations` — PostgreSQL persistence contracts and normalized research/audit schemas.
- `src/features` and `src/orderflow` — timestamp-bounded features and support-aware advanced order flow.
- `src/regime` and `src/timeframe` — explainable market classification and top-down timeframe context.
- `src/strategy` and `src/research` — strategy laboratory, AI research governance, feature selection, purged optimization, robustness, Monte Carlo, and comparison.
- `src/portfolio` and `src/risk` — Kelly/risk-parity allocation, correlation-complete portfolio controls, and point-in-time event filtering.
- `src/explainability` — structured machine-readable and human-readable trade explanations.
- `src/backtest`, `src/paper`, and `src/shadow` — depth-aware execution, paper execution, and live-data shadow evaluation.
- `src/release` — separate research-platform merge and empirical strategy-release gates; neither enables live execution.
- `src/analytics` — shared CLI and optional web analytics.
- `src/tools` — operational and research command-line tools.
- `test` — unit, integration, chronology, research, database, and regression tests.

## Research workflow

```text
Continuous collection
  -> integrity and immutable persistence
  -> explainable regime detection
  -> reproducible AI-assisted research priors
  -> feature importance and paired ablation
  -> multi-timeframe strategy context
  -> event-risk filtering
  -> trade explanation
  -> portfolio risk gateway
  -> depth-aware backtest
  -> purged walk-forward and Bayesian-style optimization
  -> frozen untouched holdout
  -> execution-aware Monte Carlo
  -> paper trading
  -> shadow trading
  -> empirical strategy-release gate
```

`ResearchPlatformMergeGate` determines whether engineering changes may become the maintained `main`-branch foundation. `ReleaseCandidateGate` independently determines whether a frozen strategy has enough real-market evidence for later release review. Live order submission is not part of either gate and remains disabled.

## Order-book and collection integrity

A valid local order book begins from a **full snapshot** and then applies only updates that pass sequence-continuity checks.

When a sequence gap, invalid predecessor, crossed book, malformed update, or reconnect invalidates continuity, the local market state is reset. The system must obtain a new full snapshot before the instrument is considered synchronized again. Research features and signals must never be generated from a partially reconstructed or unverified book.

Historical datasets apply the same principle: sequence-aware depth must come from persisted event-time capture or a verified archive. A current REST snapshot cannot reconstruct missing historical depth.

Regular continuous sources must also reach their declared complete-source watermark. Interior or trailing gaps block checkpoint advancement unless bounded recovery fills them. Exchange timestamps, local receive timestamps, duplicate identities, source watermarks, and sequence values are validated before persistence.

## Execution and portfolio integrity

Any non-zero simulated market fill remains a real partial position. Entry fees, unfilled quantity, residual exit exposure, and missed opportunities are retained in backtest, paper, and shadow evidence.

Portfolio exposure is netted by instrument before gross exposure, net exposure, leverage, group limits, and historical VaR are evaluated. Missing scenario returns and missing required pair correlations fail closed instead of being interpreted as zero risk. Risk-reducing hedges may reduce an already saturated portfolio, but no strategy may bypass the portfolio gateway.

## Research platform documentation

- [Final foundation technical review](docs/final-foundation-technical-review.md)
- [Phase 5 complete quantitative research platform](docs/phase5-complete-quantitative-research-platform.md)
- [Phase 4 trading edge and release assessment](docs/phase4-trading-edge-release-assessment.md)
- [Phase 3 quantitative research platform](docs/phase3-quantitative-research-platform.md)
- [Derivatives strategy refactor and validation audit](docs/derivatives-strategy-refactor.md)

## Evidence required before strategy promotion

A strategy must pass all of the following on a corrected immutable derivatives dataset:

1. Dataset integrity, chronology, sequence, duplicate, corruption, watermark, and gap checks.
2. Independent-episode analysis.
3. Explainable regime and multi-timeframe evaluation across multiple instruments.
4. Fold-level feature importance and paired ablation with redundancy removal.
5. Purged walk-forward optimization using discovery data only.
6. Stable parameter-neighborhood checks.
7. Observation-specific fee, spread, slippage, latency, funding, depth, missed-fill, partial-fill, and residual-exposure stress across required market regimes.
8. Correlation-complete portfolio scenarios and execution-aware Monte Carlo with acceptable drawdown and ruin distributions.
9. A frozen one-time evaluation on an untouched final holdout.
10. Prolonged realistic live-market paper execution and reconciliation.
11. Prolonged live-data shadow trading with unfilled-quantity, missed-opportunity, and paper-comparison reports.
12. Statistically significant paired improvement over the original whale baseline.
13. Green database migrations, tests, lint, type checking, production build, and GitHub Actions.

A strategy must not be promoted merely because it has a higher in-sample win rate, a better leaderboard score, an AI ranking, an optimizer result, or a small number of large winning trades.
