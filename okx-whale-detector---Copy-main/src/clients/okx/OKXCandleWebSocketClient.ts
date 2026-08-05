import WebSocket from 'ws';
import { isRecord } from './okxValidation';
import type { PipelineProfiler } from '../../core/PipelineProfiler';
import type {
  MessagePerformanceContext,
  ObservedStageTiming,
} from '../../core/PerformanceTrace';

export interface OKXCandle {
  instId: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  volumeCurrency: number;
  volumeCurrencyQuote: number;
  confirm: boolean;
}

export class OKXCandleWebSocketClient {
  private ws: WebSocket | null = null;
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private awaitingHeartbeatResponse = false;
  private reconnectAttempt = 0;
  private intentionallyClosed = false;

  private readonly url = 'wss://ws.okx.com:8443/ws/v5/business';

  private readonly candleSubscriptions = new Set<string>();

  private onCandleUpdate?: (
    candle: OKXCandle,
    performanceContext?: MessagePerformanceContext,
  ) => void;

  constructor(private readonly profiler?: PipelineProfiler) {
    this.connect();
  }

  private connect(): void {
    if (this.intentionallyClosed) {
      return;
    }

    const ws = new WebSocket(this.url, {
      maxPayload: 2 * 1024 * 1024,
      perMessageDeflate: false,
    });

    this.ws = ws;

    ws.on('open', () => {
      console.log('Connected to OKX Candle WebSocket');

      this.reconnectAttempt = 0;
      this.awaitingHeartbeatResponse = false;
      this.startHeartbeat();
      this.resubscribeAll();
    });

    ws.on('message', (data) => {
      this.awaitingHeartbeatResponse = false;
      this.handleMessage(data, performance.now());
    });

    ws.on('error', (error) => {
      console.error('OKX Candle WebSocket error:', error);
    });

    ws.on('close', () => {
      console.log('❌ Disconnected from OKX Candle WebSocket');

      this.stopHeartbeat();

      if (!this.intentionallyClosed) {
        this.scheduleReconnect();
      }
    });
  }

