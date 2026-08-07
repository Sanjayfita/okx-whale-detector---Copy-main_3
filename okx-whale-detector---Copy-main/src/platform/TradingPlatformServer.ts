import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { WebSocketServer } from 'ws';
import type { DashboardSettings, PlatformLogLevel } from './PlatformContracts';
import { PlatformSettingsRepository } from './PlatformSettingsRepository';
import { PlatformStateStore } from './PlatformStateStore';
import type { TradingPlatformEngine } from './TradingPlatformEngine';

export interface TradingPlatformServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly staticDirectory?: string;
  readonly settingsRepository?: PlatformSettingsRepository;
}

const contentTypes: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const sendJson = (
  response: ServerResponse,
  status: number,
  body: unknown,
): void => {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
};

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) {
      throw new Error('request body exceeds 64 KiB');
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const settingsPatch = (value: unknown): Partial<DashboardSettings> => {
  if (!isRecord(value)) throw new Error('settings body must be a JSON object');
  const patch: Partial<DashboardSettings> = {};
  const numberKeys = [
    'fastEmaLength',
    'slowEmaLength',
    'rsiPeriod',
    'atrPeriod',
    'atrMultiplier',
    'minimumAtrPercent',
    'maximumAtrPercent',
    'riskPerTradePercent',
    'stopLossPercent',
    'takeProfitPercent',
    'trailingStopPercent',
  ] as const;
  for (const key of numberKeys) {
    const candidate = value[key];
    if (candidate !== undefined) {
      if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
        throw new Error(`${key} must be a finite number`);
      }
      Object.assign(patch, { [key]: candidate });
    }
  }
  const booleanKeys = ['trailingStopEnabled', 'autoSave'] as const;
  for (const key of booleanKeys) {
    const candidate = value[key];
    if (candidate !== undefined) {
      if (typeof candidate !== 'boolean') throw new Error(`${key} must be boolean`);
      Object.assign(patch, { [key]: candidate });
    }
  }
  if (value.activeStrategyId !== undefined) {
    if (typeof value.activeStrategyId !== 'string') {
      throw new Error('activeStrategyId must be a string');
    }
    patch.activeStrategyId = value.activeStrategyId;
  }
  if (value.mode !== undefined) {
    if (value.mode !== 'PAPER' && value.mode !== 'LIVE') {
      throw new Error('mode must be PAPER or LIVE');
    }
    patch.mode = value.mode;
  }
  return patch;
};

const logLevel = (value: string | null): PlatformLogLevel | undefined =>
  value === 'INFO' ||
  value === 'WARNING' ||
  value === 'ERROR' ||
  value === 'TRADE' ||
  value === 'API'
    ? value
    : undefined;

export class TradingPlatformServer {
  private readonly host: string;
  private readonly port: number;
  private readonly staticDirectory: string;
  private readonly settingsRepository: PlatformSettingsRepository;
  private readonly websocket = new WebSocketServer({ noServer: true });
  private server: Server | null = null;
  private unsubscribe?: () => void;

  public constructor(
    private readonly store: PlatformStateStore,
    private readonly engine: TradingPlatformEngine,
    options: TradingPlatformServerOptions = {},
  ) {
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 4173;
    this.staticDirectory = resolve(options.staticDirectory ?? 'web');
    this.settingsRepository =
      options.settingsRepository ?? new PlatformSettingsRepository();
    if (!Number.isSafeInteger(this.port) || this.port <= 0 || this.port > 65_535) {
      throw new Error('dashboard port must be between 1 and 65535');
    }
  }

