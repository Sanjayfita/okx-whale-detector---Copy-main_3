type TabName = 'overview' | 'trades' | 'analytics' | 'replay' | 'logs' | 'settings';
type LogLevel = 'INFO' | 'WARNING' | 'ERROR' | 'TRADE' | 'API';

type Candle = {
  instrumentId: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  confirmed: boolean;
  fastEma: number | null;
  slowEma: number | null;
  rsi: number | null;
  atr: number | null;
};

type Position = {
  instrumentId: string;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  currentPrice: number;
  quantityBaseUnits: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  trailingStopPrice: number | null;
  riskPercent: number;
  rewardPercent: number;
  unrealizedPnl: number;
  openedAt: number;
  durationMs: number;
};

type Trade = {
  tradeId: string;
  instrumentId: string;
  direction: 'LONG' | 'SHORT';
  result: 'WIN' | 'LOSS' | 'BREAKEVEN';
  openedAt: number;
  closedAt: number;
  entryPrice: number;
  exitPrice: number;
  entryReason: string;
  exitReason: string;
  grossPnl: number;
  fees: number;
  fundingPnl: number;
  netPnl: number;
  rMultiple: number | null;
  durationMs: number;
};

type Settings = {
  mode: 'PAPER' | 'LIVE';
  activeStrategyId: string;
  fastEmaLength: number;
  slowEmaLength: number;
  rsiPeriod: number;
  atrPeriod: number;
  atrMultiplier: number;
  minimumAtrPercent: number;
  maximumAtrPercent: number;
  riskPerTradePercent: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  trailingStopEnabled: boolean;
  trailingStopPercent: number;
  autoSave: boolean;
};

type Snapshot = {
  generatedAt: number;
  overview: {
    accountEquity: number;
    pnlToday: number;
    unrealizedPnl: number;
    winRate: number;
    currentPosition: string;
    positionSize: number;
    dailyReturnPercent: number;
    currentStrategy: string;
    mode: 'PAPER' | 'LIVE';
    liveExecutionAllowed: false;
  };
  positions: Position[];
  trades: Trade[];
  equityCurve: { timestamp: number; equity: number }[];
  candles: Record<string, Candle[]>;
  strategyStatus: Record<
    string,
    {
      strategyId: string;
      signal: 'BUY' | 'SELL' | 'WAIT';
      reasons: string[];
      checks: { label: string; passed: boolean; detail: string }[];
      updatedAt: number | null;
    }
  >;
  logs: {
    id: string;
    timestamp: number;
    level: LogLevel;
    message: string;
    context: Record<string, string | number | boolean | null>;
  }[];
  analytics: {
    trades: number;
    wins: number;
    losses: number;
    winRate: number;
    netPnl: number;
    profitFactor: number | null;
    expectancy: number;
    averageWin: number;
    averageLoss: number;
    largestWin: number;
    largestLoss: number;
    averageHoldingTimeMs: number;
    averageR: number | null;
    maximumDrawdownPercent: number;
    sharpeRatio: number | null;
    dailyReturnsPercent: { day: string; returnPercent: number }[];
    monthlyReturnsPercent: { month: string; returnPercent: number }[];
    returnDistribution: { minimumInclusive: number; maximumExclusive: number; count: number }[];
    rMultipleDistribution: { minimumInclusive: number; maximumExclusive: number; count: number }[];
    heatmap: { weekday: number; hourUtc: number; trades: number; netPnl: number; winRate: number }[];
  };
  settings: Settings;
  strategies: { id: string; label: string; active: boolean }[];
  risk: {
    killSwitchActive: boolean;
    circuitBreakerActive: boolean;
    consecutiveLosses: number;
    cooldownUntil: number | null;
    liveExecutionAllowed: false;
  };
  liveExecutionAllowed: false;
};

const app = document.querySelector<HTMLDivElement>('#app');
if (app === null) throw new Error('Dashboard app root is missing');

let snapshot: Snapshot | null = null;
let activeTab: TabName = 'overview';
let connected = false;
let selectedInstrument = '';
let logFilter: LogLevel | 'ALL' = 'ALL';
let replayIndex = 0;
let replaySpeed: 1 | 2 | 5 = 1;
let replayPlaying = false;
let replayTimer: number | null = null;

const escapeHtml = (value: unknown): string =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const money = (value: number): string =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const number = (value: number, digits = 4): string =>
  new Intl.NumberFormat('en-US', {
    maximumFractionDigits: digits,
  }).format(value);

const percent = (value: number): string => `${value.toFixed(2)}%`;
const pnlClass = (value: number): string =>
  value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral';

const duration = (milliseconds: number): string => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

const time = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const dateTime = (timestamp: number): string => new Date(timestamp).toLocaleString();

