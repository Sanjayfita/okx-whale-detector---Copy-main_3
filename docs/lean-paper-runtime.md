# Lean local paper-trading runtime

## Default startup

```sh
npm run start
```

Normal local startup is intentionally lean. It starts:

- trading dashboard/API;
- dedicated OKX candle WebSocket for the selected timeframe;
- EMA strategy evaluation;
- paper ledger/state persistence;
- a minimal OKX order-book runtime used only for realistic paper fills, slippage and protective exits;
- periodic process-memory reporting.

It does **not** start the established whale/research application runtime, market discovery, `MarketState` whale engines, market-data recorder/recording queue, or Polymarket runtime.

Docker/PostgreSQL is also opt-in and is not required for normal paper trading.

## Research opt-in

```sh
npm run start -- --with-research
```

This keeps the same paper platform and dedicated strategy candle feed, then starts the existing `createAppRuntime()` research/whale stack. Research functionality is preserved; it is simply no longer part of normal paper startup.

Database services remain a separate switch:

```sh
npm run start -- --with-research --with-database
```

## Strategy diagnostics

The EMA evaluator is the source of truth for both trading decisions and dashboard diagnostics. The dashboard exposes:

- current strategy state (`WAIT`, `ENTRY_READY`, `IN_POSITION`, `EXIT_READY`);
- fresh EMA crossover status;
- price/slow-EMA trend alignment;
- RSI filter status;
- ATR volatility filter status;
- whether an existing position blocks a new entry;
- primary blocking reason;
- bounded counters for each blocker and successful entry-ready evaluations.

The entry thresholds and EMA/RSI/ATR rules were not loosened to create more trades.

## Memory hardening

Two separate sources of unnecessary growth were addressed:

1. Normal startup no longer instantiates the full research/whale/recording runtime unless `--with-research` is explicit.
2. `PaperAccountLedger.snapshot()` is read-only with respect to the equity curve. Previously every dashboard/account snapshot appended another equity point. Because every subsequent platform snapshot included the complete curve, this created an unbounded structure and progressively larger JSON allocations. Equity marks are now sampled at a bounded cadence, trade/funding lifecycle points are retained immediately, and the curve has a hard maximum of 50,000 points.

Process memory is reported once per minute by default:

```text
[MEMORY] rss=...MB heapUsed=...MB heapTotal=...MB external=...MB arrayBuffers=...MB
```

The interval can be changed with `PROCESS_MEMORY_REPORT_INTERVAL_MS`.

## Validation boundary

Unit/integration/CI checks can prove startup separation, diagnostics consistency, bounded equity-history behavior and builds. They cannot prove that the previous approximately 30-minute heap failure is eliminated under the user's exact Windows/network workload. After pulling the final green commit, run normal lean mode for materially longer than the old failure window and inspect the memory series. A stable/oscillating heap after garbage collection is evidence of improvement; monotonically increasing heap would require another heap/profile investigation.
