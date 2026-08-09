import {
  ALPHA_RESEARCH_EVENT_SNAPSHOT_SCHEMA_VERSION,
  type AlphaMarketContextSnapshot,
  type AlphaResearchEventSnapshot,
} from './alphaFeatureTypes';
import { parseQualifiedAlertEvidenceRecord } from './qualifiedAlertEvidence';

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
  return Object.freeze({
    schemaVersion: ALPHA_RESEARCH_EVENT_SNAPSHOT_SCHEMA_VERSION,
    evidence,
    candles: Object.freeze([...input.marketContext.candles]),
    orderBook: input.marketContext.orderBook,
    trades: Object.freeze([...input.marketContext.trades]),
    whale: input.marketContext.whale,
    synthetic: input.synthetic ?? false,
    liveOrderExecutionAllowed: false,
  });
};
