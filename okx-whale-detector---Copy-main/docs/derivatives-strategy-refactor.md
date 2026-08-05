# Derivatives strategy refactor audit

## Executive decision

The repository must not claim that it has a profitable strategy yet. It contains a substantial research and evidence framework, but no corrected real historical evidence dataset is committed and the supplied negative baseline cannot be reproduced from the repository. The correct engineering response is therefore to keep execution disabled, enforce a derivatives-only data population, collect the missing derivatives-native variables, and compare explicit strategy candidates under purged walk-forward validation.

This change set begins that migration by making the application watchlist and market-discovery domain futures-only (`SWAP` and `FUTURES`).

## Detected problems

1. **Scope contradiction.** The default required watchlist used spot instruments even though the intended product is futures and perpetual futures.
2. **Wrong market population.** Dynamic discovery queried both spot and swap markets, so research observations could mix structurally different products, costs, position mechanics, and contract-size semantics.
3. **Whale walls are the event generator, not proven alpha.** Displayed liquidity can be cancelled, moved, layered, or spoofed. Persistence and size scores measure the appearance of a wall; they do not establish directional expectancy.
4. **Missing derivatives-native state.** The current alpha feature catalog has trend, structure, trade-flow, order-book, volatility, value, momentum, session, and whale-lifecycle features, but not open-interest change, funding-rate state/change, liquidation flow, basis, mark/index dislocation, or contract-specific execution constraints.
5. **Simplified execution model.** The cost-adjusted paper evaluator subtracts fixed fee, slippage, and delay assumptions from average horizon returns. It is useful as a first diagnostic but is not a fill-level trade simulator and does not model depth, partial fills, funding, leverage, liquidation, tick/lot size, or observation-specific spread.
6. **Static-horizon bias.** Average returns at fixed future horizons do not prove that a realistic stop and target could have been executed in that order. The repository correctly treats missing intrapath ordering as ambiguous, but richer path data is still required.
7. **Overtrading risk.** Repeated alerts from the same market move are dependent. The non-overlapping episode policy is the correct basis for sample-size and uncertainty calculations; raw alert counts must not be treated as independent trades.
8. **Unvalidated external gating.** Cross-market or external signals must remain candidate features, not determine the empirical population, unless their incremental cost-adjusted value is proven out of sample.
9. **Repository packaging issue.** The application is nested one directory below the repository root, while the original workflows are nested with it. GitHub therefore does not discover those workflows. A root workflow is added in this change set.

## Why the original strategy likely lost money

The supplied baseline reports a very low win rate and negative expectancy, but its raw observations and exact rules are absent, so the causes cannot be measured or ranked from this repository alone. The strongest mechanism-level explanation is that visible whale liquidity was treated too directly as directional information. A large wall can attract price, repel price, disappear before contact, or represent inventory management rather than informed directional intent. Entries derived before execution confirmation are therefore noisy and vulnerable to spoofing.

The fixed-horizon outcome design also allows poor practical timing: a signal can move favorably first and then reverse, hit an adverse excursion before the terminal observation, or require more slippage than the fixed assumption. Repeated alerts during one move can amplify apparent activity and produce overtrading after costs.

These are hypotheses to test, not retrospective profitability claims.

## Target strategy architecture

### Event population

Use a broad, reproducible derivatives-native event population. A whale event may remain one event source, but it must not be assumed to be alpha and must not require an external confirmation to enter the research dataset.

### Candidate confirmations

Evaluate confirmations individually and in small pre-registered combinations:

- aggressive trade delta and CVD acceleration;
- open-interest level and change aligned with price direction;
- liquidation clusters and post-liquidation absorption;
- funding level, funding change, and distance from historical percentiles;
- order-book imbalance and microprice displacement;
- liquidity sweep followed by market-structure recovery or break;
- trend efficiency, EMA alignment, ADX, and multi-timeframe structure;
- VWAP/anchored-VWAP displacement and reversion/continuation context;
- whale authenticity features such as execution ratio, refill behavior, cancellation timing, and distance from touch.