  private handleMessage(data: WebSocket.RawData, receivedAt: number): void {
    const timings: ObservedStageTiming[] = [];
    const stringStartedAt = performance.now();
    const rawMessage = data.toString();
    this.recordTiming(
      'okx.candle.raw.toString',
      performance.now() - stringStartedAt,
      timings,
    );

    if (rawMessage === 'pong') {
      return;
    }

    let message: unknown;
    const parseStartedAt = performance.now();

    try {
      message = JSON.parse(rawMessage);
    } catch (error) {
      console.error('Failed to parse Candle WebSocket message:', error);

      return;
    } finally {
      this.recordTiming(
        'okx.candle.json.parse',
        performance.now() - parseStartedAt,
        timings,
      );
    }

    const validationStartedAt = performance.now();

    if (!isRecord(message)) {
      console.error('Rejected non-object OKX candle message');

      return;
    }

    if (typeof message.event === 'string') {
      console.log('OKX Candle event:', message);

      return;
    }

    if (!isRecord(message.arg)) {
      console.error('Rejected candle message without valid arg');

      return;
    }

    const channel = message.arg.channel;

    const instId = message.arg.instId;

    if (channel !== 'candle1m' || typeof instId !== 'string') {
      return;
    }

    if (!Array.isArray(message.data) || message.data.length === 0) {
      console.error('Rejected candle message without valid data');

      return;
    }

    const values = message.data[0];

    if (!Array.isArray(values) || values.length < 9) {
      console.error('Rejected malformed OKX candle payload');

      return;
    }

    const timestamp = Number(values[0]);

    const open = Number(values[1]);

    const high = Number(values[2]);

    const low = Number(values[3]);

    const close = Number(values[4]);

    const volume = Number(values[5]);

    const volumeCurrency = Number(values[6]);

    const volumeCurrencyQuote = Number(values[7]);

    if (
      !Number.isSafeInteger(timestamp) ||
      timestamp < 0 ||
      !Number.isFinite(open) ||
      open <= 0 ||
      !Number.isFinite(high) ||
      high <= 0 ||
      !Number.isFinite(low) ||
      low <= 0 ||
      !Number.isFinite(close) ||
      close <= 0 ||
      !Number.isFinite(volume) ||
      volume < 0 ||
      !Number.isFinite(volumeCurrency) ||
      volumeCurrency < 0 ||
      !Number.isFinite(volumeCurrencyQuote) ||
      volumeCurrencyQuote < 0 ||
      high < Math.max(open, close) ||
      low > Math.min(open, close) ||
      (values[8] !== '0' && values[8] !== '1')
    ) {
      console.error('Rejected invalid OKX candle values');

      return;
    }

    const candle: OKXCandle = {
      instId,
      timestamp,
      open,
      high,
      low,
      close,
      volume,
      volumeCurrency,
      volumeCurrencyQuote,
      confirm: values[8] === '1',
    };
    this.recordTiming(
      'okx.candle.validationTransform',
      performance.now() - validationStartedAt,
      timings,
    );
    const handlerStartedAt = performance.now();
    const queueDelayMs = Math.max(0, handlerStartedAt - receivedAt);
    this.profiler?.record('okx.candle.queueDelay', queueDelayMs);

    try {
      this.onCandleUpdate?.(candle, {
        queueDelayMs,
        stages: timings,
      });
    } catch (error) {
      console.error(`Candle callback failed for ` + `${candle.instId}:`, error);
    } finally {
      this.profiler?.record(
        'okx.candle.handler',
        performance.now() - handlerStartedAt,
      );
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    const delayMs = Math.min(30_000, 1_000 * 2 ** this.reconnectAttempt);

    this.reconnectAttempt += 1;

    console.log(`Reconnecting Candle WebSocket in ` + `${delayMs / 1_000}s...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;

      this.connect();
    }, delayMs);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      const ws = this.ws;

      if (ws?.readyState !== WebSocket.OPEN) {
        return;
      }

      if (this.awaitingHeartbeatResponse) {
        console.warn('OKX Candle WebSocket heartbeat timed out; reconnecting');
        this.awaitingHeartbeatResponse = false;
        ws.terminate();
        return;
      }

      try {
        ws.send('ping');
        this.awaitingHeartbeatResponse = true;
      } catch (error: unknown) {
        console.error('Failed to send OKX Candle WebSocket heartbeat:', error);
        ws.terminate();
      }
    }, 20_000);
  }

  private stopHeartbeat(): void {
    this.awaitingHeartbeatResponse = false;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);

      this.heartbeatTimer = undefined;
    }
  }

  private resubscribeAll(): void {
    for (const instId of this.candleSubscriptions) {
      this.sendCandleSubscription(instId);
    }
  }

  private sendCandleSubscription(instId: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return;
    }

    this.ws.send(
      JSON.stringify({
        op: 'subscribe',
        args: [
          {
            channel: 'candle1m',
            instId,
          },
        ],
      }),
    );

    console.log(`📈 Subscribed to ${instId} 1m candles`);
  }

  public onCandle(
    callback: (
      candle: OKXCandle,
      performanceContext?: MessagePerformanceContext,
    ) => void,
  ): void {
    this.onCandleUpdate = callback;
  }

  public subscribeToCandle(instId: string): void {
    this.candleSubscriptions.add(instId);

    this.sendCandleSubscription(instId);
  }

  public close(): void {
    if (this.intentionallyClosed) {
      return;
    }

    this.intentionallyClosed = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);

      this.reconnectTimer = undefined;
    }

    this.stopHeartbeat();

    console.log('Closing OKX Candle WebSocket intentionally...');

    this.ws?.close();
    this.ws = null;
  }

  private recordTiming(
    stage: string,
    durationMs: number,
    timings: ObservedStageTiming[],
  ): void {
    this.profiler?.record(stage, durationMs);
    timings.push({ stage, durationMs });
  }
}
