import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import WebSocket from 'ws';
import { PlatformSettingsRepository } from '../platform/PlatformSettingsRepository';
import { TradingPlatformApplication } from '../platform/TradingPlatformApplication';

interface CdpResponse {
  readonly id?: number;
  readonly result?: unknown;
  readonly error?: { readonly message?: string };
  readonly method?: string;
  readonly params?: unknown;
}

interface RuntimeEvaluation {
  readonly result: { readonly value?: unknown };
  readonly exceptionDetails?: unknown;
}

interface ChromeTarget {
  readonly id: string;
  readonly webSocketDebuggerUrl: string;
}

class CdpClient {
  private sequence = 0;
  private readonly pending = new Map<
    number,
    { readonly resolve: (value: unknown) => void; readonly reject: (error: Error) => void }
  >();
  private readonly listeners = new Map<string, Array<(params: unknown) => void>>();

  private constructor(private readonly socket: WebSocket) {
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString()) as CdpResponse;
      if (message.id !== undefined) {
        const waiter = this.pending.get(message.id);
        if (waiter !== undefined) {
          this.pending.delete(message.id);
          if (message.error !== undefined) {
            waiter.reject(new Error(message.error.message ?? 'CDP command failed'));
          } else waiter.resolve(message.result);
        }
        return;
      }
      if (message.method !== undefined) {
        for (const listener of this.listeners.get(message.method) ?? []) {
          listener(message.params);
        }
      }
    });
    socket.on('close', () => {
      for (const waiter of this.pending.values()) {
        waiter.reject(new Error('Chrome DevTools connection closed'));
      }
      this.pending.clear();
    });
  }

  public static async connect(url: string): Promise<CdpClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    return new CdpClient(socket);
  }

  public on(method: string, listener: (params: unknown) => void): void {
    const values = this.listeners.get(method) ?? [];
    values.push(listener);
    this.listeners.set(method, values);
  }

  public async send<T = unknown>(
    method: string,
    params: Readonly<Record<string, unknown>> = {},
  ): Promise<T> {
    const id = ++this.sequence;
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return (await promise) as T;
  }

  public close(): void {
    this.socket.close();
  }
}

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitFor = async (
  predicate: () => Promise<boolean>,
  description: string,
  timeoutMs = 8_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await sleep(50);
  }
};

