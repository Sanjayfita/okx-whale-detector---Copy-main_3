import {
  ALPHA_RESEARCH_EVENT_SNAPSHOT_SCHEMA_VERSION,
  type AlphaMarketContextSnapshot,
  type AlphaResearchEventSnapshot,
} from './alphaFeatureTypes';
import { parseQualifiedAlertEvidenceRecord } from './qualifiedAlertEvidence';
import { ALPHA_FEATURE_REGISTRY_VERSION } from './alphaFeatureRegistry';

export const createAlphaResearchEventSnapshot = (input: {
  readonly evidence: AlphaResearchEventSnapshot['evidence'];
  readonly marketContext: AlphaMarketContextSnapshot;
  readonly synthetic?: boolean;
}): AlphaResearchEventSnapshot => {
  const evidence = parseQualifiedAlertEvidenceRecord(input.evidence);
  if (evidence === undefined) {
    throw new Error('Alpha market context requires valid alert evidence');
  }
  if (
    input.marketContext.instrumentId !== evidence.instrumentId ||
    input.marketContext.detectedAt !== evidence.detectedAt
  ) {
    throw new Error('Alpha market context does not match its alert evidence');
  }
  const availabilityTimestamps = [
    ...input.marketContext.candles.map(
      (candle) => candle.availabilityTimestamp,
    ),
    ...input.marketContext.trades.map((trade) => trade.availabilityTimestamp),
    input.marketContext.orderBook.availabilityTimestamp,
    input.marketContext.whale.availabilityTimestamp,
  ];
  const maximumSourceAvailabilityTimestamp = Math.max(
    0,
    ...availabilityTimestamps,
  );
  if (maximumSourceAvailabilityTimestamp > evidence.detectedAt) {
    throw new Error('Alpha snapshot contains future source information');
  }
  return Object.freeze({
    schemaVersion: ALPHA_RESEARCH_EVENT_SNAPSHOT_SCHEMA_VERSION,
    evidence,
    candles: Object.freeze([...input.marketContext.candles]),
    orderBook: input.marketContext.orderBook,
    trades: Object.freeze([...input.marketContext.trades]),
    whale: input.marketContext.whale,
    derivatives: Object.freeze({
      availabilityTimestamp: evidence.detectedAt,
      fundingRate: null,
      nextFundingTimestamp: null,
      openInterest: null,
      openInterestChange: null,
      missing: true,
    }),
    integrity: Object.freeze({
      eventTimestamp: evidence.detectedAt,
      featureTimestamp: evidence.detectedAt,
      maximumSourceAvailabilityTimestamp,
      featureRegistryVersion: ALPHA_FEATURE_REGISTRY_VERSION,
      temporalIntegrityVerified: true,
      dataQualityFlags: Object.freeze([
        'DERIVATIVES_FUNDING_MISSING',
        'DERIVATIVES_OPEN_INTEREST_MISSING',
      ]),
    }),
    synthetic: input.synthetic ?? false,
    liveOrderExecutionAllowed: false,
  });
};