const instruments = (): string[] =>
  snapshot === null ? [] : Object.keys(snapshot.candles).sort();

const chooseInstrument = (): string => {
  const available = instruments();
  if (selectedInstrument && available.includes(selectedInstrument)) return selectedInstrument;
  const withPosition = snapshot?.positions[0]?.instrumentId;
  if (withPosition && available.includes(withPosition)) {
    selectedInstrument = withPosition;
  } else {
    selectedInstrument = available[0] ?? '';
  }
  return selectedInstrument;
};

const navItems: readonly { id: TabName; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'trades', label: 'Trades' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'replay', label: 'Replay' },
  { id: 'logs', label: 'Logs' },
  { id: 'settings', label: 'Settings' },
];

const pageTitle = (): string =>
  navItems.find((item) => item.id === activeTab)?.label ?? 'Trading Platform';

const metric = (label: string, value: string, foot: string, klass = ''): string => `
  <div class="card metric">
    <div class="metric-label">${escapeHtml(label)}</div>
    <div class="metric-value ${klass}">${escapeHtml(value)}</div>
    <div class="metric-foot">${escapeHtml(foot)}</div>
  </div>`;

const positionCard = (position: Position | undefined): string => {
  if (position === undefined) {
    return `<div class="card"><div class="card-head"><h3>Open Position</h3><span>Paper account</span></div><div class="empty">No open position</div></div>`;
  }
  const rows: readonly [string, string, string?][] = [
    ['Entry Price', number(position.entryPrice, 8)],
    ['Current Price', number(position.currentPrice, 8)],
    ['Stop Loss', number(position.stopLossPrice, 8)],
    ['Take Profit', number(position.takeProfitPrice, 8)],
    ['Trailing Stop', position.trailingStopPrice === null ? 'Disabled / waiting' : number(position.trailingStopPrice, 8)],
    ['Position Size', number(position.quantityBaseUnits, 6)],
    ['Risk', percent(position.riskPercent)],
    ['Reward', percent(position.rewardPercent)],
    ['Duration', duration(position.durationMs)],
    ['Unrealized PnL', money(position.unrealizedPnl), pnlClass(position.unrealizedPnl)],
  ];
  return `<div class="card">
    <div class="card-head"><h3>Open Position</h3><span>${escapeHtml(position.direction)} · ${escapeHtml(position.instrumentId)}</span></div>
    <div class="card-pad position-grid">
      ${rows.map(([label, value, klass]) => `<div class="data-pair"><span>${escapeHtml(label)}</span><strong class="${klass ?? ''}">${escapeHtml(value)}</strong></div>`).join('')}
    </div>
  </div>`;
};

const strategyCard = (): string => {
  if (snapshot === null) return '';
  const active = snapshot.strategies.find((strategy) => strategy.active);
  const status = active ? snapshot.strategyStatus[active.id] : undefined;
  const signal = status?.signal ?? 'WAIT';
  const reasons = status?.reasons ?? ['Waiting for confirmed candle history'];
  return `<div class="card signal-card">
    <div class="signal">
      <div><div class="metric-label">Current Signal</div><div class="signal-word ${signal}">${signal}</div></div>
      <span class="pill">${escapeHtml(active?.label ?? snapshot.overview.currentStrategy)}</span>
    </div>
    <div class="checks">
      ${(status?.checks ?? []).map((check) => `<div class="check">
        <div class="check-icon ${check.passed ? 'ok' : 'no'}">${check.passed ? '✓' : '✕'}</div>
        <div><strong>${escapeHtml(check.label)}</strong><small>${escapeHtml(check.detail)}</small></div>
      </div>`).join('')}
      ${status === undefined ? `<div class="notice">${escapeHtml(reasons.join(' · '))}</div>` : ''}
    </div>
  </div>`;
};

const instrumentSelect = (): string => {
  const current = chooseInstrument();
  return `<select id="instrument-select" aria-label="Instrument">${instruments()
    .map((instrument) => `<option value="${escapeHtml(instrument)}" ${instrument === current ? 'selected' : ''}>${escapeHtml(instrument)}</option>`)
    .join('')}</select>`;
};