const startChrome = async (
  userDataDirectory: string,
): Promise<{ readonly process: ChildProcessWithoutNullStreams; readonly port: number }> => {
  const port = 9_223;
  const executable = process.env.CHROME_BIN?.trim() || 'google-chrome';
  const child = spawn(
    executable,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDirectory}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let startupError = '';
  child.stderr.on('data', (chunk) => {
    startupError += chunk.toString();
  });
  child.stdout.on('data', () => undefined);

  await waitFor(
    async () => {
      if (child.exitCode !== null) {
        throw new Error(
          `Headless Chrome exited during startup (${child.exitCode}): ${startupError}`,
        );
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`);
        return response.ok;
      } catch {
        return false;
      }
    },
    'Chrome DevTools endpoint',
  );
  return { process: child, port };
};

const openPage = async (port: number, url: string): Promise<CdpClient> => {
  const response = await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,
    { method: 'PUT' },
  );
  if (!response.ok) {
    throw new Error(`Unable to create Chrome target: HTTP ${response.status}`);
  }
  const target = (await response.json()) as ChromeTarget;
  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  await client.send('Runtime.enable');
  await client.send('Page.enable');
  await client.send('Log.enable');
  return client;
};

const evaluate = async <T>(client: CdpClient, expression: string): Promise<T> => {
  const response = await client.send<RuntimeEvaluation>('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails !== undefined) {
    throw new Error(`Browser evaluation failed: ${JSON.stringify(response.exceptionDetails)}`);
  }
  return response.result.value as T;
};

const waitForExpression = async (
  client: CdpClient,
  expression: string,
  description: string,
): Promise<void> =>
  waitFor(
    async () => Boolean(await evaluate<unknown>(client, expression)),
    description,
  );

const selectTimeframe = async (
  client: CdpClient,
  timeframe: string,
): Promise<void> => {
  await evaluate(
    client,
    `(() => { const select = document.querySelector('#timeframe-select'); if (!(select instanceof HTMLSelectElement)) return false; select.value = ${JSON.stringify(timeframe)}; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
  );
};

export const validateTradingDashboardBrowser = async (): Promise<void> => {
  const directory = await mkdtemp(join(tmpdir(), 'trading-dashboard-browser-'));
  let reject4H = false;
  const application = new TradingPlatformApplication({
    mode: 'PAPER',
    server: {
      host: '127.0.0.1',
      port: 0,
      staticDirectory: 'web',
      settingsRepository: new PlatformSettingsRepository(join(directory, 'settings.json')),
      onSettingsChanged: async (previous, next) => {
        if (reject4H && previous.timeframe !== '4H' && next.timeframe === '4H') {
          throw new Error('simulated dashboard timeframe rebuild failure');
        }
        if (previous.timeframe !== next.timeframe) await sleep(180);
      },
    },
    environment: {},
  });

  let chrome: ChildProcessWithoutNullStreams | null = null;
  let page: CdpClient | null = null;
  const browserErrors: string[] = [];
  try {
    await application.start();
    const startedChrome = await startChrome(join(directory, 'chrome'));
    chrome = startedChrome.process;
    page = await openPage(startedChrome.port, application.getUrl());
    page.on('Runtime.exceptionThrown', (params) => {
      browserErrors.push(`Runtime.exceptionThrown ${JSON.stringify(params)}`);
    });
    page.on('Log.entryAdded', (params) => {
      const entry =
        typeof params === 'object' && params !== null && 'entry' in params
          ? (params as { entry?: { level?: string; text?: string } }).entry
          : undefined;
      if (entry?.level === 'error') browserErrors.push(entry.text ?? 'browser log error');
    });

    await waitForExpression(
      page,
      `document.querySelector('#timeframe-select') instanceof HTMLSelectElement`,
      'timeframe dropdown',
    );
    const advertised = await evaluate<string[]>(
      page,
      `Array.from(document.querySelectorAll('#timeframe-select option')).map((option) => option.value)`,
    );
    const expected = ['1m', '3m', '5m', '15m', '30m', '1H', '2H', '4H'];
    if (JSON.stringify(advertised) !== JSON.stringify(expected)) {
      throw new Error(`Unexpected browser timeframe options: ${JSON.stringify(advertised)}`);
    }
    const initial = await evaluate<string>(
      page,
      `(document.querySelector('#timeframe-select') as HTMLSelectElement | null)?.value ?? ''`,
    ).catch(async () =>
      evaluate<string>(
        page as CdpClient,
        `document.querySelector('#timeframe-select')?.value ?? ''`,
      ),
    );
    if (initial !== '1m') throw new Error(`Expected browser to start at 1m, got ${initial}`);

    await evaluate(
      page,
      `(() => { window.__timeframeMutationCount = 0; const observer = new MutationObserver((records) => { window.__timeframeMutationCount += records.length; }); observer.observe(document.body, { childList: true, subtree: true, attributes: true }); window.__timeframeMutationObserver = observer; return true; })()`,
    );

    for (const timeframe of ['5m', '15m', '1H', '4H', '1m']) {
      await selectTimeframe(page, timeframe);
      await waitForExpression(
        page,
        `document.querySelector('.timeframe-status')?.textContent?.includes('Loading ${timeframe}') === true`,
        `${timeframe} loading indicator`,
      );
      // The UI must remain responsive while the settings request is intentionally delayed.
      const responsive = await evaluate<boolean>(
        page,
        `document.querySelector('#kill-switch') instanceof HTMLButtonElement`,
      );
      if (!responsive) throw new Error(`Dashboard became unresponsive while loading ${timeframe}`);

      await waitFor(
        async () => {
          const settings = (await (
            await fetch(`${application.getUrl()}/api/settings`, { cache: 'no-store' })
          ).json()) as { timeframe?: string };
          return settings.timeframe === timeframe;
        },
        `backend timeframe ${timeframe}`,
      );
      await waitForExpression(
        page,
        `document.querySelector('#timeframe-select')?.value === ${JSON.stringify(timeframe)}`,
        `browser selected timeframe ${timeframe}`,
      );
      const count = await evaluate<number>(
        page,
        `document.querySelectorAll('#timeframe-control').length`,
      );
      if (count !== 1) throw new Error(`Expected one timeframe control, found ${count}`);

      const mutationsBefore = await evaluate<number>(
        page,
        `window.__timeframeMutationCount ?? 0`,
      );
      await sleep(300);
      const mutationsAfter = await evaluate<number>(
        page,
        `window.__timeframeMutationCount ?? 0`,
      );
      if (mutationsAfter !== mutationsBefore) {
        throw new Error(
          `Dashboard DOM did not settle after ${timeframe} switch (${mutationsBefore} -> ${mutationsAfter})`,
        );
      }
    }

    // Validate all advertised choices in the actual browser, including the three
    // values not present in the requested primary sequence.
    for (const timeframe of ['3m', '30m', '2H', '1m']) {
      await selectTimeframe(page, timeframe);
      await waitFor(
        async () => {
          const settings = (await (
            await fetch(`${application.getUrl()}/api/settings`, { cache: 'no-store' })
          ).json()) as { timeframe?: string };
          return settings.timeframe === timeframe;
        },
        `browser option ${timeframe}`,
      );
    }

    await evaluate(
      page,
      `document.querySelector('[data-tab="settings"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`,
    );
    await waitForExpression(
      page,
      `document.querySelector('#settings-timeframe-select') instanceof HTMLSelectElement`,
      'settings timeframe dropdown',
    );
    const settingsOptions = await evaluate<string[]>(
      page,
      `Array.from(document.querySelectorAll('#settings-timeframe-select option')).map((option) => option.value)`,
    );
    if (JSON.stringify(settingsOptions) !== JSON.stringify(expected)) {
      throw new Error(`Unexpected settings timeframe options: ${JSON.stringify(settingsOptions)}`);
    }

    // Force one settings failure to confirm a user-visible error is rendered and
    // the browser does not silently claim the rejected timeframe is active.
    reject4H = true;
    await selectTimeframe(page, '4H');
    await waitForExpression(
      page,
      `document.querySelector('.timeframe-control')?.classList.contains('error') === true`,
      'timeframe error state',
    );
    const errorLabel = await evaluate<string>(
      page,
      `document.querySelector('.timeframe-status')?.textContent ?? ''`,
    );
    if (!errorLabel.includes('Error')) {
      throw new Error(`Expected visible timeframe error, got ${errorLabel}`);
    }
    const backendAfterFailure = application.store.getSettings().timeframe;
    if (backendAfterFailure !== '1m') {
      throw new Error(`Backend failed to roll rejected browser setting back to 1m`);
    }

    if (browserErrors.length > 0) {
      throw new Error(`Browser console/runtime errors: ${browserErrors.join(' | ')}`);
    }
    console.log('Trading dashboard headless browser validation passed.');
  } finally {
    page?.close();
    chrome?.kill('SIGKILL');
    await application.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
};

if (require.main === module) {
  void validateTradingDashboardBrowser().catch((error: unknown) => {
    console.error(
      'Trading dashboard browser validation failed:',
      error instanceof Error ? error.stack ?? error.message : String(error),
    );
    process.exitCode = 1;
  });
}
