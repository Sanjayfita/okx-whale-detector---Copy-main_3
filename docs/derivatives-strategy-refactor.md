# Derivatives strategy refactor and validation audit

## Executive decision

The repository must not claim that it has a profitable strategy yet. It contains a substantial research and evidence framework, but it still does not contain the corrected real derivatives dataset required to reproduce the reported negative baseline or validate the replacement strategy.

Phase 1 established a derivatives-only research foundation. Phase 2 adds the missing event-time synchronization, execution simulation, performance reporting, purged walk-forward planning, anti-overfitting promotion gates, and feature-ablation controls. Live execution remains disabled by design.

The correct status is therefore:

- engineering and research infrastructure: substantially improved;
- strategy profitability: unvalidated;
- paper promotion: blocked until real out-of-sample evidence exists;
- live trading: prohibited.

## Audit findings

1. **Scope contradiction.** The original required watchlist and discovery logic included spot instruments despite the intended futures/perpetual scope.
2. **Mixed product populations.** Spot, perpetual, and expiry-futures observations cannot share one performance population because their costs, sizing, funding, and liquidation mechanics differ.
3. **Whale walls are not proven alpha.** Displayed liquidity may be cancelled, layered, moved, spoofed, or used for inventory management. Wall size alone is not directional evidence.
4. **Missing derivatives-native state.** Open interest, funding, liquidations, mark/index basis, executed flow, and contract metadata were not represented together in one synchronized point-in-time record.
5. **Potential timestamp leakage.** Independently collected features require explicit age, future-skew, and cross-source-skew rules before they can be used in a strategy decision.
6. **Unrealistic execution assumptions.** Fixed slippage and fee deductions do not represent depth walking, partial fills, spread, latency, funding, leverage, or liquidation.
7. **Static-horizon bias.** Terminal returns do not establish whether a stop or target was executable first. Path-ordered data remains required.
8. **Dependent alert inflation.** Repeated alerts from the same market move must be aggregated into independent episodes.
9. **Overfitting risk.** Adding many indicators and selecting the best in-sample combination creates a multiple-testing problem.
10. **Incomplete operational controls.** Strategy qualification must remain separate from sizing, portfolio risk, circuit breakers, and execution readiness.
11. **Repository packaging.** The application is nested below the repository root. A root workflow is required for GitHub Actions discovery.
12. **Legacy schema debt.** Some historical evidence readers may still assume older SPOT/SWAP taxonomies. New derivative records must be versioned and FUTURES acceptance must be verified before expiry-futures evidence is persisted.

## Product scope

New live collection and market discovery are restricted to OKX:

- `SWAP` for perpetual futures;
- `FUTURES` for expiry futures.

Spot, margin, options, inverse contracts, non-USDT settlement, and malformed contract metadata are rejected from the new live population. Legacy spot records remain readable only for historical audit and must never be mixed with the derivatives evaluation.

## Strategy status

`DerivativesFlowStrategy` remains Version 1 and remains a research candidate. It is not promoted simply because Phase 2 adds more infrastructure.

### Current hard gates

The strategy rejects:

- range/no-structure conditions;
- excessive spread;
- excessive mark/index basis dislocation;
- volatility outside the frozen band;
- weak trend efficiency;
- insufficient relative volume;
- directionally adverse funding.

### Current directional evidence

The candidate evaluates:

- break or sweep-and-reclaim structure;
- trend alignment and efficiency;
- relative volume;
- aggressive order-flow delta;
- CVD slope;
- open-interest expansion aligned with price direction;
- order-book imbalance;
- liquidation imbalance;
- VWAP location;
- optional whale authenticity and directional alignment.

Aggressive flow and open-interest confirmation are mandatory. Whale evidence is optional by default and never relies on wall size alone.

### Why no extra indicator was promoted in Phase 2

Multi-timeframe filters, ADX, Choppiness Index, volume profile, fair-value gaps, change of character, session filters, divergence, absorption, and other proposed features may be reasonable candidates, but no corrected historical dataset exists to show incremental out-of-sample benefit.

Adding them directly would increase complexity and overfitting risk. Phase 2 instead adds a paired, episode-level bootstrap ablation gate. A feature may enter a frozen candidate only when its incremental cost-adjusted PnL has a positive confidence interval and adequate independent episodes. It must then pass walk-forward, cost-stress, parameter-neighborhood, and final-holdout validation.

## Event-time derivatives synchronization

`DerivativeEventSynchronizer` combines immutable point-in-time sources for:

- order book;
- mark and index price;
- open interest and price change;
- funding;
- aggressive flow, CVD, and book imbalance;
- liquidation imbalance;
- technical/structure state;
- optional whale evidence.

It rejects:

- invalid timestamps;
- source records from the future beyond tolerance;
- stale records;
- excessive cross-source timestamp skew;
- invalid final snapshots such as crossed books.

Every result sets `liveExecutionAllowed` to `false`.

## Execution and backtesting

`ExecutionSimulator` adds deterministic research modeling for:

- bid/ask depth walking;
- volume-weighted average fill price;
- configurable participation limits;
- partial and insufficient fills;
- spread and slippage measurement;
- adverse latency drift;
- taker fees;
- funding payments/receipts;
- leverage and initial margin;
- approximate isolated liquidation price;
- liquidation crossing from path high/low.

The liquidation formula is intentionally conservative and approximate. It is not a replacement for OKX tiered maintenance-margin, fee, and liquidation-engine rules. Production readiness requires exchange-exact calculations for each contract and account mode.