Do not enable all confirmations at once. Every feature increases the multiple-testing burden and can reduce coverage.

### Entry candidate

A defensible first candidate is a **derivatives flow-confirmed structure strategy**:

1. synchronized, uncrossed, sufficiently fresh order book;
2. acceptable spread and 24-hour liquidity;
3. directional structure event such as a sweep-and-reclaim or break-and-retest;
4. aggressive delta/CVD confirmation;
5. open-interest confirmation that distinguishes new positioning from position closing;
6. no extreme adverse funding or liquidation-risk condition;
7. optional whale authenticity confirmation, never wall size alone.

The exact thresholds must be frozen before the final holdout is viewed.

### Exit candidates

Compare rather than assume:

- ATR initial stop beyond invalidation structure;
- partial profit at a fixed R multiple with the remainder trailed by ATR or structure;
- break-even only after costs and a minimum favorable excursion buffer;
- time stop when expected edge decays;
- delta/OI exhaustion exit;
- liquidation or spread shock emergency exit.

Path ordering and executable prices are required for valid comparison.

### Risk controls

The production proposal must include:

- fixed fractional risk per trade;
- volatility-targeted notional with exchange min/lot/tick constraints;
- maximum position fraction and leverage cap;
- maximum concurrent risk and correlation-group risk;
- maximum daily loss and maximum drawdown circuit breakers;
- consecutive-loss pause;
- stale-data, spread, depth, and volatility kill switches;
- funding and liquidation-price checks before entry;
- no live execution unless all empirical and operational gates pass.

## Required additional data

Collect event-time and path data for each candidate instrument:

- public trades with aggressor side;
- synchronized depth snapshots/updates;
- confirmed candles at all research timeframes;
- open interest and open-interest history/change;
- current and historical funding rates;
- liquidation orders or a validated liquidation proxy;
- mark price, index price, and basis;
- tick size, lot size, minimum size, contract value, and settlement metadata;
- spread/depth-based executable entry and exit estimates;
- high-frequency path samples sufficient to order stop/target barrier hits.

## Validation gates

A candidate cannot be promoted because it improves win rate. Require all of the following:

- positive net expectancy after observation-specific costs;
- profit factor above 1 with a confidence interval that is not driven by a few outliers;
- positive discovery and untouched final-holdout expectancy;
- stability across purged walk-forward windows;
- adequate independent episodes, instruments, and regimes;
- acceptable maximum drawdown, downside deviation, and turnover;
- robustness to nearby parameter values and higher-cost stress tests;
- no leakage, timestamp ambiguity, or population selection by future information;
- successful paper execution with realistic fills before any testnet proposal.

## Architectural decisions in this change set

- Application market instruments are now typed as derivatives only.
- Required symbols are perpetual futures.
- Dynamic market discovery queries perpetual and expiry futures only.
- Instrument metadata rejects spot, margin, options, inverse contracts, non-USDT settlement, and malformed contract values.
- Default in-memory instruments are swaps rather than spot placeholders.
- A root GitHub Actions workflow runs checks from the nested project directory.
- A derivatives-scope regression test covers configuration and contract metadata.

## Deleted files

None in this first migration. Deletion should follow measured dependency analysis rather than removing research modules that already provide valid chronology, integrity, and uncertainty controls.

## New files

- `.github/workflows/ci.yml`
- `test/DerivativesOnlyScope.test.ts`
- `docs/derivatives-strategy-refactor.md`

## Next implementation sequence

1. Make the derivatives-only branch compile and pass the complete suite.
2. Add versioned event-time open-interest, funding, mark/index, and liquidation records.
3. Extend the frozen snapshot schema and feature registry without enabling production features.
4. Add observation-specific execution-cost and fill simulation.
5. Register a small number of explicit strategy candidates.
6. Collect a new derivatives-only evaluation from a frozen commit.
7. Compare candidates with purged walk-forward discovery and one untouched final holdout.
8. Keep order execution disabled until the final empirical and operational review passes.
