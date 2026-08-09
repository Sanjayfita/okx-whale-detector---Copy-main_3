import WebSocket from 'ws';
import type { PipelineProfiler } from '../../../core/PipelineProfiler';

export interface PolymarketLiveTrade {
  conditionId: string;
  tokenId: string;
  price: number;
  size: number;
  side: 'BUY' | 'SELL';
  timestamp: number;
  transactionHash?: string;
}

export interface PolymarketMarketWebSocketClientConfig {
  url: string;
  heartbeatMs: number;
  reconnectMs: number;
}

const DEFAULT_CONFIG: PolymarketMarketWebSocketClientConfig = {
  url: 'wss://ws-subscriptions-clob.polymarket.com/ws/market',
  heartbeatMs: 10_000,
  reconnectMs: 3_000,
};

const toFiniteNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export class PolymarketMarketWebSocketClient {
  private readonly tokenIds: string[];
  private readonly config: PolymarketMarketWebSocketClientConfig;
  private readonly onTrade: (trade: PolymarketLiveTrade) => void;
  private ws?: WebSocket;
  private heartbeat?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private stopped = false;

  public constructor(
    tokenIds: readonly string[],
    onTrade: (trade: PolymarketLiveTrade) => void,
    config: Partial<PolymarketMarketWebSocketClientConfig> = {},
    private readonly profiler?: PipelineProfiler,
  ) {
    this.tokenIds = [...new Set(tokenIds.filter(Boolean))];
    this.onTrade = onTrade;
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.tokenIds.length === 0) {
      throw new Error('At least one Polymarket token ID is required');
    }
  }

  public connect(): void {
    this.stopped = false;
    this.openSocket();
  }

  public close(): void {
    this.stopped = true;
    this.clearTimers();
    this.ws?.close();
    this.ws = undefined;
  }

  private openSocket(): void {
    this.ws = new WebSocket(this.config.url);

    this.ws.on('open', () => {
      this.ws?.send(
        JSON.stringify({
          assets_ids: this.tokenIds,
          type: 'market',
          custom_feature_enabled: true,
        }),
      );

      this.heartbeat = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send('PING');
        }
      }, this.config.heartbeatMs);
    });

    this.ws.on('message', (data) => {
      const receivedAt = performance.now();
      const stringStartedAt = performance.now();
      const raw = data.toString();
      this.profiler?.record(
        'polymarket.raw.toString',
        performance.now() - stringStartedAt,
      );
      this.handleMessage(raw, receivedAt);
    });

    this.ws.on('close', () => {
      this.clearTimers();
      if (!this.stopped) {
        this.reconnectTimer = setTimeout(
          () => this.openSocket(),
          this.config.reconnectMs,
        );
      }
    });

    this.ws.on('error', (error) => {
      console.error('Polymarket WebSocket error:', error.message);
    });
  }

  private handleMessage(raw: string, receivedAt: number): void {
    if (raw === 'PONG' || !raw.trim()) return;

    let parsed: unknown;
    const parseStartedAt = performance.now();

    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    } finally {
      this.profiler?.record(
        'polymarket.json.parse',
        performance.now() - parseStartedAt,
      );
    }

    const messages = Array.isArray(parsed) ? parsed : [parsed];
    for (const message of messages) {
      const validationStartedAt = performance.now();
      if (!message || typeof message !== 'object') continue;

      const value = message as Record<string, unknown>;
      const eventType = String(value.event_type ?? value.type ?? '');
      if (eventType !== 'last_trade_price') continue;

      const payloadValue =
        value.payload && typeof value.payload === 'object'
          ? (value.payload as Record<string, unknown>)
          : value;
      const side = payloadValue.side;
      if (side !== 'BUY' && side !== 'SELL') continue;

      const timestampValue = payloadValue.timestamp;
      const parsedTimestamp = toFiniteNumber(timestampValue);
      const timestamp =
        parsedTimestamp > 0
          ? parsedTimestamp < 10_000_000_000
            ? parsedTimestamp * 1_000
            : parsedTimestamp
          : Date.now();

      const trade: PolymarketLiveTrade = {
        conditionId: String(payloadValue.market ?? ''),
        tokenId: String(
          payloadValue.tokenId ??
            payloadValue.asset_id ??
            payloadValue.assetId ??
            '',
        ),
        price: toFiniteNumber(payloadValue.price),
        size: toFiniteNumber(payloadValue.size),
        side,
        timestamp,
        transactionHash:
          typeof payloadValue.transactionHash === 'string'
            ? payloadValue.transactionHash
            : typeof payloadValue.transaction_hash === 'string'
              ? payloadValue.transaction_hash
              : undefined,
      };
      this.profiler?.record(
        'polymarket.validationTransform',
        performance.now() - validationStartedAt,
      );
      const handlerStartedAt = performance.now();
      this.profiler?.record(
        'polymarket.queueDelay',
        Math.max(0, handlerStartedAt - receivedAt),
      );
      try {
        this.onTrade(trade);
      } finally {
        this.profiler?.record(
          'polymarket.handler',
          performance.now() - handlerStartedAt,
        );
      }
    }
  }

  private clearTimers(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.heartbeat = undefined;
    this.reconnectTimer = undefined;
  }
}
