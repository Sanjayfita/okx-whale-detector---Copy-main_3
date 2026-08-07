# Adding a Strategy

The trading platform supports multiple strategies through a small TypeScript contract. The EMA Trend Strategy remains the default until another strategy is independently researched and explicitly selected.

## 1. Create a strategy folder

Use one folder per strategy:

```text
src/strategies/
  emaTrend/
    EmaTrendTradingStrategy.ts
  supertrend/
    SupertrendTradingStrategy.ts
  donchian/
    DonchianTradingStrategy.ts
  bollinger/
    BollingerTradingStrategy.ts
```

Do not put exchange credentials, HTTP calls, database writes, or order submission inside a strategy.

## 2. Implement `TradingStrategy`

Import the contract from:

```ts
import type {
  StrategyContext,
  StrategySignalResult,
  TradingStrategy,
} from '../TradingStrategy';
```

A strategy must implement:

```ts
export class ExampleStrategy implements TradingStrategy {
  public readonly id = 'example-v1';
  public readonly label = 'Example Strategy';

  public generateSignal(context: StrategyContext): StrategySignalResult {
    // Evaluate only information available in context.
    // Return BUY, SELL, WAIT, or EXIT with explicit reasons.
    throw new Error('implement');
  }

  public calculateStop(context: StrategyContext): number | null {
    // Return the protective stop implied by the same rules.
    throw new Error('implement');
  }

  public calculateTakeProfit(context: StrategyContext): number | null {
    // Return the target implied by the same rules.
    throw new Error('implement');
  }

  public calculatePositionSize(context: StrategyContext): number {
    // Return a requested size. The shared risk manager still has final authority.
    throw new Error('implement');
  }
}
```

Every `StrategySignalResult` must include:

- stable strategy ID;
- exact `instrumentId`;
- action and direction;
- decision timestamp;
- human-readable reasons;
- entry / stop / target / trail when applicable;
- requested position size and risk amount;
- indicators needed for dashboard explanation;
- `liveExecutionAllowed: false`.

## 3. Keep strategy logic pure

A strategy should answer:

> Given this point-in-time context, what trade intent does this rule set produce?

It should not answer:

> How do I send the order to OKX?

The separation is intentional:

```text
Strategy
  -> intent
  -> TradingRiskManager
  -> paper/execution simulator
  -> PaperAccountLedger
  -> notification + dashboard
```

A new strategy therefore cannot bypass:

- 1% maximum per-trade risk;
- daily loss limit;
- maximum drawdown block;
- maximum leverage;
- trade-count limit;
- open-position limit;
- cooldown;
- circuit breaker;
- kill switch;
- live-execution disablement.

## 4. Register the strategy

Add the implementation to `src/strategies/StrategyRegistry.ts`.

For example:

```ts
new StrategyRegistry(
  [
    new EmaTrendTradingStrategy(),
    new ExampleStrategy(),
  ],
  'ema-trend-crossover-v1',
);
```

Keep EMA as the default unless a separate evidence/release decision changes that policy.

The dashboard reads `StrategyRegistry.list()`, so a registered strategy automatically appears in the strategy selector. No browser code change should be required simply to add an option.

## 5. Add configuration without creating hidden parameters

Prefer one typed configuration object with validation. Every tunable value should be:

- named;
- bounded;
- serializable;
- included in experiment fingerprints;
- visible in documentation;
- tested.

Do not hide arbitrary constants inside signal code simply to improve a backtest.

## 6. Add tests before comparison

At minimum test:

1. long entry;
2. short entry;
3. WAIT conditions;
4. stop calculation;
5. target calculation;
6. position sizing;
7. insufficient history;
8. stale/unconfirmed data handling when relevant;
9. no duplicate entry when a position already exists;
10. explicit reasons for every decision.

Then add integration tests showing that the shared risk manager can block the strategy.

## 7. Validate through the same research pipeline

A strategy appearing in the dashboard does not make it validated.

Use the same process for every candidate:

1. immutable point-in-time data;
2. bounded candidate family;
3. episode-safe purged walk-forward analysis;
4. complete opportunity universe including no-trade outcomes;
5. cost-aware execution simulation;
6. funding/spread/slippage/depth/latency stress;
7. multiple-testing-corrected paired significance;
8. regime stability;
9. execution Monte Carlo;
10. one untouched final holdout;
11. prolonged paper and shadow trading.

Do not select a strategy only because it has the highest in-sample return or win rate.

## 8. Strategy selection from the dashboard

The Settings page sends:

```json
{
  "activeStrategyId": "example-v1"
}
```

The backend validates that the ID exists and switches the registry. Unknown IDs are rejected.

For reproducible research, save the exact active strategy ID and configuration with every formal experiment manifest rather than relying on mutable dashboard state.

## 9. Live execution remains separate

Implementing and selecting a strategy does not enable exchange orders. The current platform's LIVE selector is monitoring-only. Any future real-order adapter must remain behind the repository's independent empirical release and operational safety gates.
