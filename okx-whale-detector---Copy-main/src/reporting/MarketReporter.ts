import type { WhaleChange } from '../types/whale';

import type { WhaleBehavior } from '../core/WhaleBehaviorEngine';

import type { WhaleEvent } from '../core/WhaleEventDetector';

import type { WhaleRefillEvent } from '../core/WhaleRefillDetector';

import type { WhaleScore } from '../core/WhaleScoreEngine';

import type { MarketEvaluation } from '../types/marketEvaluation';
import type { PerformanceRecorder } from '../core/PipelineProfiler';

export interface MarketSummarySignal {
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';

  confidence: number;
  reason: string;
  bidPressure: number;
  askPressure: number;
}

export interface MarketSummaryInput {
  symbol: string;
  currentPrice: number;
  bestBidPrice?: number;
  bestAskPrice?: number;
  aggregates: MarketSummaryAggregates;
  scoredWhales: WhaleScore[];
  marketSignal: MarketSummarySignal;
  evaluation?: MarketEvaluation;
}

export interface MarketSummaryAggregates {
  readonly bidWhaleCount: number;
  readonly askWhaleCount: number;
  readonly totalBidWhaleNotionalQuote: number;
  readonly totalAskWhaleNotionalQuote: number;
  readonly totalActiveWhaleCount: number;
  readonly trackedWallCount: number;
  readonly newWallCount: number;
  readonly activeWallCount: number;
  readonly persistentWallCount: number;
  readonly strongWallCount: number;
}

