# EMA Trend Primary Strategy

## Decision

The previous whale/order-book entry logic is no longer the primary paper-entry strategy.

The canonical primary strategy is now `ema-trend-v1`: a rules-based EMA crossover strategy using confirmed candles, a slow-EMA trend filter, RSI confirmation, ATR volatility filtering, fixed one-percent account risk, and a minimum 1:2 reward/risk plan.

The existing whale detector, whale baseline, and derivatives-flow strategy are retained only where they are still needed for telemetry, historical research, regression tests, and frozen baseline comparison. They are not selected by `createPrimaryStrategyLaboratory()`.

No profitability claim is made for the replacement strategy. The change replaces a weak and complex entry hypothesis with a simpler baseline that is easier to falsify, backtest, stress, and improve.

## Why EMA crossover

EMA 20/50 was chosen because it has fewer interacting assumptions than the previous whale/flow confirmation stack and is easier to audit than a multi-indicator or adaptive strategy.

The strategy intentionally avoids selecting the apparently best historical performer. Its purpose is to create a conservative, reproducible baseline with explicit rules and a small parameter surface.

## Entry rules

Only confirmed candles are eligible. The default configuration uses 1-minute candles because that is the existing live candle stream, but the strategy itself accepts any correctly ordered confirmed candle series.

### Long

A long signal requires all of the following:

1. The previous fast EMA is less than or equal to the previous slow EMA.
2. The current fast EMA is greater than the current slow EMA.
3. The current close is above the slow EMA.
4. The slow EMA slope over the configured lookback is positive.
5. RSI is between the configured long minimum and maximum.
6. ATR percentage is at or above the configured minimum-volatility threshold.
7. There is no existing position for the same instrument.
8. There is no other open LONG position.
9. Account equity is positive and finite.

### Short

A short signal uses the exact symmetric rules:

1. The previous fast EMA is greater than or equal to the previous slow EMA.
2. The current fast EMA is below the current slow EMA.
3. The current close is below the slow EMA.
4. The slow EMA slope is negative.
5. RSI is inside the configured short range.
6. ATR percentage passes the same low-volatility filter.
7. There is no existing position for the same instrument.
8. There is no other open SHORT position.
9. Account equity is valid.

The strategy requires a **fresh crossover**. A fast EMA that merely remains above or below the slow EMA does not repeatedly generate entries.

## Risk sizing

Risk per trade is fixed at exactly **1% of account equity**.

The stop distance is:

```text
max(configured stop-loss %, ATR % × ATR multiplier)
```

The position notional is then solved from that stop distance:

```text
risk amount = account equity × 1%
position notional = risk amount / stop distance fraction
```

A full planned stop therefore risks approximately one percent before fees and slippage. Exchange contract rounding, partial fills, fees, depth, slippage, leverage, and portfolio exposure remain the responsibility of the existing paper execution and risk layers.

## Take profit and reward/risk

The target distance is:

```text
max(configured take-profit %, actual stop distance × minimum reward/risk)
```

The configuration validator requires the minimum reward/risk ratio to be at least **2.0** and also rejects a static take-profit setting that is below 2R relative to the configured stop.

If ATR widens the real stop beyond the configured percentage, the target expands automatically so the trade plan does not silently fall below 1:2.

## Exit rules

An open strategy position exits on the first applicable rule:

1. Stop loss.
2. Take profit.
3. Optional ATR trailing stop.
4. Opposite EMA crossover at a confirmed candle close.

For OHLC-only evaluation, if the same candle touches both an adverse stop and the favorable target, the implementation conservatively assumes the stop occurred first because intrabar path ordering is unknown.

The trailing stop is ratcheted only **after** evaluating the current candle. This prevents using the current candle's future high or low to create a trailing stop that is then claimed to have been hit earlier in the same candle.

## Default configuration

`src/config/strategyConfig.ts` defines the primary defaults:

- Fast EMA: 20
- Slow EMA: 50
- RSI period: 14
- ATR period: 14
- Minimum ATR percent: 0.25%
- ATR stop multiplier: 1.5
- Static stop-loss floor: 1%
- Static take-profit floor: 2%
- Slow EMA slope lookback: 3 observations
- Long RSI range: 50–70
- Short RSI range: 30–50
- Risk per trade: exactly 1%
- Minimum reward/risk: 2.0
- Trailing stop: enabled
- Trailing ATR multiplier: 1.5

These values are conventional defaults, not optimized results.

## Paper trading integration

`src/paper/EmaTrendPaperAdapter.ts` converts an approved EMA entry plan into the existing `PaperOrderIntent` contract and converts exit decisions into reduce-only paper exit intents.

The adapter does not call live exchange order endpoints. Existing paper execution continues to handle:

- contract normalization;
- minimum contract size;
- order-book freshness;
- simulated market depth;
- partial fills;
- fees;
- slippage;
- latency;
- retry behavior.

## Whale detector status

The order-book whale detector is **not used as an entry condition** by `ema-trend-v1`.

It remains in the repository because it still supports:

- historical baseline reconstruction;
- detector telemetry;
- research comparisons;
- previously collected evidence compatibility;
- whale/order-book diagnostics and regression tests.

Deleting those modules would break historical reproducibility without improving the new strategy. They should be removed later only if the research baseline and telemetry are intentionally retired.

## Validation expectations

This change should be judged first as an engineering replacement, not as proof of edge.

Before any claim of profitability, the strategy still needs the repository's existing process:

1. corrected point-in-time data;
2. purged walk-forward evaluation;
3. realistic fees, funding, spread, depth, slippage, missed fills, and latency;
4. multiple instruments and regimes;
5. parameter-neighborhood stability;
6. frozen one-time holdout;
7. prolonged reconciled paper trading;
8. prolonged shadow evaluation;
9. paired statistical comparison against the frozen whale baseline.

## Future improvements

Highest-value improvements after enough real evidence exists:

1. Test the same rules on a slower entry timeframe rather than adding indicators.
2. Add a higher-timeframe EMA trend filter only if it improves independent out-of-sample stability.
3. Replace fixed RSI bands only if paired ablation shows they contribute independently.
4. Evaluate time-based exits for stale trades.
5. Add spread/funding/event filters only when their benefit survives familywise-corrected ablation.
6. Evaluate volatility-normalized portfolio allocation after single-strategy expectancy is established.
7. Do not add machine learning until the simple baseline has enough independent episodes to justify greater complexity.
