# OKX derivatives quantitative research platform

A TypeScript/Node.js research platform for collecting, validating, replaying, and comparing OKX perpetual-futures strategies.

## Current safety status

- New market scope: OKX `SWAP` and `FUTURES` only.
- Strategy profitability: **not validated**.
- Paper research: available after data and validation gates.
- Testnet/live execution: **disabled**.

Passing tests and database migrations prove engineering consistency. They do not prove positive expectancy.

## Verification

```bash
npm ci
npm run check
npm run build
```

The root GitHub Actions workflow additionally starts PostgreSQL and executes every migration with `ON_ERROR_STOP`.

## Main documentation

- [Phase 3 quantitative research platform](docs/phase3-quantitative-research-platform.md)
- [Derivatives strategy refactor and validation audit](docs/derivatives-strategy-refactor.md)

## Major modules

- `src/data` — canonical market records, integrity checks, pagination, and gap recovery.
- `src/clients/okx` — normalized OKX public clients.
- `src/storage` and `db/migrations` — PostgreSQL persistence contracts and schema.
- `src/features` — timestamp-bounded feature engineering and importance.
- `src/strategy` and `src/research` — strategy laboratory, walk-forward optimization, validation, ablation, and comparison.
- `src/portfolio` and `src/risk` — portfolio allocation and risk controls.
- `src/backtest` and `src/paper` — depth-aware execution and paper trading.
- `src/analytics` — CLI and optional web analytics.

## Evidence required before promotion

A candidate must pass corrected dataset integrity, independent-episode analysis, purged walk-forward testing, higher-cost stress, an untouched final holdout, and prolonged realistic paper execution. No strategy should be promoted merely because it has a higher in-sample win rate or leaderboard score.
