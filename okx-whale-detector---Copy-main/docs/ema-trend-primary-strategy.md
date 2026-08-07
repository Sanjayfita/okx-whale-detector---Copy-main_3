# Primary trading strategy — EMA crossover with RSI and ATR filters

## Decision

The maintained primary trading strategy is now `ema-trend-crossover-v1`.

The previous whale-only and multi-confirmation derivatives-flow rules are no longer the primary entry path. They remain available only as historical research comparators so older experiments and baseline comparisons remain reproducible.

This change does **not** claim that EMA crossover trading is profitable. The purpose is to replace a poorly performing, highly specialized entry model with a simple, transparent rules-based foundation that is easier to test, falsify, and improve.

## Why this strategy

EMA crossover was selected because it is:

- simple enough to audit line by line;
- widely understood;
- deterministic;
- naturally suited to trend-following futures research;
- less dependent on fragile order-book interpretation;
- easy to evaluate across instruments, regimes, fees, and slippage;
- less prone to hidden overfitting than a large confirmation stack.

The strategy deliberately does not use whale-wall direction, whale authenticity, order-book imbalance, open interest, funding, liquidation imbalance, or external prediction markets as entry requirements.

## Entry rules

Only confirmed candles are used.

### Long

A long entry requires all of the following:

1. The fast EMA crosses from at-or-below the slow EMA to above it.
2. The latest close is above the slow EMA.
3. The slow EMA is rising.
4. RSI is between 50 and 70.
5. ATR percentage is at or above `minimumAtrPercent`.
6. ATR percentage is at or below `maximumAtrPercent`.
7. There is no existing open position for the instrument.

### Short

A short entry requires the symmetric conditions:

1. The fast EMA crosses from at-or-above the slow EMA to below it.
2. The latest close is below the slow EMA.
3. The slow EMA is falling.
4. RSI is between 30 and 50.
5. ATR percentage is within the configured volatility range.
6. There is no existing open position for the instrument.

The RSI filter confirms momentum but is not a standalone signal. The slow-EMA slope and price-location checks reduce crossover noise.

## Exit rules

An open position exits on the first applicable rule:

1. Stop loss.
2. Take profit.
3. Optional trailing stop.
4. Opposite EMA crossover.

When stop and target are both touched inside the same candle, the implementation assumes the stop occurred first. This is intentionally conservative and avoids optimistic intrabar ordering in research and paper evaluation.

## Stop loss and target

The stop distance is the larger of:

- configured `stopLossPercent` of entry price; or
- ATR × `atrMultiplier`.

The take-profit distance is the larger of:

- configured `takeProfitPercent` of entry price; or
- two times the actual stop distance.

This guarantees a planned reward/risk ratio of at least **1:2**, even when ATR widens the protective stop beyond the configured percentage.

## Risk management

The strategy caps planned loss at **1% of current account equity per trade**.

For an entry:

```text
risk amount = account equity × 0.01
position size in base units = risk amount / absolute stop distance
```

This is a strategy-level base-unit sizing calculation. Exchange lot size, contract value, leverage, fees, slippage, and minimum order constraints remain the responsibility of the existing execution/risk infrastructure.

The strategy will not create a second entry while a position is already open for the instrument. This is stricter than merely preventing multiple positions in the same direction.

## Low-volatility filter

Trades are skipped when ATR as a percentage of price falls below `minimumAtrPercent`.

A maximum ATR percentage is also enforced to avoid treating abnormal volatility as a normal crossover environment.

## Configuration

Configuration lives in:

`src/config/tradingStrategyConfig.ts`

Maintained defaults:

| Parameter | Default |
|---|---:|
| Fast EMA | 20 |
| Slow EMA | 50 |
| RSI period | 14 |
| ATR period | 14 |
| ATR multiplier | 1.5 |
| Minimum ATR % | 0.25% |
| Maximum ATR % | 5% |
| Stop-loss % | 1% |
| Take-profit % | 2% |
| Trailing stop | enabled |
| Trailing-stop % | 1% |

Configuration validation requires the fast EMA to be shorter than the slow EMA and the configured take-profit percentage to be at least twice the configured stop-loss percentage.

## Architecture impact

Preserved:

- OKX REST/WebSocket connectivity;
- order-book and candle collection;
- logging and observability;
- market-data recording;
- paper execution engine;
- shadow trading;
- PostgreSQL research evidence;
- autonomous research infrastructure;
- historical whale research evidence and baseline reproducibility;
- live-execution disablement.

Changed:

- primary strategy boundary;
- new simple strategy configuration;
- deterministic EMA/RSI/ATR indicator calculations;
- explicit entry, stop, target, trailing-stop, and position-sizing rules.

The `createPrimaryStrategyLaboratory()` factory contains only the EMA strategy. Whale and derivatives-flow adapters are labeled historical research comparators and should not be used as the maintained entry path.

## Dead-code decision

Whale detector modules were not deleted because they are still referenced by live telemetry, historical evidence, regression tests, and the original-strategy baseline. Deleting them would break research reproducibility rather than remove genuinely dead code.

If future repository audits show that a whale module is no longer referenced by runtime telemetry, stored-data compatibility, baseline reconstruction, or tests, it can then be removed independently.

## Validation requirements

This replacement should be judged by controlled evidence, not by a single backtest or win rate.

Before any promotion:

1. Reproduce the old whale baseline on the corrected discovery dataset.
2. Run the EMA strategy on the identical opportunity universe.
3. Include fees, funding, spread, slippage, latency, missed fills, and partial fills.
4. Use purged walk-forward evaluation across several liquid instruments and regimes.
5. Compare paired episode outcomes with multiple-testing correction.
6. Stress the strategy with execution Monte Carlo.
7. Freeze one configuration before holdout access.
8. Evaluate the frozen holdout once.
9. Complete prolonged reconciled paper and shadow trading.

No profitability claim should be made until those gates are satisfied.