export class MarketReporter {
  private readonly priceFractionDigits: Readonly<Record<string, number>> = {
    'BTC-USDT': 2,
    'ETH-USDT': 2,
    'SOL-USDT': 2,
    'XRP-USDT': 4,
    'DOGE-USDT': 5,
  };
  private readonly priceFormatters: ReadonlyMap<number, Intl.NumberFormat> =
    new Map(
      [2, 4, 5, 8].map((maximumFractionDigits) => [
        maximumFractionDigits,
        new Intl.NumberFormat('en-US', {
          maximumFractionDigits,
          useGrouping: false,
        }),
      ]),
    );
  private readonly quoteFormatter = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
  });

  public constructor(
    private readonly logger: (message: string) => void = console.log,
  ) {}

  public reportSequenceGap(symbol: string): void {
    console.error(
      `Order-book sequence gap for ${symbol}. ` +
        'Detector output is paused until a new snapshot is received.',
    );
  }

  public reportSequenceRecovery(symbol: string): void {
    this.logger(
      `✅ ${symbol} order book resynchronized from a fresh snapshot.`,
    );
  }

  public reportBehavior(behavior: WhaleBehavior): void {
    this.logger(
      `🧠 ${behavior.type} | ` +
        `${behavior.whale.side} | ` +
        `Confidence: ${behavior.confidence.toFixed(0)}% | ` +
        `${behavior.reason}`,
    );
  }

  public reportSpoof(symbol: string, spoof: WhaleBehavior): void {
    this.logger(
      `🎭 SPOOF DETECTED | ` +
        `${spoof.whale.side} | ` +
        `Price: ${this.formatPrice(symbol, spoof.whale.price)} | ` +
        `Value: ${this.formatQuote(spoof.whale.notionalQuote)} USDT | ` +
        `Confidence: ${spoof.confidence}%`,
    );
  }

  public reportWhaleEvent(symbol: string, event: WhaleEvent): void {
    const whale = event.whale;

    const price = this.formatPrice(symbol, whale.price);

    const value = this.formatQuote(whale.notionalQuote);

    switch (event.type) {
      case 'NEW':
        this.logger(
          `🆕 NEW ${whale.side} WHALE | ` +
            `Price: ${price} | ` +
            `Value: ${value} USDT`,
        );
        break;

      case 'REMOVED':
        this.logger(
          `💥 REMOVED ${whale.side} WHALE | ` +
            `Price: ${price} | ` +
            `Value: ${value} USDT`,
        );
        break;

      case 'INCREASED':
        this.logger(
          `📈 INCREASED ${whale.side} WHALE | ` +
            `Price: ${price} | ` +
            `Value: ${value} USDT`,
        );
        break;

      case 'DECREASED':
        this.logger(
          `📉 DECREASED ${whale.side} WHALE | ` +
            `Price: ${price} | ` +
            `Value: ${value} USDT`,
        );
        break;

      case 'MOVED':
        break;
    }
  }

  public reportRefill(symbol: string, refill: WhaleRefillEvent): void {
    this.logger(
      `🔄 REFILLING ${refill.whale.side} WHALE | ` +
        `Price: ${this.formatPrice(symbol, refill.whale.price)} | ` +
        `Refill: ${this.formatQuote(refill.refillAmountQuote)} USDT | ` +
        `Count: ${refill.refillCount}`,
    );
  }

  public reportMovedWhale(symbol: string, moved: WhaleChange): void {
    const previousPrice =
      moved.previousPrice === undefined
        ? 'unknown'
        : this.formatPrice(symbol, moved.previousPrice);

    this.logger(
      `🚚 MOVED ${moved.side} WHALE | ` +
        `Price: ${previousPrice} → ` +
        `${this.formatPrice(symbol, moved.price)} | ` +
        `Value: ${this.formatQuote(moved.currentNotionalQuote)} USDT`,
    );
  }

  public reportWhaleScore(symbol: string, scored: WhaleScore): void {
    this.logger(
      `🐋 ${scored.whale.side} WHALE SCORE: ` +
        `${scored.totalScore}/100 | ` +
        `${scored.strength} | ` +
        `Price: ${this.formatPrice(symbol, scored.whale.price)}`,
    );
  }

  public reportSummary(
    input: MarketSummaryInput,
    performanceRecorder?: PerformanceRecorder,
  ): void {
    const format = (): string[] => this.formatSummary(input);
    const lines = performanceRecorder
      ? performanceRecorder.measure('summary.formatting', format)
      : format();
    const emit = (): void => this.logger(lines.join('\n'));

    if (performanceRecorder) {
      performanceRecorder.measure('summary.consoleEmission', emit);
    } else {
      emit();
    }
  }

  protected formatSummary(input: MarketSummaryInput): string[] {
    const lines: string[] = [];
    const { aggregates } = input;

    for (const scored of input.scoredWhales) {
      lines.push(
        `🐋 ${scored.whale.side} WHALE SCORE: ` +
          `${scored.totalScore}/100 | ` +
          `${scored.strength} | ` +
          `Price: ${this.formatPrice(input.symbol, scored.whale.price)}`,
      );
    }

    lines.push('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    lines.push(`📡 ${input.symbol}`);
    lines.push(
      `💵 Best Bid: ${this.formatOptionalPrice(
        input.symbol,
        input.bestBidPrice,
      )} | Best Ask: ${this.formatOptionalPrice(
        input.symbol,
        input.bestAskPrice,
      )}`,
    );

    lines.push(
      `💵 Current Price: ${this.formatPrice(input.symbol, input.currentPrice)}`,
    );

    lines.push(
      `🟢 Active BID Whales: ${aggregates.bidWhaleCount} ` +
        `(${this.formatQuote(aggregates.totalBidWhaleNotionalQuote)} USDT)`,
    );

    lines.push(
      `🔴 Active ASK Whales: ${aggregates.askWhaleCount} ` +
        `(${this.formatQuote(aggregates.totalAskWhaleNotionalQuote)} USDT)`,
    );

    lines.push(
      `🐋 Total Active Whale Walls: ${aggregates.totalActiveWhaleCount}`,
    );
    lines.push(`🧱 Tracked Walls: ${aggregates.trackedWallCount}`);
    lines.push(`🆕 New Walls: ${aggregates.newWallCount}`);
    lines.push(`🔵 Active Walls: ${aggregates.activeWallCount}`);
    lines.push(`🟠 Persistent Walls: ${aggregates.persistentWallCount}`);
    lines.push(`🔴 Strong Walls: ${aggregates.strongWallCount}`);
    lines.push('\n📊 MARKET BIAS');
    lines.push(this.formatMarketBias(input.marketSignal));
    lines.push(`💡 ${input.marketSignal.reason}`);
    lines.push(...this.formatCorrelatedIntelligence(input.evaluation));
    lines.push('\n📊 PRESSURE ANALYSIS');
    lines.push(
      `🟢 BID PRESSURE: ${input.marketSignal.bidPressure.toFixed(1)}%`,
    );

    lines.push(
      `🔴 ASK PRESSURE: ${input.marketSignal.askPressure.toFixed(1)}%`,
    );

    lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    return lines;
  }

  private formatMarketBias(signal: MarketSummarySignal): string {
    const confidence = signal.confidence.toFixed(1);

    if (signal.bias === 'BULLISH') {
      return `🟢 BULLISH | Pressure Strength: ${confidence}%`;
    }

    if (signal.bias === 'BEARISH') {
      return `🔴 BEARISH | Pressure Strength: ${confidence}%`;
    }

    return `⚪ NEUTRAL | Pressure Strength: ${confidence}%`;
  }

  private formatCorrelatedIntelligence(
    evaluation: MarketEvaluation | undefined,
  ): string[] {
    const correlatedSignal = evaluation?.correlatedSignal;

    if (!correlatedSignal || correlatedSignal.consideredSignals === 0) {
      return [];
    }

    const lines = [
      '\n📊 CORRELATED INTELLIGENCE',
      `OKX Bias: ${correlatedSignal.okxBias}`,
      `External Bias: ${correlatedSignal.externalBias}`,
      `Relationship: ${correlatedSignal.agreement}`,
      `OKX Confidence: ${correlatedSignal.okxConfidence.toFixed(1)}%`,
      `External Confidence: ${correlatedSignal.externalConfidence.toFixed(1)}%`,
      `Directional Confidence: ${correlatedSignal.confidence.toFixed(1)}%`,
      `Alert Importance: ${correlatedSignal.alertImportance.toFixed(1)}%`,
    ];

    if (correlatedSignal.agreement === 'CONTRADICTION') {
      lines.push(
        'Contradiction warning: alert importance measures source disagreement, not directional certainty.',
      );
    }

    lines.push(
      `External signals used: ${correlatedSignal.consideredSignals}`,
      `Ignored external signals: ${correlatedSignal.ignoredSignals}`,
    );

    return lines;
  }

  private formatOptionalPrice(
    symbol: string,
    value: number | undefined,
  ): string {
    if (value === undefined) {
      return 'N/A';
    }

    return this.formatPrice(symbol, value);
  }

  private formatPrice(symbol: string, value: number): string {
    const maximumFractionDigits = this.priceFractionDigits[symbol] ?? 8;
    const formatter = this.priceFormatters.get(maximumFractionDigits);

    if (!formatter) {
      throw new Error(
        `No market price formatter for ${maximumFractionDigits} fraction digits`,
      );
    }

    return formatter.format(value);
  }

  private formatQuote(value: number): string {
    return this.quoteFormatter.format(value);
  }
}
