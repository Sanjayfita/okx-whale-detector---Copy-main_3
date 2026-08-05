import type { MarketSignal } from '../../types/signal';
import type { ExternalWhaleSignal } from '../types/ExternalWhaleSignal';

export interface SyntheticExternalScenario {
  name: string;
  description: string;
  symbol: string;
  now: number;
  okxSignal: MarketSignal;
  signals: ExternalWhaleSignal[];
}

const NOW = 1_800_000_000_000;

const createSignal = (
  overrides: Partial<ExternalWhaleSignal> &
    Pick<
      ExternalWhaleSignal,
      | 'id'
      | 'underlyingEventId'
      | 'provider'
      | 'category'
      | 'direction'
      | 'description'
    >,
): ExternalWhaleSignal => ({
  occurredAt: NOW - 60_000,
  receivedAt: NOW - 55_000,
  confidence: 75,
  asset: 'BTC',
  evidence: [
    {
      provider: overrides.provider,
      receivedAt: NOW - 55_000,
    },
  ],
  ...overrides,
});

const createOkxSignal = (
  bias: MarketSignal['bias'],
  confidence: number,
  reason: string,
): MarketSignal => ({
  bias,
  confidence,
  reason,
  bidPressure: bias === 'BULLISH' ? confidence : 100 - confidence,
  askPressure: bias === 'BEARISH' ? confidence : 100 - confidence,
  netPressure:
    bias === 'BULLISH' ? confidence : bias === 'BEARISH' ? -confidence : 0,
  timestamp: NOW,
});

export const SYNTHETIC_EXTERNAL_SCENARIOS: readonly SyntheticExternalScenario[] =
  [
    {
      name: 'bearish-agreement',
      description:
        'OKX sell pressure agrees with a large BTC exchange inflow and bearish Polymarket activity.',
      symbol: 'BTC-USDT',
      now: NOW,
      okxSignal: createOkxSignal('BEARISH', 68, 'Persistent ASK pressure'),
      signals: [
        createSignal({
          id: 'wa-inflow-1',
          underlyingEventId: 'tx:bearish-btc-inflow',
          provider: 'WHALE_ALERT',
          category: 'EXCHANGE_INFLOW',
          direction: 'BEARISH',
          confidence: 82,
          notionalUsd: 18_400_000,
          description: '$18.4M BTC transferred to an exchange',
        }),
        createSignal({
          id: 'poly-bearish-1',
          underlyingEventId: 'polymarket:crypto-downside-1',
          provider: 'POLYMARKET',
          category: 'PREDICTION_TRADE',
          direction: 'BEARISH',
          confidence: 64,
          symbol: 'BTC-USDT',
          notionalUsd: 240_000,
          description:
            'Large trade increased probability of a bearish crypto event',
        }),
      ],
    },
    {
      name: 'bullish-agreement',
      description:
        'OKX buy pressure agrees with a BTC exchange withdrawal and bullish prediction-market positioning.',
      symbol: 'BTC-USDT',
      now: NOW,
      okxSignal: createOkxSignal('BULLISH', 66, 'Persistent BID support'),
      signals: [
        createSignal({
          id: 'wa-outflow-1',
          underlyingEventId: 'tx:bullish-btc-outflow',
          provider: 'WHALE_ALERT',
          category: 'EXCHANGE_OUTFLOW',
          direction: 'BULLISH',
          confidence: 78,
          notionalUsd: 22_000_000,
          description: '$22M BTC withdrawn from an exchange',
        }),
        createSignal({
          id: 'poly-bullish-1',
          underlyingEventId: 'polymarket:crypto-upside-1',
          provider: 'POLYMARKET',
          category: 'PREDICTION_POSITION',
          direction: 'BULLISH',
          confidence: 61,
          symbol: 'BTC-USDT',
          description: 'Large position favored a bullish Bitcoin outcome',
        }),
      ],
    },
    {
      name: 'contradiction',
      description:
        'OKX is bullish while fresh external evidence points bearish, reducing combined confidence.',
      symbol: 'BTC-USDT',
      now: NOW,
      okxSignal: createOkxSignal('BULLISH', 72, 'Strong BID imbalance'),
      signals: [
        createSignal({
          id: 'wa-inflow-2',
          underlyingEventId: 'tx:contradicting-inflow',
          provider: 'WHALE_ALERT',
          category: 'EXCHANGE_INFLOW',
          direction: 'BEARISH',
          confidence: 88,
          description: 'Large BTC exchange inflow contradicts OKX buy pressure',
        }),
      ],
    },
    {
      name: 'duplicate-confirmation',
      description:
        'Whale Alert and Nansen report the same transaction; it must count as one event with two evidence providers.',
      symbol: 'BTC-USDT',
      now: NOW,
      okxSignal: createOkxSignal('BEARISH', 58, 'Moderate ASK pressure'),
      signals: [
        createSignal({
          id: 'wa-duplicate',
          underlyingEventId: 'tx:shared-abc123',
          provider: 'WHALE_ALERT',
          category: 'EXCHANGE_INFLOW',
          direction: 'BEARISH',
          confidence: 70,
          transactionHash: 'abc123',
          description: 'Whale Alert identified a BTC exchange inflow',
        }),
        createSignal({
          id: 'nansen-duplicate',
          underlyingEventId: 'tx:shared-abc123',
          provider: 'NANSEN',
          category: 'EXCHANGE_INFLOW',
          direction: 'BEARISH',
          confidence: 84,
          transactionHash: 'abc123',
          description:
            'Nansen labeled the same BTC transfer as an exchange inflow',
        }),
      ],
    },
    {
      name: 'stale-and-unrelated',
      description:
        'Old BTC evidence and unrelated ETH activity are ignored for the selected gold market.',
      symbol: 'XAU-USDT-SWAP',
      now: NOW,
      okxSignal: createOkxSignal('NEUTRAL', 20, 'Balanced gold order book'),
      signals: [
        createSignal({
          id: 'stale-btc',
          underlyingEventId: 'tx:stale-btc',
          provider: 'WHALE_ALERT',
          category: 'EXCHANGE_INFLOW',
          direction: 'BEARISH',
          occurredAt: NOW - 12 * 60 * 60 * 1_000,
          confidence: 95,
          description: 'Old BTC exchange inflow',
        }),
        createSignal({
          id: 'unrelated-eth',
          underlyingEventId: 'tx:unrelated-eth',
          provider: 'NANSEN',
          category: 'WALLET_TRANSFER',
          direction: 'BULLISH',
          asset: 'ETH',
          confidence: 90,
          description: 'ETH wallet accumulation unrelated to gold',
        }),
      ],
    },
  ];

export const getSyntheticExternalScenario = (
  name: string,
): SyntheticExternalScenario | undefined =>
  SYNTHETIC_EXTERNAL_SCENARIOS.find((scenario) => scenario.name === name);
