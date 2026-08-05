import {
  ALPHA_FEATURE_NAMES,
  type AlphaFeatureName,
} from './alphaFeatureTypes';

export const ALPHA_FEATURE_REGISTRY_VERSION =
  'alpha-feature-registry-v1' as const;

export type AlphaFeatureGroup =
  | 'TREND'
  | 'STRUCTURE_LIQUIDITY'
  | 'TRADE_FLOW'
  | 'ORDER_BOOK'
  | 'VOLATILITY_VOLUME_VALUE'
  | 'STRENGTH_MOMENTUM'
  | 'SESSION'
  | 'WHALE_LIFECYCLE';

export type AlphaFeatureSource =
  'ALERT' | 'CANDLES' | 'TRADES' | 'ORDER_BOOK' | 'WHALE_CONTEXT';

export interface AlphaFeatureDefinition {
  readonly name: AlphaFeatureName;
  readonly group: AlphaFeatureGroup;
  readonly sources: readonly AlphaFeatureSource[];
  readonly orientation: 'ALERT_DIRECTIONAL' | 'RAW';
  readonly futureInformationAllowed: false;
  readonly productionEnabled: false;
}

const FEATURE_GROUPS = Object.freeze({
  TREND: Object.freeze([
    'ema_fast_distance_directional_percent',
    'ema_medium_distance_directional_percent',
    'ema_slow_distance_directional_percent',
    'ema_fast_medium_spread_directional_percent',
    'ema_medium_slow_spread_directional_percent',
    'ema_fast_slope_directional_percent',
    'ema_medium_slope_directional_percent',
    'ema_alignment_directional',
    'ema_multi_timeframe_alignment_directional',
    'return_short_directional_percent',
    'return_long_directional_percent',
  ]),
  STRUCTURE_LIQUIDITY: Object.freeze([
    'market_structure_directional',
    'break_of_structure_directional',
    'change_of_character_directional',
    'range_position_directional',
    'equal_high_distance_percent',
    'equal_low_distance_percent',
    'liquidity_sweep_directional',
    'swing_failure_directional',
    'fvg_directional',
    'order_block_directional',
  ]),
  TRADE_FLOW: Object.freeze([
    'cvd_notional_log_directional',
    'cvd_ratio_directional',
    'trade_count_log',
  ]),
  ORDER_BOOK: Object.freeze([
    'book_imbalance_l1_directional',
    'book_imbalance_depth_directional',
    'microprice_offset_directional_bps',
    'spread_bps',
  ]),
  VOLATILITY_VOLUME_VALUE: Object.freeze([
    'atr_percent',
    'realized_volatility_percent',
    'volatility_compression_ratio',
    'relative_volume',
    'volume_zscore',
    'vwap_distance_directional_percent',
    'anchored_vwap_distance_directional_percent',
  ]),
  STRENGTH_MOMENTUM: Object.freeze([
    'adx',
    'dmi_directional',
    'rsi_directional',
    'macd_histogram_directional_percent',
    'macd_slope_directional_percent',
    'trend_efficiency_ratio',
  ]),
  SESSION: Object.freeze([
    'session_asia',
    'session_london',
    'session_new_york',
  ]),
  WHALE_LIFECYCLE: Object.freeze([
    'wall_persistence_seconds',
    'refill_count',
    'spoof_probability',
    'absorption_score',
    'execution_ratio',
    'whale_notional_log',
  ]),
} satisfies Readonly<Record<AlphaFeatureGroup, readonly AlphaFeatureName[]>>);

const sourcesForGroup = (
  group: AlphaFeatureGroup,
): readonly AlphaFeatureSource[] => {
  switch (group) {
    case 'TREND':
    case 'STRUCTURE_LIQUIDITY':
    case 'VOLATILITY_VOLUME_VALUE':
    case 'STRENGTH_MOMENTUM':
      return Object.freeze(['ALERT', 'CANDLES']);
    case 'TRADE_FLOW':
      return Object.freeze(['ALERT', 'TRADES']);
    case 'ORDER_BOOK':
      return Object.freeze(['ALERT', 'ORDER_BOOK']);
    case 'SESSION':
      return Object.freeze(['ALERT']);
    case 'WHALE_LIFECYCLE':
      return Object.freeze(['ALERT', 'WHALE_CONTEXT']);
  }
};

const GROUP_NAMES = Object.freeze([
  'TREND',
  'STRUCTURE_LIQUIDITY',
  'TRADE_FLOW',
  'ORDER_BOOK',
  'VOLATILITY_VOLUME_VALUE',
  'STRENGTH_MOMENTUM',
  'SESSION',
  'WHALE_LIFECYCLE',
] as const satisfies readonly AlphaFeatureGroup[]);

const createDefinition = (
  name: AlphaFeatureName,
  group: AlphaFeatureGroup,
): AlphaFeatureDefinition =>
  Object.freeze({
    name,
    group,
    sources: sourcesForGroup(group),
    orientation: name.includes('directional') ? 'ALERT_DIRECTIONAL' : 'RAW',
    futureInformationAllowed: false,
    productionEnabled: false,
  });

const definitions = GROUP_NAMES.flatMap((group) =>
  FEATURE_GROUPS[group].map((name) => createDefinition(name, group)),
);

const names = new Set(definitions.map((definition) => definition.name));
if (
  definitions.length !== ALPHA_FEATURE_NAMES.length ||
  names.size !== ALPHA_FEATURE_NAMES.length ||
  ALPHA_FEATURE_NAMES.some((name) => !names.has(name))
) {
  throw new Error('Alpha feature registry does not match the feature schema');
}

export const ALPHA_FEATURE_REGISTRY: readonly AlphaFeatureDefinition[] =
  Object.freeze(definitions);

const definitionByName = new Map(
  ALPHA_FEATURE_REGISTRY.map((definition) => [definition.name, definition]),
);

export const getAlphaFeatureDefinition = (
  name: AlphaFeatureName,
): AlphaFeatureDefinition => {
  const definition = definitionByName.get(name);
  if (definition === undefined) {
    throw new Error(`Alpha feature is not registered: ${name}`);
  }
  return definition;
};
