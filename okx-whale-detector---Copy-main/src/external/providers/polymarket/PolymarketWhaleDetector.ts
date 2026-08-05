import type {
  ExternalSignalDirection,
  ExternalWhaleSignal,
} from '../../types/ExternalWhaleSignal';
import type {
  PolymarketMarket,
  PolymarketTrade,
} from './PolymarketPublicClient';

export interface PolymarketWhaleDetectorConfig {
  minimumLiquidityUsd: number;
  minimumTradeNotionalUsd: number;
  maximumTradeAgeMs: number;
}

export type PolymarketQuestionPolarity = 'POSITIVE' | 'NEGATIVE' | 'UNKNOWN';

export interface InterpretedPolymarketTrade {
  direction: ExternalSignalDirection;
  polarity: PolymarketQuestionPolarity;
  supportsYes: boolean;
  notionalUsd: number;
  occurredAt: number;
}

const DEFAULT_CONFIG: PolymarketWhaleDetectorConfig = {
  minimumLiquidityUsd: 25_000,
  minimumTradeNotionalUsd: 10_000,
  maximumTradeAgeMs: 60 * 60 * 1_000,
};

const ASSET_PATTERNS: ReadonlyArray<{
  asset: string;
  pattern: RegExp;
}> = [
  { asset: 'BTC', pattern: /\b(?:bitcoin|btc)\b/i },
  { asset: 'ETH', pattern: /\b(?:ethereum|ether|eth)\b/i },
  { asset: 'SOL', pattern: /\b(?:solana|sol)\b/i },
  { asset: 'XRP', pattern: /\bxrp\b/i },
  { asset: 'DOGE', pattern: /\b(?:dogecoin|doge)\b/i },
  { asset: 'USDT', pattern: /\busdt\b/i },
  { asset: 'USDC', pattern: /\busdc\b/i },
];

const GENERAL_CRYPTO_PATTERNS = [
  /\bcrypto(?:currency|currencies)?\b/i,
  /\bstablecoin(?:s)?\b/i,
  /\bblockchain\b/i,
];

const MACRO_PATTERNS = [
  /\bfederal reserve\b/i,
  /\bfed (?:funds |interest )?rate\b/i,
  /\binterest rates?\b/i,
  /\brate cuts?\b/i,
  /\binflation\b/i,
  /\bcpi\b/i,
  /\brecession\b/i,
  /\bsec\b/i,
  /\bcrypto etf\b/i,
  /\bbitcoin etf\b/i,
  /\bethereum etf\b/i,
];

const NEGATIVE_PATTERNS = [
  /\bcrash(?:es|ed|ing)?\b/,
  /\bdip(?:s|ped|ping)?(?:\s+(?:to|below|under))?\s+\$?[\d,.]+/,
  /\bsink(?:s|ing)?(?:\s+(?:to|below|under))?\s+\$?[\d,.]+/,
  /\bfall(?:s|en|ing)?\s+(?:to|below|under)\b/,
  /\bdrop(?:s|ped|ping)?\s+(?:to|below|under)\b/,
  /\bdecline(?:s|d)?\s+(?:to|below|under)\b/,
  /\b(?:be|trade|close|finish|settle)\s+below\b/,
  /\bbelow\s+\$?[\d,.]+/,
  /\bunder\s+\$?[\d,.]+/,
  /\brecession\b/,
  /\bdefault\b/,
  /\bban(?:ned|s)?\b/,
];

const POSITIVE_PATTERNS = [
  /\b(?:be|trade|close|finish|settle)\s+above\b/,
  /\babove\s+\$?[\d,.]+/,
  /\bexceed(?:s|ed)?\b/,
  /\breach(?:es|ed)?\b/,
  /\bhit(?:s)?\s+\$?[\d,.]+/,
  /\brise(?:s|n)?\s+(?:above|to)\b/,
  /\bapprove(?:s|d)?\b/,
  /\brate cut\b/,
];

const BULLISH_OUTCOMES = new Set([
  'up',
  'higher',
  'above',
  'rise',
  'rises',
  'increase',
  'increases',
  'yes - up',
]);

const BEARISH_OUTCOMES = new Set([
  'down',
  'lower',
  'below',
  'fall',
  'falls',
  'decrease',
  'decreases',
  'yes - down',
]);

export const inferPolymarketAsset = (text: string): string | undefined =>
  ASSET_PATTERNS.find(({ pattern }) => pattern.test(text))?.asset;

const reverseDirection = (
  direction: ExternalSignalDirection,
): ExternalSignalDirection => {
  if (direction === 'BULLISH') return 'BEARISH';
  if (direction === 'BEARISH') return 'BULLISH';
  return direction;
};

const toMilliseconds = (timestamp: number): number =>
  timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp;

export class PolymarketWhaleDetector {
  private readonly config: PolymarketWhaleDetectorConfig;

