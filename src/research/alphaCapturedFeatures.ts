import { extractAlphaFeatures } from './alphaFeatureExtractor';
import { ALPHA_FEATURE_REGISTRY_VERSION } from './alphaFeatureRegistry';
import type {
  AlphaFeatureVector,
  AlphaResearchConfig,
  AlphaResearchEventSnapshot,
} from './alphaFeatureTypes';
import {
  ALPHA_CAPTURED_FEATURE_VALUES_SCHEMA_VERSION,
  ALPHA_FEATURE_NAMES,
} from './alphaFeatureTypes';
import { createAlphaResearchConfigurationFingerprint } from './alphaResearchFingerprint';

export const captureAlphaFeatureValues = (
  snapshot: AlphaResearchEventSnapshot,
  config: AlphaResearchConfig,
): AlphaResearchEventSnapshot => {
  const vector = extractAlphaFeatures(snapshot, config.extraction);
  return Object.freeze({
    ...snapshot,
    capturedFeatures: Object.freeze({
      schemaVersion: ALPHA_CAPTURED_FEATURE_VALUES_SCHEMA_VERSION,
      configurationFingerprint:
        createAlphaResearchConfigurationFingerprint(config),
      featureRegistryVersion: ALPHA_FEATURE_REGISTRY_VERSION,
      values: vector.values,
      enabledFeatureCount: config.extraction.enabledFeatures.length,
      availableFeatureCount: vector.availableFeatureCount,
      missingFeatureCount: vector.missingFeatureCount,
    }),
  });
};

export const resolveAlphaFeatureVector = (
  snapshot: AlphaResearchEventSnapshot,
  config: AlphaResearchConfig,
  requireCaptured = false,
): AlphaFeatureVector => {
  const vector = extractAlphaFeatures(snapshot, config.extraction);
  const captured = snapshot.capturedFeatures;
  if (captured === undefined) {
    if (requireCaptured) {
      throw new Error('Alpha snapshot is missing captured feature values');
    }
    return vector;
  }
  if (
    captured.schemaVersion !== ALPHA_CAPTURED_FEATURE_VALUES_SCHEMA_VERSION ||
    captured.featureRegistryVersion !== ALPHA_FEATURE_REGISTRY_VERSION ||
    captured.configurationFingerprint !==
      createAlphaResearchConfigurationFingerprint(config) ||
    captured.enabledFeatureCount !== config.extraction.enabledFeatures.length ||
    captured.availableFeatureCount !== vector.availableFeatureCount ||
    captured.missingFeatureCount !== vector.missingFeatureCount ||
    ALPHA_FEATURE_NAMES.some(
      (feature) => captured.values[feature] !== vector.values[feature],
    )
  ) {
    throw new Error(
      `Captured feature values do not reproduce for alert ${vector.alertId}`,
    );
  }
  return vector;
};