`BacktestStatistics` reports:

- profit factor;
- win rate;
- gross and net profit;
- expectancy;
- average R;
- Sharpe ratio;
- Sortino ratio;
- maximum drawdown;
- recovery factor;
- average holding time;
- fees and funding;
- equity curve.

Undefined ratios are returned as `null` rather than fabricated or represented as misleading infinity values.

## Walk-forward and overfitting controls

`PurgedWalkForward` constructs rolling or anchored folds with:

- chronological ordering;
- time-based purge windows;
- embargo windows;
- removal of episode overlap between train and test;
- an untouched final holdout excluded from every discovery fold.

`StrategyValidation` rejects candidates for:

- too few folds;
- too few out-of-sample trades;
- unstable positive-fold coverage;
- low out-of-sample profit factor;
- low or undefined Sharpe;
- excessive drawdown;
- large train-to-test performance collapse;
- failed higher-cost stress;
- unstable neighboring parameter values;
- failed or undersized final holdout.

Even a fully passing decision is only `VALIDATED_FOR_PAPER_RESEARCH`. It never authorizes live execution.

`FeatureAblation` aggregates repeated alerts into independent episodes and applies a deterministic paired bootstrap to candidate-minus-baseline PnL. A feature is accepted for the next frozen candidate only when:

- the independent episode minimum is met;
- mean improvement exceeds the frozen threshold;
- the confidence interval excludes no improvement;
- the probability of improvement exceeds policy.

## Risk and trade management

`ProfessionalRiskManager` provides:

- fixed-fractional and volatility-scaled risk;
- stop-distance contract sizing;
- lot and minimum-size constraints;
- trade, portfolio, and correlation risk caps;
- notional and leverage caps;
- daily-loss, drawdown, and consecutive-loss breakers;
- stale-data, spread, cost, and liquidation-buffer gates.

`AtrTradeManagement` provides:

- ATR initial stops;
- structure stop tightening;
- cost-buffered break-even;
- partial take profit;
- ATR trailing that only tightens;
- structure invalidation exit;
- aggressive-flow reversal exit.

These modules remain deterministic paper-research components.

## Files added in Phase 1

- `.github/workflows/ci.yml`
- `src/derivatives/DerivativeMarketSnapshot.ts`
- `src/strategy/DerivativesFlowStrategy.ts`
- `src/strategy/AtrTradeManagement.ts`
- `src/risk/ProfessionalRiskManager.ts`
- associated derivatives, risk, and exit tests.

## Files added in Phase 2

- `src/derivatives/DerivativeEventSynchronizer.ts`
- `src/backtest/ExecutionSimulator.ts`
- `src/backtest/BacktestStatistics.ts`
- `src/research/PurgedWalkForward.ts`
- `src/research/StrategyValidation.ts`
- `src/research/FeatureAblation.ts`
- `test/DerivativeEventSynchronizer.test.ts`
- `test/ExecutionSimulator.test.ts`
- `test/BacktestStatistics.test.ts`
- `test/PurgedWalkForward.test.ts`
- `test/StrategyValidation.test.ts`
- `test/FeatureAblation.test.ts`

## Deleted files

None.

Existing replay, chronology, evidence-integrity, path-ordering, statistical, and safety modules remain useful. Deleting them without a complete dependency and dataset migration would reduce auditability. Unused-file deletion should follow coverage and import analysis after the derivatives pipeline is wired end to end.

## Remaining weaknesses

1. Real event-time collectors for open interest, funding, mark/index, and liquidation data are not yet connected to persistent evidence records.
2. The repository still lacks a corrected, immutable derivatives dataset that reproduces the baseline.
3. Tick replay is supported conceptually but cannot be validated without tick/depth recordings.
4. The execution simulator does not yet model queue position, cancellations during latency, maker fills, tiered fees, ADL, insurance-fund behavior, or OKX tiered maintenance margin.
5. Funding simulation currently requires the caller to supply the applicable interval rate; historical rate schedules must be persisted.
6. Path high/low can detect a possible liquidation crossing but cannot order competing stop, target, and liquidation barriers without finer path data.
7. Existing legacy validators must be audited for full `FUTURES` schema acceptance.
8. API rate limits, retry behavior, WebSocket reconnection, alerting, and account-state reconciliation require an exchange-integration audit before testnet.
9. No feature, entry, exit, or risk parameter has yet passed a real purged walk-forward and final holdout.

## Required validation sequence

1. Freeze the current code commit and evaluation configuration.
2. Start a new derivatives-only evaluation ID.
3. Persist synchronized event-time records and contract metadata.
4. Record executable depth and path samples for entry and exit simulation.
5. Reproduce the current baseline on the corrected population.
6. Compare V1 against simpler baselines and one feature ablation at a time.
7. Run purged walk-forward discovery with episode-level independence.
8. Stress fees, spread, latency, participation, funding, and slippage.
9. Freeze the selected candidate and parameters.
10. Evaluate once on the untouched holdout.
11. Require realistic paper execution before any testnet proposal.
12. Perform an operational review of exchange precision, margin, rate limits, failures, reconnection, logging, alerting, and circuit breakers.

## Merge and release policy

This branch must remain a Draft PR while profitability and execution realism are unvalidated. Passing unit tests and CI proves engineering consistency, not positive expectancy.

Do not merge to `main`, mark ready for review, or tag a stable trading release until the corrected real dataset, purged walk-forward evaluation, higher-cost stress, untouched holdout, and paper-execution review all pass.
