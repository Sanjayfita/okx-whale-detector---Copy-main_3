# Trading Platform

## Purpose

This layer turns the existing OKX derivatives research runtime into a usable local trading platform without weakening the repository's empirical controls. The maintained strategy is still `ema-trend-crossover-v1`; the dashboard, paper account, risk manager, analytics, replay, notification, and deployment layers do not authorize real orders.

**Profitability remains unvalidated. LIVE mode is monitoring-only.** Every new platform contract sets `liveExecutionAllowed: false`.

## Why the browser client is dependency-light

React, Vite, TailwindCSS, shadcn/ui, and Recharts were considered as suggested tools, not hard requirements. This implementation uses strict browser TypeScript, CSS, Canvas, Node's HTTP server, and the repository's existing `ws` package. That keeps the dependency tree and audit surface small, avoids a second package/lockfile, and lets the existing CI type-check and lint the browser source with the same TypeScript rules as the backend.

The UI is structured so a later migration to React can reuse the HTTP/WebSocket contracts without changing strategy, risk, paper, or research code.

## Architecture

```text
OKX REST/WebSocket clients (existing)
        |
        v
MarketState / CandleUpdateHandler / MarketEngine (existing)
        |
        +--> research telemetry, recording, whale baselines (existing)
        |
        v
TradingPlatformObserver
        |
        v
TradingPlatformApplication
  |-- PlatformStateStore
  |-- StrategyRegistry
  |     `-- EmaTrendTradingStrategy (default)
  |-- TradingRiskManager
  |-- TradingPlatformEngine
  |     `-- existing ExecutionSimulator for depth-aware paper fills
  |-- PaperAccountLedger
  |-- NotificationService
  `-- TradingPlatformServer
         |-- REST /api/*
         |-- WebSocket /ws
         `-- web/ responsive dashboard
```

The observer boundary is intentionally small. Existing OKX connectivity does not depend on HTTP, browser, notification, or account-ledger implementations.

## Dashboard pages

### Overview

Shows:

- account equity;
- PnL today;
- unrealized PnL;
- win rate;
- current position and position size;
- daily return;
- current strategy and mode;
- profit factor and average R;
- live candlesticks;
- fast/slow EMA overlays;
- RSI and ATR panels;
- entry and exit markers;
- open-position stop, target, trail, risk/reward, and duration;
- BUY / SELL / WAIT strategy state with individual checks explaining why.

### Trades

The paper journal records:

- instrument and direction;
- entry and exit timestamps/prices;
- entry reason and exit reason;
- gross PnL;
- entry + exit fees;
- funding PnL;
- net PnL;
- R multiple;
- holding duration;
- win/loss/breakeven result.

### Analytics

The shared analytics engine calculates:

- equity curve;
- daily and monthly returns;
- win rate;
- profit factor;
- expectancy;
- average/largest win and loss;
- average holding time;
- average R;
- maximum drawdown;
- annualized daily Sharpe ratio when enough daily observations exist;
- return distribution;
- R-multiple distribution;
- weekday/hour UTC performance heatmap.

### Replay

The replay controller supports:

- play;
- pause;
- x1, x2, and x5 speed;
- step forward;
- step back;
- seek/reset;
- progressive candlestick rendering with signal/PnL/indicator context.

Replay state is deterministic; wall-clock scheduling stays outside the replay model so tests can reproduce cursor behavior exactly.

### Logs

Realtime platform logs can be filtered by:

- `INFO`
- `WARNING`
- `ERROR`
- `TRADE`
- `API`

The in-memory dashboard log buffer is bounded so a long-running process cannot grow it without limit.

### Settings

Editable settings include:

- active strategy;
- PAPER / LIVE monitoring mode;
- fast/slow EMA length;
- RSI period;
- ATR period and multiplier;
- minimum/maximum ATR percentage;
- risk per trade;
- minimum stop-loss percentage;
- minimum take-profit percentage;
- trailing-stop enable and percentage;
- auto save.

Settings are validated server-side. Risk per trade cannot exceed 1%, fast EMA must remain shorter than slow EMA, and configured take profit must remain at least 2x configured stop loss.

Auto-saved settings are written atomically to `data/platform/settings.json`. Mutable UI preferences are intentionally separate from immutable research evidence.

## Paper execution realism

The platform reuses the existing order-book execution simulator instead of inventing a second fill engine.

For market-style paper orders it models or accounts for:

- bid/ask spread through the actual simulated execution side;
- multiple order-book depth levels;
- volume-weighted fill price;
- slippage;
- taker fees;
- partial fills;
- insufficient-depth missed fills;
- minimum fill ratio;
- stale-book rejection;
- latency adjustments supported by the existing simulator;
- entry and exit fees in the account ledger;
- funding PnL through `TradingPlatformEngine.onFunding()`;
- mark-to-market unrealized PnL;
- leveraged liquidation threshold checks;
- residual position protection when a full exit cannot be simulated.

`PaperFeeModel` additionally defines explicit maker and taker schedules. The maintained EMA execution path currently submits simulated market orders and therefore uses taker-style fills. A future passive-limit execution policy can use the maker schedule without changing the account journal.

### Funding integration note

Historical platform backtests accept `fundingRatePercent` on candles. The live paper engine exposes `onFunding()` and correctly debits longs / credits shorts for positive rates (and reverses that for negative rates). A live funding-rate source must call that hook at the exchange funding event. If no live funding source is connected, the dashboard must not pretend funding was charged.

## Dedicated risk manager

Default fail-closed policy:

| Control | Default |
| --- | ---: |
| Maximum risk per trade | 1% equity |
| Daily realized loss limit | 3% |
| Maximum peak-to-current drawdown | 10% |
| Maximum open positions | 3 |
| Cooldown after a losing trade | 30 minutes |
| Maximum leverage used by platform paper execution | 5x ceiling; platform default 2x |
| Daily trade limit | 12 |
| Consecutive-loss circuit breaker | 4 |

The dashboard also exposes a manual kill switch. Kill switch and circuit breaker block new entries; they do not erase open positions or historical evidence.

## Notifications

Notification failures are isolated per channel. Supported environment variables:

```text
DISCORD_WEBHOOK_URL
TRADING_WEBHOOK_URL
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
EMAIL_RELAY_URL
EMAIL_RECIPIENT
```

Supported notification events:

- trade opened;
- trade closed;
- stop hit;
- take profit;
- daily summary;
- errors (channel contract available for runtime error integration).

The email channel is provider-neutral: `EMAIL_RELAY_URL` must accept JSON with `to`, `subject`, and `text`. Secrets are never stored in dashboard settings.

## HTTP and WebSocket API

REST endpoints:

```text
GET   /api/health
GET   /api/snapshot
GET   /api/trades
GET   /api/analytics
GET   /api/settings
GET   /api/logs?level=INFO|WARNING|ERROR|TRADE|API
PATCH /api/settings
POST  /api/risk/kill-switch
POST  /api/notifications/daily-summary
```

Realtime snapshots are pushed on:

```text
/ws
```

The browser renders from the same snapshot contract used by tests, which prevents dashboard-only calculations from drifting away from backend account state.

## One-click startup

### Local Node + Docker database

Prerequisites:

- Node.js 24 compatible environment;
- npm;
- Docker Desktop / Docker Engine with Compose;
- internet access for OKX market data.

Install once:

```bash
npm install
```

Then:

```bash
npm run start
```

The orchestrator:

1. starts the PostgreSQL Compose service;
2. runs every SQL migration with `ON_ERROR_STOP`;
3. builds backend and dashboard TypeScript;
4. starts the dashboard server, WebSocket stream, paper account/risk layer, and existing OKX runtime;
5. prints the dashboard URL;
6. opens the browser automatically when supported.

Useful commands:

```bash
npm run dev
npm run paper
npm run live
npm run dashboard
npm run backtest -- ./candles.json BTC-USDT-SWAP
npm run replay -- <existing replay arguments>
npm test
```

`npm run live` changes the monitoring mode only. It does **not** enable real order submission.

To start without Docker when an external database/runtime arrangement is already handled:

```bash
npx tsx src/tools/startPlatformOrchestrator.ts --skip-database
```

## Docker deployment

```bash
docker compose up --build
```

Compose starts:

1. PostgreSQL 16;
2. a one-shot migration container;
3. one platform container containing the backend, static browser dashboard, WebSocket server, existing OKX runtime, and paper engine.

Dashboard:

```text
http://127.0.0.1:4173
```

The platform is kept in one process because its state, WebSocket fanout, paper account and strategy decisions are tightly coupled. Splitting those into artificial microservices would add network failure modes without improving the current research workflow.

## Backtesting

Input can be a JSON array or NDJSON records containing:

```json
{
  "timestamp": 1700000000000,
  "open": 42000,
  "high": 42100,
  "low": 41900,
  "close": 42050,
  "confirm": true,
  "fundingRatePercent": 0.01
}
```

Run:

```bash
npm run backtest -- ./candles.json BTC-USDT-SWAP
```

Outputs under `artifacts/backtest` by default:

- JSON report;
- trades CSV;
- equity CSV.

The engine includes:

- fee/spread/slippage-aware candle backtests;
- funding input;
- conservative stop-first OHLC ambiguity handling;
- next-candle trailing-stop activation to avoid same-bar path lookahead;
- equity curve and analytics;
- Buy & Hold benchmark;
- bounded parameter candidate comparison (maximum 25 candidates per call);
- bridge to the repository's episode-safe purged walk-forward planner;
- bridge to the repository's execution-aware Monte Carlo stress engine.

It intentionally does not implement unlimited grid search. Parameter work should remain bounded and hypothesis-counted.

## Dashboard mockup

See [dashboard mockup](dashboard-mockup.svg). The SVG is a static design reference; the real `web/` client renders live repository state.

## Adding strategies

See [Adding a strategy](adding-strategies.md).

## Remaining empirical milestones

The platform makes the strategy easier to observe; it does not prove the EMA strategy has an edge. Before any release proposal:

1. run the EMA strategy and frozen whale baseline on the same corrected opportunity universe;
2. include fees, spread, slippage, depth, latency, funding, partial/missed fills and liquidation assumptions;
3. use episode-safe purged walk-forward splits;
4. evaluate multiple liquid derivatives and regimes;
5. use bounded parameter neighborhoods and multiple-testing correction;
6. freeze one candidate before final holdout access;
7. complete prolonged reconciled paper and shadow trading;
8. require statistically significant positive net expectancy after all costs;
9. keep real order execution disabled until a separate operational/release review explicitly authorizes it.