const renderOverview = (): string => {
  if (snapshot === null) return '<div class="empty">Waiting for platform snapshot…</div>';
  const o = snapshot.overview;
  const position = snapshot.positions[0];
  return `
    <div class="grid metrics">
      ${metric('Account Equity', `$${money(o.accountEquity)}`, o.mode === 'PAPER' ? 'Paper account' : 'Monitoring only')}
      ${metric('PnL Today', `$${money(o.pnlToday)}`, percent(o.dailyReturnPercent), pnlClass(o.pnlToday))}
      ${metric('Unrealized PnL', `$${money(o.unrealizedPnl)}`, o.currentPosition, pnlClass(o.unrealizedPnl))}
      ${metric('Win Rate', percent(o.winRate), `${snapshot.analytics.wins} wins / ${snapshot.analytics.losses} losses`)}
      ${metric('Position Size', number(o.positionSize, 6), position?.instrumentId ?? 'Flat')}
      ${metric('Daily Return', percent(o.dailyReturnPercent), 'UTC trading day', pnlClass(o.dailyReturnPercent))}
      ${metric('Profit Factor', snapshot.analytics.profitFactor === null ? 'N/A' : snapshot.analytics.profitFactor.toFixed(2), 'After journaled costs')}
      ${metric('Average R', snapshot.analytics.averageR === null ? 'N/A' : snapshot.analytics.averageR.toFixed(2), 'Risk-normalized result')}
    </div>
    <div class="grid two-col section-gap">
      <div class="card">
        <div class="card-head"><h3>Live Market</h3><div class="toolbar">${instrumentSelect()}</div></div>
        <div class="chart-wrap"><canvas id="price-chart" class="chart-main"></canvas></div>
        <div class="legend"><span class="fast"><i></i>EMA Fast</span><span class="slow"><i></i>EMA Slow</span><span class="entry"><i></i>Entry</span><span class="exit"><i></i>Exit</span></div>
        <div class="card-head"><h3>RSI</h3><span>Momentum confirmation</span></div>
        <div class="chart-wrap" style="min-height:110px"><canvas id="rsi-chart" class="chart-mini"></canvas></div>
        <div class="card-head"><h3>ATR</h3><span>Volatility</span></div>
        <div class="chart-wrap" style="min-height:110px"><canvas id="atr-chart" class="chart-mini"></canvas></div>
      </div>
      <div class="grid" style="align-content:start">
        ${strategyCard()}
        ${positionCard(position)}
      </div>
    </div>`;
};

