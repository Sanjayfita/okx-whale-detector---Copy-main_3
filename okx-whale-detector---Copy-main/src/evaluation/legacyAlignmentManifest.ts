import {
  AlignmentReason,
  alignmentFailure,
  alignmentSuccess,
  type AlignmentValidationResult,
  type InstrumentKey,
} from './alignmentTypes';
import {
  instrumentKeysEqual,
  validateInstrumentKey,
} from './alignmentValidation';

export const LEGACY_ALIGNMENT_MANIFEST_SCHEMA_VERSION = 1 as const;

export type LegacyLinkageProvenance = 'EXPLICIT_EXTERNAL_MANIFEST';

export interface LegacyInstrumentMapping {
  alertSymbol: string;
  marketInstrument: InstrumentKey;
}

export interface LegacyCandleIntervalDeclaration {
  instrument: InstrumentKey;
  interval: string;
}

export interface LegacyAlignmentManifest {
  schemaVersion: typeof LEGACY_ALIGNMENT_MANIFEST_SCHEMA_VERSION;
  manifestId: string;
  alertFileDigest: string;
  marketFileDigest: string;
  instrumentMappings: readonly LegacyInstrumentMapping[];
  candleIntervals?: readonly LegacyCandleIntervalDeclaration[];
  provenance: LegacyLinkageProvenance;
}

export interface LegacyLinkageRequest {
  manifest?: LegacyAlignmentManifest;
  alertFileDigest: string;
  marketFileDigest: string;
  alertSymbol: string;
  expectedInstrument: InstrumentKey;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MANIFEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export const validateLegacyLinkage = (
  request: LegacyLinkageRequest,
): AlignmentValidationResult<LegacyAlignmentManifest> => {
  const expectedInstrumentResult = validateInstrumentKey(
    request.expectedInstrument,
  );
  if (!expectedInstrumentResult.valid) {
    return expectedInstrumentResult;
  }

  if (!request.manifest) {
    return alignmentFailure(
      AlignmentReason.LEGACY_LINKAGE_UNVERIFIED,
      'MISSING',
    );
  }

  const manifest = request.manifest;
  if (
    manifest.schemaVersion !== LEGACY_ALIGNMENT_MANIFEST_SCHEMA_VERSION ||
    manifest.provenance !== 'EXPLICIT_EXTERNAL_MANIFEST' ||
    !MANIFEST_ID_PATTERN.test(manifest.manifestId) ||
    !SHA256_PATTERN.test(manifest.alertFileDigest) ||
    !SHA256_PATTERN.test(manifest.marketFileDigest) ||
    !SHA256_PATTERN.test(request.alertFileDigest) ||
    !SHA256_PATTERN.test(request.marketFileDigest) ||
    manifest.alertFileDigest !== request.alertFileDigest ||
    manifest.marketFileDigest !== request.marketFileDigest
  ) {
    return alignmentFailure(
      AlignmentReason.LEGACY_LINKAGE_UNVERIFIED,
      'MISSING',
    );
  }

  const matchingMappings = manifest.instrumentMappings.filter(
    (mapping) => mapping.alertSymbol === request.alertSymbol,
  );
  if (matchingMappings.length === 0) {
    return alignmentFailure(AlignmentReason.INSTRUMENT_MISMATCH, 'MISSING');
  }

  if (matchingMappings.length > 1) {
    return alignmentFailure(
      AlignmentReason.INSTRUMENT_METADATA_CONFLICT,
      'AMBIGUOUS',
    );
  }

  const mapping = matchingMappings[0];
  if (!mapping) {
    return alignmentFailure(AlignmentReason.INSTRUMENT_MISMATCH, 'MISSING');
  }

  const mappingInstrumentResult = validateInstrumentKey(
    mapping.marketInstrument,
  );
  if (!mappingInstrumentResult.valid) {
    return mappingInstrumentResult;
  }

  if (
    !instrumentKeysEqual(mapping.marketInstrument, request.expectedInstrument)
  ) {
    return alignmentFailure(
      mapping.marketInstrument.instId === request.expectedInstrument.instId
        ? AlignmentReason.INSTRUMENT_METADATA_CONFLICT
        : AlignmentReason.INSTRUMENT_MISMATCH,
      'MISSING',
    );
  }

  for (const declaration of manifest.candleIntervals ?? []) {
    const instrumentResult = validateInstrumentKey(declaration.instrument);
    if (!instrumentResult.valid || declaration.interval.trim().length === 0) {
      return alignmentFailure(
        AlignmentReason.CANDLE_INTERVAL_UNKNOWN,
        'PARTIAL',
      );
    }
  }

  return alignmentSuccess(manifest);
};
