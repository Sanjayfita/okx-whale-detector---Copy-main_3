import { describe, expect, it } from 'vitest';

import {
  ALPHA_FEATURE_REGISTRY,
  ALPHA_FEATURE_REGISTRY_VERSION,
  getAlphaFeatureDefinition,
} from '../src/research/alphaFeatureRegistry';
import { ALPHA_FEATURE_NAMES } from '../src/research/alphaFeatureTypes';

describe('alpha feature registry', () => {
  it('catalogs every schema feature once with research-only metadata', () => {
    expect(ALPHA_FEATURE_REGISTRY_VERSION).toBe('alpha-feature-registry-v1');
    expect(
      ALPHA_FEATURE_REGISTRY.map((definition) => definition.name),
    ).toHaveLength(ALPHA_FEATURE_NAMES.length);
    expect(
      new Set(ALPHA_FEATURE_REGISTRY.map((definition) => definition.name)),
    ).toEqual(new Set(ALPHA_FEATURE_NAMES));
    expect(
      ALPHA_FEATURE_REGISTRY.every(
        (definition) =>
          !definition.futureInformationAllowed &&
          !definition.productionEnabled &&
          definition.sources.length > 0,
      ),
    ).toBe(true);
  });

  it('exposes typed source and orientation metadata', () => {
    expect(getAlphaFeatureDefinition('cvd_ratio_directional')).toMatchObject({
      group: 'TRADE_FLOW',
      sources: ['ALERT', 'TRADES'],
      orientation: 'ALERT_DIRECTIONAL',
    });
    expect(getAlphaFeatureDefinition('spread_bps')).toMatchObject({
      group: 'ORDER_BOOK',
      orientation: 'RAW',
    });
  });
});