const renderTrades = (): string => {
  if (snapshot === null) return '';
  return `<div class="card">
    <div class="card-head"><h3>Trade History</h3><span>${snapshot.trades.length} closed trades</span></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Result</th><th>Instrument</th><th>Side</th><th>Entry</th><th>Exit</th><th>Entry reason</th><th>Exit reason</th><th>Gross</th><th>Fees</th><th>Funding</th><th>Net</th><th>R</th><th>Duration</th></tr></thead>
      <tbody>${snapshot.trades.slice().reverse().map((trade) => `<tr>
        <td><span class="tag ${trade.result === 'WIN' ? 'win' : trade.result === 'LOSS' ? 'loss' : 'flat'}">${trade.result}</span></td>
        <td>${escapeHtml(trade.instrumentId)}</td><td>${trade.direction}</td>
        <td>${number(trade.entryPrice, 8)}<br><small>${escapeHtml(dateTime(trade.openedAt))}</small></td>
        <td>${number(trade.exitPrice, 8)}<br><small>${escapeHtml(dateTime(trade.closedAt))}</small></td>
        <td>${escapeHtml(trade.entryReason)}</td><td>${escapeHtml(trade.exitReason)}</td>
        <td class="${pnlClass(trade.grossPnl)}">${money(trade.grossPnl)}</td>
        <td>${money(trade.fees)}</td><td class="${pnlClass(trade.fundingPnl)}">${money(trade.fundingPnl)}</td>
        <td class="${pnlClass(trade.netPnl)}">${money(trade.netPnl)}</td>
        <td>${trade.rMultiple === null ? 'N/A' : trade.rMultiple.toFixed(2)}</td><td>${duration(trade.durationMs)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  </div>`;
};

const analyticsMetric = (label: string, value: string, klass = ''): string => `
  <div class="card metric"><div class="metric-label">${escapeHtml(label)}</div><div class="metric-value ${klass}" style="font-size:22px">${escapeHtml(value)}</div></div>`;

const renderMonthlyBars = (): string => {
  if (snapshot === null || snapshot.analytics.monthlyReturnsPercent.length === 0) return '<div class="empty">No monthly return history yet</div>';
  const values = snapshot.analytics.monthlyReturnsPercent;
  const max = Math.max(0.01, ...values.map((value) => Math.abs(value.returnPercent)));
  return `<div class="bar-list">${values.slice(-18).map((value) => `<div class="bar-row"><span>${escapeHtml(value.month)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, Math.abs(value.returnPercent) / max * 100)}%"></div></div><strong class="${pnlClass(value.returnPercent)}">${percent(value.returnPercent)}</strong></div>`).join('')}</div>`;
};

const renderHeatmap = (): string => {
  if (snapshot === null) return '';
  const cells = new Map(snapshot.analytics.heatmap.map((cell) => [`${cell.weekday}:${cell.hourUtc}`, cell]));
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return names.map((name, weekday) => `<div style="display:grid;grid-template-columns:38px 1fr;gap:8px;align-items:center;margin-bottom:4px"><small>${name}</small><div class="heatmap">${Array.from({ length: 24 }, (_, hour) => {
    const cell = cells.get(`${weekday}:${hour}`);
    const klass = cell === undefined ? '' : cell.netPnl > 0 ? 'win' : cell.netPnl < 0 ? 'loss' : '';
    return `<div class="heat-cell ${klass}" title="${name} ${hour}:00 UTC · ${cell?.trades ?? 0} trades · PnL ${money(cell?.netPnl ?? 0)}"></div>`;
  }).join('')}</div></div>`).join('');
};

const renderAnalytics = (): string => {
  if (snapshot === null) return '';
  const a = snapshot.analytics;
  return `
    <div class="grid analytics-kpis">
      ${analyticsMetric('Net PnL', `$${money(a.netPnl)}`, pnlClass(a.netPnl))}
      ${analyticsMetric('Expectancy', `$${money(a.expectancy)}`, pnlClass(a.expectancy))}
      ${analyticsMetric('Sharpe', a.sharpeRatio === null ? 'N/A' : a.sharpeRatio.toFixed(2))}
      ${analyticsMetric('Profit Factor', a.profitFactor === null ? 'N/A' : a.profitFactor.toFixed(2))}
      ${analyticsMetric('Max Drawdown', percent(a.maximumDrawdownPercent), a.maximumDrawdownPercent > 10 ? 'negative' : '')}
      ${analyticsMetric('Average Win', `$${money(a.averageWin)}`, 'positive')}
      ${analyticsMetric('Average Loss', `$${money(a.averageLoss)}`, 'negative')}
      ${analyticsMetric('Largest Win', `$${money(a.largestWin)}`, 'positive')}
      ${analyticsMetric('Largest Loss', `$${money(a.largestLoss)}`, 'negative')}
      ${analyticsMetric('Avg Holding', duration(a.averageHoldingTimeMs))}
    </div>
    <div class="grid two-col section-gap">
      <div class="card"><div class="card-head"><h3>Equity Curve</h3><span>${snapshot.equityCurve.length} marks</span></div><div class="chart-wrap"><canvas id="equity-chart" class="chart-main"></canvas></div></div>
      <div class="card"><div class="card-head"><h3>Monthly Returns</h3><span>UTC</span></div><div class="card-pad">${renderMonthlyBars()}</div></div>
    </div>
    <div class="card section-gap"><div class="card-head"><h3>Performance Heatmap</h3><span>Entry time · UTC</span></div><div class="card-pad">${renderHeatmap()}</div></div>`;
};

const replayCandles = (): Candle[] => {
  if (snapshot === null) return [];
  return snapshot.candles[chooseInstrument()] ?? [];
};

const stopReplay = (): void => {
  replayPlaying = false;
  if (replayTimer !== null) window.clearInterval(replayTimer);
  replayTimer = null;
};

const startReplay = (): void => {
  stopReplay();
  replayPlaying = true;
  replayTimer = window.setInterval(() => {
    const candles = replayCandles();
    if (candles.length === 0 || replayIndex >= candles.length - 1) {
      stopReplay();
      render();
      return;
    }
    replayIndex = Math.min(candles.length - 1, replayIndex + replaySpeed);
    render();
  }, 650);
};

const renderReplay = (): string => {
  const candles = replayCandles();
  if (candles.length > 0) replayIndex = Math.min(Math.max(0, replayIndex), candles.length - 1);
  const frame = candles[replayIndex];
  return `<div class="card">
    <div class="card-head"><h3>Trade Replay</h3><div class="toolbar">${instrumentSelect()}</div></div>
    <div class="card-pad toolbar">
      <button id="replay-back">← Step Back</button>
      <button id="replay-play" class="primary">${replayPlaying ? 'Pause' : 'Play'}</button>
      <button id="replay-forward">Step Forward →</button>
      <button data-speed="1" class="${replaySpeed === 1 ? 'primary' : ''}">x1</button>
      <button data-speed="2" class="${replaySpeed === 2 ? 'primary' : ''}">x2</button>
      <button data-speed="5" class="${replaySpeed === 5 ? 'primary' : ''}">x5</button>
      <button id="replay-reset">Reset</button>
    </div>
    <div class="chart-wrap"><canvas id="replay-chart" class="chart-main"></canvas></div>
    <div class="replay-status card-pad"><span>Frame ${candles.length === 0 ? 0 : replayIndex + 1} / ${candles.length}</span><span>${frame === undefined ? 'No candle data' : `${escapeHtml(frame.instrumentId)} · ${escapeHtml(dateTime(frame.timestamp))} · Close ${number(frame.close, 8)}`}</span></div>
  </div>
  <div class="grid three-col section-gap">
    ${analyticsMetric('Signal', activeReplaySignal(frame?.timestamp), '')}
    ${analyticsMetric('Replay PnL Context', replayPnl(frame?.timestamp), '')}
    ${analyticsMetric('Indicators', frame === undefined ? 'Waiting' : `RSI ${frame.rsi?.toFixed(1) ?? '—'} · ATR ${frame.atr?.toFixed(4) ?? '—'}`)}
  </div>`;
};

const activeReplaySignal = (timestamp: number | undefined): string => {
  if (snapshot === null || timestamp === undefined) return 'WAIT';
  const trade = snapshot.trades.find((candidate) => candidate.openedAt === timestamp);
  if (trade) return trade.direction === 'LONG' ? 'BUY' : 'SELL';
  if (snapshot.trades.some((candidate) => candidate.closedAt === timestamp)) return 'EXIT';
  return 'WAIT';
};

const replayPnl = (timestamp: number | undefined): string => {
  if (snapshot === null || timestamp === undefined) return '$0.00';
  const closed = snapshot.trades.filter((trade) => trade.closedAt <= timestamp);
  return `$${money(closed.reduce((sum, trade) => sum + trade.netPnl, 0))}`;
};

const renderLogs = (): string => {
  if (snapshot === null) return '';
  const levels: readonly (LogLevel | 'ALL')[] = ['ALL', 'INFO', 'WARNING', 'ERROR', 'TRADE', 'API'];
  const logs = logFilter === 'ALL' ? snapshot.logs : snapshot.logs.filter((log) => log.level === logFilter);
  return `<div class="card">
    <div class="card-head"><h3>Realtime Logs</h3><div class="toolbar">${levels.map((level) => `<button data-log-level="${level}" class="${logFilter === level ? 'primary' : ''}">${level}</button>`).join('')}</div></div>
    <div class="log-list">${logs.slice().reverse().map((log) => `<div class="log-row"><span class="log-time">${escapeHtml(time(log.timestamp))}</span><span class="log-level ${log.level}">${log.level}</span><span>${escapeHtml(log.message)} <span class="log-context">${escapeHtml(Object.entries(log.context).map(([key, value]) => `${key}=${String(value)}`).join(' '))}</span></span></div>`).join('')}</div>
  </div>`;
};

const numberField = (key: keyof Settings, label: string, value: number, step: string): string => `<div class="field"><label for="${String(key)}">${escapeHtml(label)}</label><input id="${String(key)}" name="${String(key)}" type="number" step="${step}" value="${value}" required /></div>`;

const renderSettings = (): string => {
  if (snapshot === null) return '';
  const s = snapshot.settings;
  return `<div class="card">
    <div class="card-head"><h3>Strategy & Platform Settings</h3><span>Validated server-side</span></div>
    <form id="settings-form" class="card-pad">
      <div class="notice">LIVE mode is monitoring-only. This platform branch keeps real order execution disabled by design; changing this selector does not authorize orders.</div>
      <div class="form-grid section-gap">
        <div class="field"><label for="mode">Mode</label><select id="mode" name="mode"><option ${s.mode === 'PAPER' ? 'selected' : ''}>PAPER</option><option ${s.mode === 'LIVE' ? 'selected' : ''}>LIVE</option></select></div>
        <div class="field"><label for="activeStrategyId">Active Strategy</label><select id="activeStrategyId" name="activeStrategyId">${snapshot.strategies.map((strategy) => `<option value="${escapeHtml(strategy.id)}" ${strategy.active ? 'selected' : ''}>${escapeHtml(strategy.label)}</option>`).join('')}</select></div>
        ${numberField('riskPerTradePercent', 'Risk per Trade (%)', s.riskPerTradePercent, '0.1')}
        ${numberField('fastEmaLength', 'Fast EMA Length', s.fastEmaLength, '1')}
        ${numberField('slowEmaLength', 'Slow EMA Length', s.slowEmaLength, '1')}
        ${numberField('rsiPeriod', 'RSI Period', s.rsiPeriod, '1')}
        ${numberField('atrPeriod', 'ATR Period', s.atrPeriod, '1')}
        ${numberField('atrMultiplier', 'ATR Multiplier', s.atrMultiplier, '0.1')}
        ${numberField('minimumAtrPercent', 'Minimum ATR (%)', s.minimumAtrPercent, '0.01')}
        ${numberField('maximumAtrPercent', 'Maximum ATR (%)', s.maximumAtrPercent, '0.1')}
        ${numberField('stopLossPercent', 'Minimum Stop Loss (%)', s.stopLossPercent, '0.1')}
        ${numberField('takeProfitPercent', 'Minimum Take Profit (%)', s.takeProfitPercent, '0.1')}
        ${numberField('trailingStopPercent', 'Trailing Stop (%)', s.trailingStopPercent, '0.1')}
        <div class="field"><label>Trailing Stop</label><div class="switch-field"><span>Enabled</span><input id="trailingStopEnabled" name="trailingStopEnabled" type="checkbox" ${s.trailingStopEnabled ? 'checked' : ''} /></div></div>
        <div class="field"><label>Auto Save</label><div class="switch-field"><span>Persist settings</span><input id="autoSave" name="autoSave" type="checkbox" ${s.autoSave ? 'checked' : ''} /></div></div>
      </div>
      <div class="toolbar section-gap"><button type="submit" class="primary">Save Settings</button><span id="settings-message" class="pill">Risk is hard-capped at 1%</span></div>
    </form>
  </div>`;
};

const content = (): string => {
  if (activeTab === 'overview') return renderOverview();
  if (activeTab === 'trades') return renderTrades();
  if (activeTab === 'analytics') return renderAnalytics();
  if (activeTab === 'replay') return renderReplay();
  if (activeTab === 'logs') return renderLogs();
  return renderSettings();
};

const shell = (): string => {
  const mode = snapshot?.overview.mode ?? 'PAPER';
  const kill = snapshot?.risk.killSwitchActive ?? false;
  const riskDanger = kill || (snapshot?.risk.circuitBreakerActive ?? false);
  return `<div class="shell">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark">OT</div><div><h1>OKX Trading Platform</h1><span>Rules-based research & paper execution</span></div></div>
      <nav class="nav">${navItems.map((item) => `<button data-tab="${item.id}" class="${activeTab === item.id ? 'active' : ''}">${item.label}</button>`).join('')}</nav>
      <div class="sidebar-footer"><div class="mode-badge">Mode: <strong>${mode}</strong><br>Live orders: disabled</div><div class="connection-badge ${connected ? 'online' : 'offline'}">Runtime: <strong>${connected ? 'CONNECTED' : 'RECONNECTING'}</strong></div></div>
    </aside>
    <main class="main">
      <header class="topbar"><div><h2>${escapeHtml(pageTitle())}</h2><p>${escapeHtml(snapshot?.overview.currentStrategy ?? 'EMA Trend Strategy')} · ${escapeHtml(selectedInstrument || 'waiting for market')}</p></div><div class="top-actions"><span class="pill ${mode === 'PAPER' ? 'good' : 'warn'}">${mode}</span><span class="pill ${riskDanger ? 'danger' : 'good'}">Risk ${riskDanger ? 'BLOCKED' : 'READY'}</span><button id="kill-switch" class="kill ${kill ? 'active' : ''}">${kill ? 'Clear Kill Switch' : 'Kill Switch'}</button></div></header>
      <section class="content">${content()}</section>
    </main>
    <nav class="mobile-nav">${navItems.map((item) => `<button data-tab="${item.id}" class="${activeTab === item.id ? 'active' : ''}">${item.label}</button>`).join('')}</nav>
  </div>`;
};

const setupCanvas = (canvas: HTMLCanvasElement): CanvasRenderingContext2D | null => {
  const width = Math.max(320, Math.floor(canvas.clientWidth));
  const height = Math.max(90, Math.floor(canvas.clientHeight));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  const context = canvas.getContext('2d');
  if (context === null) return null;
  context.scale(dpr, dpr);
  context.clearRect(0, 0, width, height);
  return context;
};

const drawGrid = (context: CanvasRenderingContext2D, width: number, height: number): void => {
  context.strokeStyle = '#1d3046';
  context.lineWidth = 1;
  for (let index = 1; index < 5; index += 1) {
    const y = (height / 5) * index;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
};

const drawPriceChart = (canvas: HTMLCanvasElement, data: Candle[]): void => {
  const context = setupCanvas(canvas);
  if (context === null) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const candles = data.slice(-120);
  drawGrid(context, width, height);
  if (candles.length === 0) return;
  const high = Math.max(...candles.map((candle) => candle.high));
  const low = Math.min(...candles.map((candle) => candle.low));
  const range = Math.max(Number.EPSILON, high - low);
  const x = (index: number): number => 8 + (index / Math.max(1, candles.length - 1)) * (width - 16);
  const y = (price: number): number => 10 + ((high - price) / range) * (height - 20);
  const candleWidth = Math.max(2, Math.min(8, (width / candles.length) * 0.55));

  candles.forEach((candle, index) => {
    const cx = x(index);
    const rising = candle.close >= candle.open;
    context.strokeStyle = rising ? '#2ad7a2' : '#ff6b7a';
    context.fillStyle = context.strokeStyle;
    context.beginPath();
    context.moveTo(cx, y(candle.high));
    context.lineTo(cx, y(candle.low));
    context.stroke();
    const top = Math.min(y(candle.open), y(candle.close));
    const bodyHeight = Math.max(1, Math.abs(y(candle.open) - y(candle.close)));
    context.fillRect(cx - candleWidth / 2, top, candleWidth, bodyHeight);
  });

  const drawIndicator = (key: 'fastEma' | 'slowEma', color: string): void => {
    context.strokeStyle = color;
    context.lineWidth = 1.7;
    context.beginPath();
    let started = false;
    candles.forEach((candle, index) => {
      const value = candle[key];
      if (value === null) return;
      if (!started) {
        context.moveTo(x(index), y(value));
        started = true;
      } else context.lineTo(x(index), y(value));
    });
    context.stroke();
  };
  drawIndicator('fastEma', '#70a8ff');
  drawIndicator('slowEma', '#ae8cff');

  if (snapshot !== null) {
    const start = candles[0]?.timestamp ?? 0;
    const end = candles[candles.length - 1]?.timestamp ?? 0;
    const byTimestamp = new Map(candles.map((candle, index) => [candle.timestamp, index]));
    for (const trade of snapshot.trades) {
      if (trade.instrumentId !== chooseInstrument()) continue;
      for (const marker of [
        { timestamp: trade.openedAt, price: trade.entryPrice, color: '#2ad7a2', label: 'E' },
        { timestamp: trade.closedAt, price: trade.exitPrice, color: '#ff6b7a', label: 'X' },
      ]) {
        if (marker.timestamp < start || marker.timestamp > end) continue;
        const index = byTimestamp.get(marker.timestamp);
        if (index === undefined) continue;
        context.fillStyle = marker.color;
        context.beginPath();
        context.arc(x(index), y(marker.price), 5, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = '#07111f';
        context.font = 'bold 7px sans-serif';
        context.fillText(marker.label, x(index) - 2.5, y(marker.price) + 2.5);
      }
    }
  }
};

const drawSeries = (
  canvas: HTMLCanvasElement,
  values: readonly (number | null)[],
  referenceLines: readonly number[] = [],
): void => {
  const context = setupCanvas(canvas);
  if (context === null) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  drawGrid(context, width, height);
  if (finite.length === 0) return;
  const min = Math.min(...finite, ...referenceLines);
  const max = Math.max(...finite, ...referenceLines);
  const range = Math.max(Number.EPSILON, max - min);
  const y = (value: number): number => 8 + ((max - value) / range) * (height - 16);
  context.setLineDash([4, 4]);
  context.strokeStyle = '#40536a';
  for (const reference of referenceLines) {
    context.beginPath();
    context.moveTo(0, y(reference));
    context.lineTo(width, y(reference));
    context.stroke();
  }
  context.setLineDash([]);
  context.strokeStyle = '#70a8ff';
  context.lineWidth = 1.8;
  context.beginPath();
  let started = false;
  values.forEach((value, index) => {
    if (value === null) return;
    const px = values.length <= 1 ? width / 2 : (index / (values.length - 1)) * width;
    if (!started) {
      context.moveTo(px, y(value));
      started = true;
    } else context.lineTo(px, y(value));
  });
  context.stroke();
};

const drawEquity = (canvas: HTMLCanvasElement): void => {
  if (snapshot === null) return;
  drawSeries(canvas, snapshot.equityCurve.slice(-600).map((point) => point.equity));
};

const drawCurrentCharts = (): void => {
  if (snapshot === null) return;
  const candles = snapshot.candles[chooseInstrument()] ?? [];
  const priceCanvas = document.querySelector<HTMLCanvasElement>('#price-chart');
  if (priceCanvas) drawPriceChart(priceCanvas, candles);
  const rsiCanvas = document.querySelector<HTMLCanvasElement>('#rsi-chart');
  if (rsiCanvas) drawSeries(rsiCanvas, candles.slice(-120).map((candle) => candle.rsi), [30, 50, 70]);
  const atrCanvas = document.querySelector<HTMLCanvasElement>('#atr-chart');
  if (atrCanvas) drawSeries(atrCanvas, candles.slice(-120).map((candle) => candle.atr));
  const equityCanvas = document.querySelector<HTMLCanvasElement>('#equity-chart');
  if (equityCanvas) drawEquity(equityCanvas);
  const replayCanvas = document.querySelector<HTMLCanvasElement>('#replay-chart');
  if (replayCanvas) drawPriceChart(replayCanvas, replayCandles().slice(0, replayIndex + 1));
};

const patchSettings = async (settings: Partial<Settings>): Promise<void> => {
  const response = await fetch('/api/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  snapshot = await fetchSnapshot();
};

const fetchSnapshot = async (): Promise<Snapshot> => {
  const response = await fetch('/api/snapshot', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Snapshot HTTP ${response.status}`);
  return (await response.json()) as Snapshot;
};