  public constructor(config: Partial<PolymarketWhaleDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  public isRelevantMarket(market: PolymarketMarket): boolean {
    if (market.liquidity < this.config.minimumLiquidityUsd) {
      return false;
    }

    const text = `${market.question} ${market.category ?? ''}`;
    return (
      ASSET_PATTERNS.some(({ pattern }) => pattern.test(text)) ||
      GENERAL_CRYPTO_PATTERNS.some((pattern) => pattern.test(text)) ||
      MACRO_PATTERNS.some((pattern) => pattern.test(text))
    );
  }

  public inferQuestionPolarity(question: string): PolymarketQuestionPolarity {
    const normalized = question.toLowerCase();
    const negativeMatches = NEGATIVE_PATTERNS.filter((pattern) =>
      pattern.test(normalized),
    ).length;
    const positiveMatches = POSITIVE_PATTERNS.filter((pattern) =>
      pattern.test(normalized),
    ).length;

    if (negativeMatches > positiveMatches) return 'NEGATIVE';
    if (positiveMatches > negativeMatches) return 'POSITIVE';
    return 'UNKNOWN';
  }

  public interpretTrade(
    trade: PolymarketTrade,
    market: PolymarketMarket,
  ): InterpretedPolymarketTrade {
    const normalizedOutcome = trade.outcome.trim().toLowerCase();
    const supportsOutcome = trade.side === 'BUY';
    const polarity = this.inferQuestionPolarity(market.question);

    let direction: ExternalSignalDirection = 'UNKNOWN';
    let supportsYes = false;

    if (BULLISH_OUTCOMES.has(normalizedOutcome)) {
      direction = supportsOutcome ? 'BULLISH' : 'BEARISH';
    } else if (BEARISH_OUTCOMES.has(normalizedOutcome)) {
      direction = supportsOutcome ? 'BEARISH' : 'BULLISH';
    } else if (normalizedOutcome === 'yes' || normalizedOutcome === 'no') {
      const outcomeIsNo = normalizedOutcome === 'no';
      supportsYes = outcomeIsNo ? !supportsOutcome : supportsOutcome;

      if (polarity === 'POSITIVE') {
        direction = supportsYes ? 'BULLISH' : 'BEARISH';
      } else if (polarity === 'NEGATIVE') {
        direction = supportsYes ? 'BEARISH' : 'BULLISH';
      }
    }

    if (
      trade.side === 'SELL' &&
      normalizedOutcome !== 'yes' &&
      normalizedOutcome !== 'no'
    ) {
      direction = reverseDirection(
        BULLISH_OUTCOMES.has(normalizedOutcome)
          ? 'BULLISH'
          : BEARISH_OUTCOMES.has(normalizedOutcome)
            ? 'BEARISH'
            : 'UNKNOWN',
      );
    }

    return {
      direction,
      polarity,
      supportsYes,
      notionalUsd: trade.size * trade.price,
      occurredAt: toMilliseconds(trade.timestamp),
    };
  }

  public detect(
    trade: PolymarketTrade,
    market: PolymarketMarket,
    now = Date.now(),
  ): ExternalWhaleSignal | undefined {
    const interpretation = this.interpretTrade(trade, market);
    const ageMs = Math.max(0, now - interpretation.occurredAt);

    if (
      !this.isRelevantMarket(market) ||
      interpretation.notionalUsd < this.config.minimumTradeNotionalUsd ||
      ageMs > this.config.maximumTradeAgeMs
    ) {
      return undefined;
    }

    const tradeScale = Math.min(
      1,
      interpretation.notionalUsd /
        Math.max(this.config.minimumTradeNotionalUsd * 5, 1),
    );
    const liquidityImpact = Math.min(
      1,
      interpretation.notionalUsd / Math.max(market.liquidity, 1),
    );
    const confidence = Math.min(
      75,
      35 + tradeScale * 25 + liquidityImpact * 15,
    );
    const asset = inferPolymarketAsset(
      `${market.question} ${market.category ?? ''}`,
    );

    return {
      id: `polymarket:${trade.transactionHash}:${trade.asset}`,
      underlyingEventId: `polymarket:${trade.transactionHash}:${trade.asset}`,
      provider: 'POLYMARKET',
      category: 'PREDICTION_TRADE',
      direction: interpretation.direction,
      occurredAt: interpretation.occurredAt,
      receivedAt: now,
      confidence,
      asset,
      notionalUsd: interpretation.notionalUsd,
      transactionHash: trade.transactionHash,
      description:
        `${trade.side} ${trade.outcome} on “${market.question}” ` +
        `for approximately $${interpretation.notionalUsd.toFixed(2)} ` +
        `(${interpretation.polarity.toLowerCase()} question).`,
      evidence: [
        {
          provider: 'POLYMARKET',
          providerEventId: `${trade.transactionHash}:${trade.asset}`,
          receivedAt: now,
        },
      ],
      metadata: {
        marketConditionId: market.conditionId,
        marketSlug: market.slug,
        wallet: trade.proxyWallet,
        outcome: trade.outcome,
        side: trade.side,
        price: trade.price,
        size: trade.size,
        liquidityUsd: market.liquidity,
        questionPolarity: interpretation.polarity,
        supportsYes: interpretation.supportsYes,
      },
    };
  }
}
