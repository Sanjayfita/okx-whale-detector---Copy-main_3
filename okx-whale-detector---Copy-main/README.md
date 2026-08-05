# OKX derivatives quantitative research platform

A TypeScript/Node.js platform for collecting, validating, replaying, and comparing OKX perpetual-futures and expiry-futures strategies.

## Safety and interpretation

The detector emits **heuristic research signals**. They are not a guarantee of future price direction, and confidence scores must not be treated as a probability of profit.

Current status:

- New market scope: OKX `SWAP` and `FUTURES` only.
- Strategy profitability: **not validated**.
- Paper research: available only after data and validation gates.
- Testnet/live order execution: **disabled**.

Passing tests and database migrations proves engineering consistency. It does not prove positive expectancy.

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

The root GitHub Actions workflow also starts PostgreSQL 16 and executes every migration with `ON_ERROR_STOP` before running the TypeScript quality gate and production build.

## Watched symbols

The legacy static watched-symbol list is defined in `src/config/symbols.ts`. Derivatives-only symbol profiles and dynamic discovery are implemented by the newer configuration modules under `src/config`.

Do not mix old spot observations with a new derivatives evaluation. Existing spot-compatible records remain readable only for historical audit and migration.

## Project structure

- `src/config/symbols.ts` — legacy watched-symbol configuration.
- `src/config` — derivatives profiles, discovery, thresholds, and runtime policies.
- `src/clients/okx` — OKX REST and WebSocket adapters.
- `src/core` — market-state, order-book, and detector orchestration.
- `src/types` — shared TypeScript contracts.
- `src/data` — canonical research records, integrity validation, pagination, and gap recovery.
- `src/storage` and `db/migrations` — PostgreSQL persistence contracts and normalized schema.
- `src/features` — timestamp-bounded feature engineering and importance analysis.
- `src/strategy` and `src/research` — strategy laboratory, walk-forward optimization, validation, ablation, and comparison.
- `src/portfolio` and `src/risk` — portfolio allocation and professional risk controls.
- `src/backtest` and `src/paper` — depth-aware execution simulation and paper trading.
- `src/analytics` — shared CLI and optional web analytics.
- `src/tools` — operational and research command-line tools.
- `test` — unit, integration, chronology, research, database, and regression tests.

## Order-book integrity

A valid local order book begins from a **full snapshot** and then applies only updates that pass sequence-continuity checks.

When a sequence gap, invalid predecessor, crossed book, malformed update, or reconnect invalidates continuity, the local market state is reset. The system must obtain a new full snapshot before the instrument is considered synchronized again. Research features and signals must never be generated from a partially reconstructed or unverified book.

Historical datasets apply the same principle: sequence-aware depth must come from persisted event-time capture or a verified archive. A current REST snapshot cannot reconstruct missing historical depth.

## Research platform documentation

- [Phase 3 quantitative research platform](docs/phase3-quantitative-research-platform.md)
- [Derivatives strategy refactor and validation audit](docs/derivatives-strategy-refactor.md)

## Evidence required before promotion

A strategy must pass all of the following on a corrected immutable derivatives dataset:

1. Dataset integrity, chronology, sequence, and gap checks.
2. Independent-episode analysis.
3. Purged walk-forward testing using discovery data only.
4. Observation-specific fee, spread, slippage, latency, funding, and partial-fill stress.
5. A frozen one-time evaluation on an untouched final holdout.
6. Stable performance across instruments and market regimes.
7. Prolonged realistic paper execution and reconciliation.
8. Exchange-exact operational review before any testnet proposal.

A strategy must not be promoted merely because it has a higher in-sample win rate, a better leaderboard score, or a small number of large winning trades.