const bind = (): void => {
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const tab = button.dataset.tab as TabName | undefined;
      if (tab === undefined) return;
      if (activeTab !== 'replay') stopReplay();
      activeTab = tab;
      render();
    });
  });

  document.querySelector<HTMLSelectElement>('#instrument-select')?.addEventListener('change', (event) => {
    selectedInstrument = (event.currentTarget as HTMLSelectElement).value;
    replayIndex = 0;
    render();
  });

  document.querySelector<HTMLButtonElement>('#kill-switch')?.addEventListener('click', () => {
    if (snapshot === null) return;
    void fetch('/api/risk/kill-switch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ active: !snapshot.risk.killSwitchActive }),
    })
      .then(() => fetchSnapshot())
      .then((next) => {
        snapshot = next;
        render();
      });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-log-level]').forEach((button) => {
    button.addEventListener('click', () => {
      logFilter = (button.dataset.logLevel as LogLevel | 'ALL') ?? 'ALL';
      render();
    });
  });

  const form = document.querySelector<HTMLFormElement>('#settings-form');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = (id: string): string => document.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)?.value ?? '';
    const checked = (id: string): boolean => document.querySelector<HTMLInputElement>(`#${id}`)?.checked ?? false;
    const next: Partial<Settings> = {
      mode: value('mode') as 'PAPER' | 'LIVE',
      activeStrategyId: value('activeStrategyId'),
      fastEmaLength: Number(value('fastEmaLength')),
      slowEmaLength: Number(value('slowEmaLength')),
      rsiPeriod: Number(value('rsiPeriod')),
      atrPeriod: Number(value('atrPeriod')),
      atrMultiplier: Number(value('atrMultiplier')),
      minimumAtrPercent: Number(value('minimumAtrPercent')),
      maximumAtrPercent: Number(value('maximumAtrPercent')),
      riskPerTradePercent: Number(value('riskPerTradePercent')),
      stopLossPercent: Number(value('stopLossPercent')),
      takeProfitPercent: Number(value('takeProfitPercent')),
      trailingStopPercent: Number(value('trailingStopPercent')),
      trailingStopEnabled: checked('trailingStopEnabled'),
      autoSave: checked('autoSave'),
    };
    const message = document.querySelector<HTMLSpanElement>('#settings-message');
    void patchSettings(next)
      .then(() => {
        if (message) message.textContent = 'Saved';
        render();
      })
      .catch((error: unknown) => {
        if (message) {
          message.textContent = error instanceof Error ? error.message : String(error);
          message.classList.add('danger');
        }
      });
  });

  document.querySelector<HTMLButtonElement>('#replay-back')?.addEventListener('click', () => {
    stopReplay();
    replayIndex = Math.max(0, replayIndex - 1);
    render();
  });
  document.querySelector<HTMLButtonElement>('#replay-forward')?.addEventListener('click', () => {
    stopReplay();
    replayIndex = Math.min(Math.max(0, replayCandles().length - 1), replayIndex + 1);
    render();
  });
  document.querySelector<HTMLButtonElement>('#replay-reset')?.addEventListener('click', () => {
    stopReplay();
    replayIndex = 0;
    render();
  });
  document.querySelector<HTMLButtonElement>('#replay-play')?.addEventListener('click', () => {
    if (replayPlaying) {
      stopReplay();
      render();
    } else startReplay();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((button) => {
    button.addEventListener('click', () => {
      const speed = Number(button.dataset.speed);
      if (speed === 1 || speed === 2 || speed === 5) replaySpeed = speed;
      if (replayPlaying) startReplay();
      else render();
    });
  });
};

const render = (): void => {
  app.innerHTML = shell();
  bind();
  window.requestAnimationFrame(drawCurrentCharts);
};

const connectSocket = (): void => {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/ws`);
  socket.addEventListener('open', () => {
    connected = true;
    render();
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as { type?: string; data?: Snapshot };
    if (message.type === 'snapshot' && message.data !== undefined) {
      snapshot = message.data;
      chooseInstrument();
      render();
    }
  });
  socket.addEventListener('close', () => {
    connected = false;
    render();
    window.setTimeout(connectSocket, 1800);
  });
  socket.addEventListener('error', () => socket.close());
};

window.addEventListener('resize', () => window.requestAnimationFrame(drawCurrentCharts));

void fetchSnapshot()
  .then((initial) => {
    snapshot = initial;
    chooseInstrument();
    render();
    connectSocket();
  })
  .catch(() => {
    render();
    connectSocket();
  });