  public async start(): Promise<void> {
    if (this.server !== null) throw new Error('trading platform server already started');
    const persisted = await this.settingsRepository.load();
    if (persisted !== null) this.store.updateSettings(persisted);

    const server = createServer((request, response) => {
      void this.handleRequest(request, response).catch((error: unknown) => {
        this.store.log('ERROR', 'Dashboard request failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        if (!response.headersSent) {
          sendJson(response, 500, { error: 'INTERNAL_SERVER_ERROR' });
        } else {
          response.end();
        }
      });
    });
    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname !== '/ws') {
        socket.destroy();
        return;
      }
      this.websocket.handleUpgrade(request, socket, head, (client) => {
        this.websocket.emit('connection', client, request);
      });
    });
    this.websocket.on('connection', (client) => {
      client.send(JSON.stringify({ type: 'snapshot', data: this.store.snapshot() }));
    });
    this.unsubscribe = this.store.subscribe((snapshot) => {
      const payload = JSON.stringify({ type: 'snapshot', data: snapshot });
      for (const client of this.websocket.clients) {
        if (client.readyState === client.OPEN) client.send(payload);
      }
    });

    await new Promise<void>((resolvePromise, reject) => {
      server.once('error', reject);
      server.listen(this.port, this.host, () => {
        server.off('error', reject);
        resolvePromise();
      });
    });
    this.server = server;
    this.store.log('INFO', 'Trading dashboard started', {
      host: this.host,
      port: this.port,
    });
  }

  public async close(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    for (const client of this.websocket.clients) client.close();
    this.websocket.close();
    const server = this.server;
    this.server = null;
    if (server === null) return;
    await new Promise<void>((resolvePromise, reject) => {
      server.close((error) => (error === undefined ? resolvePromise() : reject(error)));
    });
  }

  public getUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://localhost');
    this.store.log('API', `${method} ${url.pathname}`);

    if (method === 'GET' && url.pathname === '/api/health') {
      sendJson(response, 200, {
        status: 'ok',
        strategy: this.store.strategies.getActive().id,
        mode: this.store.getSettings().mode,
        liveExecutionAllowed: false,
      });
      return;
    }
    if (method === 'GET' && url.pathname === '/api/snapshot') {
      sendJson(response, 200, this.store.snapshot());
      return;
    }
    if (method === 'GET' && url.pathname === '/api/trades') {
      sendJson(response, 200, this.store.snapshot().trades);
      return;
    }
    if (method === 'GET' && url.pathname === '/api/analytics') {
      sendJson(response, 200, this.store.snapshot().analytics);
      return;
    }
    if (method === 'GET' && url.pathname === '/api/settings') {
      sendJson(response, 200, this.store.getSettings());
      return;
    }
    if (method === 'GET' && url.pathname === '/api/logs') {
      const requestedLevel = logLevel(url.searchParams.get('level'));
      sendJson(response, 200, this.store.getLogs(requestedLevel));
      return;
    }
    if (method === 'PATCH' && url.pathname === '/api/settings') {
      const updated = this.store.updateSettings(settingsPatch(await readJsonBody(request)));
      if (updated.autoSave) await this.settingsRepository.save(updated);
      sendJson(response, 200, updated);
      return;
    }
    if (method === 'POST' && url.pathname === '/api/risk/kill-switch') {
      const body = await readJsonBody(request);
      if (!isRecord(body) || typeof body.active !== 'boolean') {
        sendJson(response, 400, { error: 'active boolean is required' });
        return;
      }
      this.store.setKillSwitch(body.active);
      sendJson(response, 200, { active: body.active, liveExecutionAllowed: false });
      return;
    }
    if (method === 'POST' && url.pathname === '/api/notifications/daily-summary') {
      this.engine.sendDailySummary();
      sendJson(response, 202, { accepted: true });
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      sendJson(response, 404, { error: 'NOT_FOUND' });
      return;
    }
    await this.serveStatic(url.pathname, response);
  }

  private async serveStatic(pathname: string, response: ServerResponse): Promise<void> {
    const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const requestedPath = resolve(this.staticDirectory, relativePath);
    if (
      requestedPath !== this.staticDirectory &&
      !requestedPath.startsWith(`${this.staticDirectory}${sep}`)
    ) {
      sendJson(response, 403, { error: 'FORBIDDEN' });
      return;
    }

    try {
      const content = await readFile(requestedPath);
      response.writeHead(200, {
        'content-type': contentTypes[extname(requestedPath)] ?? 'application/octet-stream',
        'cache-control': extname(requestedPath) === '.html' ? 'no-store' : 'public, max-age=60',
      });
      response.end(content);
    } catch (error: unknown) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : '';
      if (code === 'ENOENT') {
        sendJson(response, 404, { error: 'NOT_FOUND' });
        return;
      }
      throw error;
    }
  }
}
