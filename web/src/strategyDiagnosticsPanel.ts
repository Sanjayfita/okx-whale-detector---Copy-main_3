type StrategyTelemetry = {
  evaluations: number;
  insufficientHistory: number;
  noFreshEmaCrossover: number;
  priceTrendMismatch: number;
  rsiFilter: number;
  atrFilter: number;
  positionAlreadyOpen: number;
  entryReady: number;
};

type StrategyStatus = {
  strategyId: string;
  instrumentId: string;
  state: 'WAIT' | 'ENTRY_READY' | 'IN_POSITION' | 'EXIT_READY';
  primaryReason: string | null;
  telemetry: StrategyTelemetry;
};

type Snapshot = {
  strategies: { id: string; active: boolean }[];
  strategyStatus: Record<string, StrategyStatus>;
};

const isSnapshot = (value: unknown): value is Snapshot => {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.strategies) &&
    typeof record.strategyStatus === 'object' &&
    record.strategyStatus !== null;
};

let latestStatus: StrategyStatus | null = null;
let renderQueued = false;
let polling = false;

const telemetryRows = (telemetry: StrategyTelemetry): readonly [string, number][] => [
  ['Evaluations', telemetry.evaluations],
  ['No fresh crossover', telemetry.noFreshEmaCrossover],
  ['Price/trend mismatch', telemetry.priceTrendMismatch],
  ['RSI filter', telemetry.rsiFilter],
  ['ATR filter', telemetry.atrFilter],
  ['Position already open', telemetry.positionAlreadyOpen],
  ['Insufficient history', telemetry.insufficientHistory],
  ['Entry ready', telemetry.entryReady],
];

const render = (): void => {
  renderQueued = false;
  const status = latestStatus;
  const card = document.querySelector<HTMLElement>('.signal-card');
  if (status === null || card === null) return;

  card.querySelector('.strategy-diagnostics-extra')?.remove();
  const panel = document.createElement('div');
  panel.className = 'strategy-diagnostics-extra';

  const summary = document.createElement('div');
  summary.className = 'strategy-diagnostics-summary';

  const state = document.createElement('div');
  state.className = 'strategy-diagnostics-state';
  const stateLabel = document.createElement('span');
  stateLabel.textContent = 'Strategy state';
  const stateValue = document.createElement('strong');
  stateValue.textContent = status.state;
  state.append(stateLabel, stateValue);

  const reason = document.createElement('div');
  reason.className = 'strategy-diagnostics-reason';
  const reasonLabel = document.createElement('span');
  reasonLabel.textContent = 'Primary reason';
  const reasonValue = document.createElement('strong');
  reasonValue.textContent = status.primaryReason ?? 'NONE — entry conditions are ready';
  reason.append(reasonLabel, reasonValue);
  summary.append(state, reason);

  const heading = document.createElement('div');
  heading.className = 'strategy-telemetry-heading';
  heading.textContent = `Signal-blocking telemetry · ${status.instrumentId}`;

  const grid = document.createElement('div');
  grid.className = 'strategy-telemetry-grid';
  for (const [label, value] of telemetryRows(status.telemetry)) {
    const item = document.createElement('div');
    item.className = 'strategy-telemetry-item';
    const itemLabel = document.createElement('span');
    itemLabel.textContent = label;
    const itemValue = document.createElement('strong');
    itemValue.textContent = value.toLocaleString();
    item.append(itemLabel, itemValue);
    grid.append(item);
  }

  panel.append(summary, heading, grid);
  card.append(panel);
};

const queueRender = (): void => {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(render);
};

const refresh = async (): Promise<void> => {
  if (polling || document.hidden) return;
  polling = true;
  try {
    const response = await fetch('/api/snapshot', { cache: 'no-store' });
    if (!response.ok) return;
    const parsed = (await response.json()) as unknown;
    if (!isSnapshot(parsed)) return;
    const active = parsed.strategies.find((strategy) => strategy.active);
    latestStatus = active === undefined ? null : parsed.strategyStatus[active.id] ?? null;
    queueRender();
  } catch {
    // The main dashboard owns connection/error UX; this module is display-only.
  } finally {
    polling = false;
  }
};

const app = document.querySelector('#app');
if (app !== null) {
  const observer = new MutationObserver(queueRender);
  observer.observe(app, { childList: true, subtree: true });
}

void refresh();
const refreshTimer = window.setInterval(() => void refresh(), 5_000);
window.addEventListener('pagehide', () => window.clearInterval(refreshTimer), {
  once: true,
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refresh();
});
