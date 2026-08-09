# Phase 11 — Persistent Paper Trading and Restart Reconciliation

## Scope

Phase 11 makes the existing `ema-trend-crossover-v1` paper account durable and auditable. It does not change EMA, RSI, ATR, entry/exit rules, position sizing, paper leverage, risk thresholds, the research/whale 1-minute collectors, or live-order authorization.

Real order execution remains disabled.

## Durable state

Production startup writes an explicit versioned state document to:

```text
data/platform/paper-state.json
```

The Docker platform already mounts `/app/data` on the `platform-data` named volume, so this file survives container replacement/restart.

The persisted document contains only explicit recovery records:

- account starting/cash/peak equity;
- open paper positions;
- stop, target and trailing-stop state;
- strategy/timeframe context for each position/trade;
- fills and fill IDs;
- entry/exit fees and slippage;
- funding records and funding IDs;
- closed-trade journal;
- equity curve;
- restart-sensitive risk state (kill switch, consecutive losses and last loss time);
- latest confirmed strategy-candle timestamp per instrument.

Daily realized PnL and daily trade count are reconstructed from the persisted trade journal rather than stored as independent counters that could diverge.

## Atomic persistence

`PaperStateRepository` writes a complete sibling temporary file, fsyncs it, and atomically renames it over the last known-good paper state. If the process fails before the rename, the previous committed state remains recoverable.

Material account effects are checkpointed immediately after successful entry fills, exit fills, funding, trailing-stop changes and risk-state changes. High-frequency mark-to-market changes are additionally checkpointed on a bounded periodic cadence so order-book traffic does not fsync the disk on every tick.

## Ledger and idempotency

The dashboard paper account now keeps explicit records for:

- fills;
- fees;
- position open/close;
- funding;
- stop/target/trailing updates;
- risk-state changes.

Entry fills, exit fills, funding events and audit events have stable IDs. Reprocessing an already committed ID has no second accounting effect.

Confirmed strategy candles are also evaluation-deduplicated by instrument, selected timeframe and exchange timestamp. Historical recovery still runs under the existing timeframe rebuild execution barrier, so replayed history can rebuild indicators but cannot open a retroactive paper trade.

## Restart reconciliation

Startup ordering is:

1. load persisted dashboard settings;
2. load and validate the paper state;
3. reconstruct cached/derived account values from ledger evidence;
4. restore positions, stops, targets, trailing state and funding totals;
5. restore restart-sensitive risk state;
6. start the dashboard server;
7. attach the selected native OKX candle timeframe;
8. backfill confirmed OKX history chronologically, including missing pages after a persisted candle boundary;
9. establish the historical/live execution barrier;
10. resume live strategy evaluation.

The account reconciliation warns when cached values disagree with ledger-derived values. Cached unrealized PnL, net PnL, cash and peak-equity evidence are not silently trusted when they can be reconstructed.

## Funding status

`TradingPlatformEngine.onFunding()` now has idempotent durable accounting. It records the funding timestamp, instrument, position direction/notional, funding rate and signed funding PnL. Positive rates debit longs and credit shorts according to the existing paper-account convention.

Automatic application of OKX public funding-history records is intentionally **not enabled yet**. The repository can fetch OKX realized funding rates and funding timestamps, but the current trading-platform path does not persist a verified settlement-time mark/notional source for an offline funding timestamp. Applying a historical rate using a later/current mark would manufacture inaccurate paper PnL.

A future funding bridge should bind the realized OKX funding event to verified settlement-time mark/notional evidence before calling the now-idempotent `onFunding()` path. Until then, funding accounting is correct and restart-safe for verified events supplied to the engine, but unattended multi-day paper PnL must be treated as incomplete with respect to real exchange funding.

## Recovery limitations

- Paper positions are currently opened/closed as whole positions; the dashboard engine does not yet implement position increase/reduce accounting, so Phase 11 does not invent those event types.
- A durable position can resume protective stop/target/trailing behavior once fresh order-book data arrives after restart. No exchange-side protective order exists because this remains paper trading.
- Mark-to-market values may be stale at the instant of process restart until the next usable order-book update; quantity, entry, realized PnL, fees, funding, stop/target/trailing state and journal evidence are durable.
- Automatic real funding ingestion remains blocked as described above.

## Safety conclusion

The persistence/reconciliation layer is designed for continuous paper/shadow operation and crash/restart recovery, but funding-complete profitability validation must remain blocked until the verified settlement-time funding source is connected. This phase makes the account evidence recoverable; it does not prove the strategy profitable or authorize real orders.
