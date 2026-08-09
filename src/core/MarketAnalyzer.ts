import type { Whale } from '../types/whale';
import type { MarketBias, MarketSignal } from '../types/signal';

export interface MarketAnalyzerConfig {
  neutralBandPercent: number;
}

const DEFAULT_CONFIG: MarketAnalyzerConfig = {
  neutralBandPercent: 10,
};

export class MarketAnalyzer {
  private readonly config: MarketAnalyzerConfig;

  public constructor(config: Partial<MarketAnalyzerConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  public analyze(activeWhales: Whale[], currentPrice: number): MarketSignal {
    if (activeWhales.length === 0) {
      return {
        bias: 'NEUTRAL',
        confidence: 0,
        bidPressure: 0,
        askPressure: 0,
        netPressure: 0,
        reason: 'No active whale walls',
        timestamp: Date.now(),
      };
    }

    let bidPressure = 0;
    let askPressure = 0;

    for (const whale of activeWhales) {
      const distancePercent =
        Math.abs((whale.price - currentPrice) / currentPrice) * 100;
      const distanceWeight = 1 / (1 + distancePercent);
      const weightedPressure = whale.notionalQuote * distanceWeight;

      if (whale.side === 'BID') {
        bidPressure += weightedPressure;
      } else {
        askPressure += weightedPressure;
      }
    }

    const totalPressure = bidPressure + askPressure;

    if (totalPressure === 0) {
      return {
        bias: 'NEUTRAL',
        confidence: 0,
        bidPressure: 0,
        askPressure: 0,
        netPressure: 0,
        reason: 'No measurable whale pressure',
        timestamp: Date.now(),
      };
    }

    const bidRatio = bidPressure / totalPressure;
    const askRatio = askPressure / totalPressure;
    let bias: MarketBias;
    let confidence: number;
    let reason: string;
    const bidPressurePercent = bidRatio * 100;
    const askPressurePercent = askRatio * 100;
    const netPressure = bidPressurePercent - askPressurePercent;
    const absoluteNetPressure = Math.abs(netPressure);
    const neutralBandPercent = this.config.neutralBandPercent;

    if (absoluteNetPressure < neutralBandPercent) {
      bias = 'NEUTRAL';
      confidence = Math.round(
        (1 - absoluteNetPressure / neutralBandPercent) * 100,
      );
      reason = 'Whale pressure is within the neutral band';
    } else {
      bias = netPressure > 0 ? 'BULLISH' : 'BEARISH';
      confidence = Math.round(
        Math.min(
          100,
          ((absoluteNetPressure - neutralBandPercent) /
            (100 - neutralBandPercent)) *
            100,
        ),
      );
      reason =
        netPressure > 0
          ? 'Bid whale pressure exceeds the neutral band'
          : 'Ask whale pressure exceeds the neutral band';
    }

    return {
      bias,
      confidence,
      bidPressure: bidPressurePercent,
      askPressure: askPressurePercent,
      netPressure,
      reason,
      timestamp: Date.now(),
    };
  }
}
