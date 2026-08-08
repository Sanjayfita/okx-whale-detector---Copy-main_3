type Timeframe = '1m' | '3m' | '5m' | '15m' | '30m' | '1H' | '2H' | '4H';
type TimeframeState = 'READY' | 'REBUILDING' | 'ERROR';

interface SettingsResponse {
  timeframe: Timeframe;
}

interface SnapshotResponse {
  timeframe: {
    selected: Timeframe;
    state: TimeframeState;
    message: string;
  };
}

const timeframes: readonly Timeframe[] = [
  '1m',
  '3m',
  '5m',
  '15m',
  '30m',
  '1H',
  '2H',
  '4H',
];

let selected: Timeframe = '1m';
let state: TimeframeState = 'READY';
let statusMessage = 'Using confirmed OKX 1m candles';
let changing = false;

const options = (): string =>
  timeframes
    .map(
      (timeframe) =>
        `<option value="${timeframe}" ${timeframe === selected ? 'selected' : ''}>${timeframe}</option>`,
    )
    .join('');

const installStyle = (): void => {
  if (document.querySelector('#timeframe-control-style')) return;
  const style = document.createElement('style');
  style.id = 'timeframe-control-style';
  style.textContent = `
    .timeframe-control{display:flex;align-items:center;gap:7px;padding:5px 8px;border:1px solid #20334a;border-radius:8px;background:#0d1929;color:#8fa2b9;font-size:11px}
    .timeframe-control select{min-width:66px;background:#0a1625;color:#e8eef8;border:1px solid #2a4059;border-radius:6px;padding:5px 7px}
    .timeframe-control.rebuilding{border-color:#8f6d2e}.timeframe-control.error{border-color:#8f3542}
    .timeframe-status{font-size:10px;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  `;
  document.head.append(style);
};

const patchTimeframe = async (timeframe: Timeframe): Promise<void> => {
  changing = true;
  selected = timeframe;
  state = 'REBUILDING';
  statusMessage = `Loading confirmed OKX ${timeframe} history...`;
  ensureControls();
  try {
    const response = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timeframe }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `HTTP ${response.status}`);
    }
    await refreshState();
  } catch (error: unknown) {
    state = 'ERROR';
    statusMessage = error instanceof Error ? error.message : String(error);
  } finally {
    changing = false;
    ensureControls();
  }
};

const refreshState = async (): Promise<void> => {
  const response = await fetch('/api/snapshot', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Snapshot HTTP ${response.status}`);
  const snapshot = (await response.json()) as SnapshotResponse;
  selected = snapshot.timeframe.selected;
  state = snapshot.timeframe.state;
  statusMessage = snapshot.timeframe.message;
};

const bindSelect = (select: HTMLSelectElement): void => {
  if (select.dataset.timeframeBound === 'true') return;
  select.dataset.timeframeBound = 'true';
  select.addEventListener('change', () => {
    const next = select.value as Timeframe;
    if (!timeframes.includes(next) || next === selected || changing) return;
    void patchTimeframe(next);
  });
};

const ensureTopControl = (): void => {
  const actions = document.querySelector<HTMLElement>('.top-actions');
  if (!actions) return;
  let wrapper = actions.querySelector<HTMLElement>('#timeframe-control');
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.id = 'timeframe-control';
    actions.prepend(wrapper);
  }
  wrapper.className = `timeframe-control ${state === 'REBUILDING' ? 'rebuilding' : state === 'ERROR' ? 'error' : ''}`;
  wrapper.innerHTML = `<label for="timeframe-select">Timeframe</label><select id="timeframe-select" ${changing ? 'disabled' : ''}>${options()}</select><span class="timeframe-status" title="${statusMessage.replaceAll('"', '&quot;')}">${state === 'REBUILDING' ? `Loading ${selected}…` : state === 'ERROR' ? 'Error' : selected}</span>`;
  const select = wrapper.querySelector<HTMLSelectElement>('#timeframe-select');
  if (select) bindSelect(select);
};

const ensureSettingsControl = (): void => {
  const strategySelect = document.querySelector<HTMLSelectElement>('#activeStrategyId');
  const formGrid = strategySelect?.closest('.form-grid');
  if (!formGrid || formGrid.querySelector('#settings-timeframe-field')) return;
  const field = document.createElement('div');
  field.className = 'field';
  field.id = 'settings-timeframe-field';
  field.innerHTML = `<label for="settings-timeframe-select">Timeframe</label><select id="settings-timeframe-select" ${changing ? 'disabled' : ''}>${options()}</select><small>${statusMessage}</small>`;
  strategySelect.closest('.field')?.after(field);
  const select = field.querySelector<HTMLSelectElement>('#settings-timeframe-select');
  if (select) bindSelect(select);
};

const ensureControls = (): void => {
  installStyle();
  ensureTopControl();
  ensureSettingsControl();
};

const observer = new MutationObserver(() => ensureControls());
observer.observe(document.body, { childList: true, subtree: true });

void fetch('/api/settings', { cache: 'no-store' })
  .then(async (response) => {
    if (!response.ok) throw new Error(`Settings HTTP ${response.status}`);
    const settings = (await response.json()) as SettingsResponse;
    selected = settings.timeframe ?? '1m';
    await refreshState();
  })
  .catch(() => undefined)
  .finally(() => ensureControls());
