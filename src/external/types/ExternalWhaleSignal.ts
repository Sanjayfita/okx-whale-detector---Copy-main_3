export type ExternalSignalProvider =
  'WHALE_ALERT' | 'NANSEN' | 'POLYMARKET' | 'MANUAL';

export type ExternalSignalCategory =
  | 'EXCHANGE_INFLOW'
  | 'EXCHANGE_OUTFLOW'
  | 'WALLET_TRANSFER'
  | 'STABLECOIN_MINT'
  | 'STABLECOIN_BURN'
  | 'PREDICTION_TRADE'
  | 'PREDICTION_POSITION';

export type ExternalSignalDirection =
  'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'UNKNOWN';

export interface ExternalSignalEvidence {
  provider: ExternalSignalProvider;
  providerEventId?: string;
  receivedAt: number;
}

export interface ExternalWhaleSignal {
  id: string;
  underlyingEventId: string;
  provider: ExternalSignalProvider;
  category: ExternalSignalCategory;
  direction: ExternalSignalDirection;
  occurredAt: number;
  receivedAt: number;
  confidence: number;
  asset?: string;
  symbol?: string;
  notionalUsd?: number;
  transactionHash?: string;
  description: string;
  evidence: ExternalSignalEvidence[];
  metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface EffectiveExternalSignal {
  signal: ExternalWhaleSignal;
  relevance: number;
  freshness: number;
  effectiveConfidence: number;
}
