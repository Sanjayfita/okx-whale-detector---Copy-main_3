# Derivatives strategy refactor audit

## Executive decision

The repository must not claim that it has a profitable strategy yet. It contains a substantial research and evidence framework, but no corrected real historical evidence dataset is committed and the supplied negative baseline cannot be reproduced from the repository. The correct engineering response is therefore to keep execution disabled, enforce a derivatives-only data population, collect the missing derivatives-native variables, and compare explicit strategy candidates under purged walk-forward validation.

This change set establishes that foundation, implements a research-only derivatives flow strategy candidate, adds professional risk and trade-management components, and keeps every new decision explicitly blocked from live execution.

## Detected problems

1. **Scope contradiction.** The default required watchlist used spot instruments even though the intended product is futures and perpetual futures.
2. **Wrong market population.** Dynamic discovery queried both spot and swap markets, so research observations could mix structurally different products, costs, position mechanics, and contract-size semantics.
3. **Whale walls are an event source, not proven alpha.** Displayed liquidity can be cancelled, moved, layered, or spoofed. Persistence and size scores measure the appearance of a wall; they do not establish directional expectancy.
4. **Missing derivatives-native state.** The original alpha feature catalog had trend, structure, trade-flow, order-book, volatility, value, momentum, session, and whale-lifecycle features, but not open-interest change, funding-rate state/change, liquidation flow, basis, mark/index dislocation, or contract-specific execution constraints.
5. **Simplified execution model.** The cost-adjusted paper evaluator subtracts fixed fee, slippage, and delay assumptions from average horizon returns. It is useful as a first diagnostic but is not a fill-level trade simulator and does not model depth, partial fills, funding, leverage, liquidation, tick/lot size, or observation-specific spread.
6. **Static-horizon bias.** Average returns at fixed future horizons do not prove that a realistic stop and target could have been executed in that order. The repository correctly treats missing intrapath ordering as ambiguous, but richer path data is still required.
7. **Overtrading risk.** Repeated alerts from the same market move are dependent. The non-overlapping episode policy is the correct basis for sample-size and uncertainty calculations; raw alert counts must not be treated as independent trades.
8. **Unvalidated external gating.** Cross-market or external signals must remain candidate features, not determine the empirical population, unless their incremental cost-adjusted value is proven out of sample.
9. **Incomplete operational risk controls.** Existing research sizing covered fixed risk and portfolio/correlation caps, but the proposed trading path also needed daily loss, maximum drawdown, consecutive-loss, stale-data, liquidation-buffer, spread, and exchange-minimum gates.
10. **Repository packaging issue.** The application is nested one directory below the repository root, while the original workflows are nested with it. GitHub therefore did not discover those workflows. A root workflow is included in this change set.

## Why the original strategy likely lost money

The supplied baseline reports a very low win rate and negative expectancy, but its raw observations and exact rules are absent, so the causes cannot be measured or ranked from this repository alone. The strongest mechanism-level explanation is that visible whale liquidity was treated too directly as directional information. A large wall can attract price, repel price, disappear before contact, or represent inventory management rather than informed directional intent. Entries derived before execution confirmation are therefore noisy and vulnerable to spoofing.

The fixed-horizon outcome design also allows poor practical timing: a signal can move favorably first and then reverse, hit an adverse excursion before the terminal observation, or require more slippage than the fixed assumption. Repeated alerts during one move can amplify apparent activity and produce overtrading after costs.

These are hypotheses to test, not retrospective profitability claims.

## Implemented strategy candidate

The new `DerivativesFlowStrategy` is deliberately a **candidate for empirical research**, not an enabled trading system. A decision can be marked `QUALIFIED_FOR_RESEARCH`, but `liveExecutionAllowed` is always `false`.

### Hard market gates

The candidate rejects a setup before scoring when any of these conditions are present:

- no directional structure event or a range regime;
- spread above policy;
- excessive mark/index basis dislocation;
- volatility outside the configured band;
- weak trend efficiency;
- inadequate relative volume;
- directionally adverse funding.

### Required directional evidence

A setup then evaluates:

- market-structure break or sweep-and-reclaim;
- trend alignment and efficiency;
- relative volume;
- aggressive market-order delta;
- CVD slope;
- open-interest expansion with price moving in the proposed direction;
- order-book imbalance;
- liquidation imbalance;
- VWAP location;
- optional whale authenticity and directional alignment.

Aggressive delta/CVD and open-interest expansion are mandatory core confirmations. This is intended to reject apparent breakouts caused primarily by position closing, thin liquidity, or displayed walls without executed flow.

Whale evidence is optional by default. It can only become mandatory through a frozen research policy, and then it must include an authenticity estimate rather than wall size alone.

## Implemented risk management

The new `ProfessionalRiskManager` is a pure, deterministic paper-research gate. It implements:

- fixed fractional risk per trade;
- volatility-scaled risk reduction;
- stop-distance-based contract sizing;
- maximum trade risk;
- maximum portfolio and correlation-group risk;
- maximum notional-to-equity and leverage caps;
- maximum daily loss circuit breaker;
- maximum drawdown circuit breaker;
- consecutive-loss circuit breaker;
- stale-market-data rejection;
- spread and expected-move-versus-cost filters;
- liquidation-distance safety buffer;
- exchange lot-size and minimum-contract enforcement.

It returns `APPROVED_FOR_PAPER_RESEARCH` only. Live order execution remains impossible through this component.

## Implemented trade management

The new `AtrTradeManagement` candidate implements deterministic research decisions for:

- ATR initial stops;
- structure-based stop tightening;
- cost-buffered break-even activation after a configurable R multiple;
- partial take profit at a configurable R multiple;
- ATR trailing stops that can only tighten risk;
- full exit on market-structure invalidation;
- full exit when aggressive delta and CVD reverse after sufficient favorable progress.

This logic still requires path-ordered, executable-price data before it can be compared fairly with fixed-horizon or alternative exit policies.

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
- profit factor above 1 with uncertainty not driven by a few outliers;
- positive discovery and untouched final-holdout expectancy;
- stability across purged walk-forward windows;
- adequate independent episodes, instruments, and regimes;
- acceptable maximum drawdown, downside deviation, and turnover;
- robustness to nearby parameter values and higher-cost stress tests;
- no leakage, timestamp ambiguity, or population selection by future information;
- successful paper execution with realistic fills before any testnet proposal.

## Architectural decisions in this change set

- Application symbol profiles are derivatives only.
- Required symbols are USDT perpetual futures.
- Dynamic market discovery queries perpetual and expiry futures only.
- Instrument metadata rejects spot, margin, options, inverse contracts, non-USDT settlement, and malformed contract values.
- Legacy spot records remain representable only for historical replay and audit compatibility; new live collection is derivatives only.
- Default in-memory instruments are swaps rather than spot placeholders.
- A versioned derivatives-native snapshot contract contains open interest, funding, liquidation, mark/index basis, executed flow, structure, and optional whale-authenticity fields.
- Strategy, risk, and exit logic are separate deterministic modules.
- Every new strategy/risk/exit output explicitly disables live execution.
- A root GitHub Actions workflow runs checks from the nested project directory.
- Regression tests cover derivatives scope, contract metadata, strategy qualification/rejection, risk sizing/circuit breakers, and ATR/structure exits.

## Performance changes

No trading-performance improvement is claimed without historical evidence. Engineering performance is protected by keeping the new components pure and bounded: they use fixed-size point-in-time records, do not perform network I/O, do not scan unbounded history, and are independently testable.

## Deleted files

None. Existing chronology, evidence-integrity, path-ordering, walk-forward, uncertainty, and replay modules remain useful. Deleting them would reduce scientific validity. Spot support was removed from new live configuration and discovery rather than deleting legacy record readers that may be needed to audit prior datasets.

## New files

- `.github/workflows/ci.yml`
- `src/derivatives/DerivativeMarketSnapshot.ts`
- `src/strategy/DerivativesFlowStrategy.ts`
- `src/strategy/AtrTradeManagement.ts`
- `src/risk/ProfessionalRiskManager.ts`
- `test/DerivativesOnlyScope.test.ts`
- `test/DerivativesFlowStrategy.test.ts`
- `test/ProfessionalRiskManager.test.ts`
- `test/AtrTradeManagement.test.ts`
- `docs/derivatives-strategy-refactor.md`

## Migration instructions

1. Treat existing spot observations as a legacy population; do not combine them with the new derivatives evaluation.
2. Install dependencies with `npm ci` from `okx-whale-detector---Copy-main`.
3. Run `npm run check` and `npm run build` before collection.
4. Start a new evaluation ID from the frozen derivatives-only commit.
5. Record instrument metadata and every derivatives-native input listed above at event time.
6. Keep the current strategy as the baseline candidate and evaluate the flow-confirmed candidate separately.
7. Freeze thresholds before the final holdout is viewed.
8. Do not authorize live or testnet order submission from a research qualification result.

## Next implementation sequence

1. Add OKX collectors and immutable event records for open interest, funding, mark/index price, and liquidation flow.
2. Connect those records to the derivatives-native snapshot contract using event-time freshness rules.
3. Add observation-specific execution-cost and depth-aware fill simulation.
4. Register the flow-confirmed strategy in the existing candidate-comparison pipeline.
5. Add embargoed, purged walk-forward comparison of the entry, risk, and exit policies.
6. Collect a new derivatives-only evaluation from a frozen commit across multiple instruments and regimes.
7. Run one untouched final holdout and higher-cost stress tests.
8. Keep order execution disabled until the final empirical and operational review passes.
