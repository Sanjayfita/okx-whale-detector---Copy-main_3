import type { FeatureRole } from './FeatureSelection';

export type ResearchDataCapability =
  | 'CONFIRMED_CANDLES'
  | 'MULTI_TIMEFRAME_CANDLES'
  | 'PUBLIC_TRADES'
  | 'SEQUENCE_COMPLETE_DEPTH'
  | 'OPEN_INTEREST'
  | 'FUNDING'
  | 'LIQUIDATIONS'
  | 'MARK_AND_INDEX'
  | 'BEST_BID_AND_ASK'
  | 'CONTRACT_METADATA'
  | 'ORDER_LEVEL_IDENTIFIERS'
  | 'VERIFIED_POSITIONING_FEED'
  | 'VERIFIED_EVENT_FEED';

export type ConfluenceCategory =
  | 'MARKET_STRUCTURE'
  | 'LIQUIDITY'
  | 'ORDER_FLOW'
  | 'DERIVATIVES'
  | 'VOLUME'
  | 'VOLATILITY'
  | 'TREND'
  | 'EXECUTION';

export interface ConfluenceResearchDefinition {
  readonly featureName: string;
  readonly category: ConfluenceCategory;
  readonly featureRole: FeatureRole;
  readonly description: string;
  readonly requiredCapabilities: readonly ResearchDataCapability[];
  readonly currentSupport: 'TESTABLE' | 'UNSUPPORTED_WITH_CURRENT_PUBLIC_DATA';
  readonly validationWarning: string;
}

export const CONFLUENCE_RESEARCH_CATALOG: readonly ConfluenceResearchDefinition[] = [
  {
    featureName: 'break_of_structure',
    category: 'MARKET_STRUCTURE',
    featureRole: 'ALPHA',
    description: 'Close beyond a previously frozen swing boundary.',
    requiredCapabilities: ['CONFIRMED_CANDLES'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Swing width and confirmation rules must be frozen before evaluation.',
  },
  {
    featureName: 'change_of_character',
    category: 'MARKET_STRUCTURE',
    featureRole: 'ALPHA',
    description: 'First structural break against an established directional sequence.',
    requiredCapabilities: ['CONFIRMED_CANDLES'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Must not use future pivots to label the change point.',
  },
  {
    featureName: 'swing_sequence',
    category: 'MARKET_STRUCTURE',
    featureRole: 'REGIME',
    description: 'Higher-high/higher-low or lower-high/lower-low sequence.',
    requiredCapabilities: ['CONFIRMED_CANDLES'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Pivot confirmation delay must be included in signal time.',
  },
  {
    featureName: 'liquidity_sweep',
    category: 'LIQUIDITY',
    featureRole: 'ALPHA',
    description: 'Trade through a frozen liquidity reference followed by rejection.',
    requiredCapabilities: [
      'CONFIRMED_CANDLES',
      'PUBLIC_TRADES',
      'SEQUENCE_COMPLETE_DEPTH',
    ],
    currentSupport: 'TESTABLE',
    validationWarning: 'A wick alone is not evidence of a stop hunt.',
  },
  {
    featureName: 'equal_high_low_cluster',
    category: 'LIQUIDITY',
    featureRole: 'ALPHA',
    description: 'Repeated highs or lows inside a predeclared price tolerance.',
    requiredCapabilities: ['CONFIRMED_CANDLES'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Tolerance must scale with tick size and volatility.',
  },
  {
    featureName: 'liquidity_void',
    category: 'LIQUIDITY',
    featureRole: 'ALPHA',
    description: 'Persistent low-depth or low-traded-volume price interval.',
    requiredCapabilities: ['PUBLIC_TRADES', 'SEQUENCE_COMPLETE_DEPTH'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Historical snapshots must be event-time complete.',
  },
  {
    featureName: 'cumulative_volume_delta',
    category: 'ORDER_FLOW',
    featureRole: 'ALPHA',
    description: 'Cumulative signed aggressive trade volume.',
    requiredCapabilities: ['PUBLIC_TRADES'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Trade-side classification and reset windows must be fixed.',
  },
  {
    featureName: 'delta_divergence',
    category: 'ORDER_FLOW',
    featureRole: 'ALPHA',
    description: 'Price displacement that is not confirmed by signed trade delta.',
    requiredCapabilities: ['PUBLIC_TRADES', 'CONFIRMED_CANDLES'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Divergence lookback must be selected inside discovery folds only.',
  },
  {
    featureName: 'aggressive_trade_imbalance',
    category: 'ORDER_FLOW',
    featureRole: 'ALPHA',
    description: 'Normalized imbalance between aggressive buy and sell volume.',
    requiredCapabilities: ['PUBLIC_TRADES'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Minimum volume and time windows must prevent sparse-sample noise.',
  },
  {
    featureName: 'absorption',
    category: 'ORDER_FLOW',
    featureRole: 'ALPHA',
    description: 'Aggressive flow fails to move price through persistent opposing liquidity.',
    requiredCapabilities: ['PUBLIC_TRADES', 'SEQUENCE_COMPLETE_DEPTH'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Cancellation and refill behavior must be separated where possible.',
  },
  {
    featureName: 'exhaustion',
    category: 'ORDER_FLOW',
    featureRole: 'ALPHA',
    description: 'Declining aggressive continuation after directional extension.',
    requiredCapabilities: ['PUBLIC_TRADES', 'CONFIRMED_CANDLES'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Must be measured without using the later reversal to define exhaustion.',
  },
  {
    featureName: 'iceberg_inference',
    category: 'ORDER_FLOW',
    featureRole: 'ALPHA',
    description: 'Repeated execution against replenishing order-level liquidity.',
    requiredCapabilities: ['ORDER_LEVEL_IDENTIFIERS', 'PUBLIC_TRADES'],
    currentSupport: 'UNSUPPORTED_WITH_CURRENT_PUBLIC_DATA',
    validationWarning: 'Aggregated book refill is not sufficient proof of one hidden order.',
  },
  {
    featureName: 'open_interest_expansion',
    category: 'DERIVATIVES',
    featureRole: 'ALPHA',
    description: 'Open-interest increase aligned with directional price movement.',
    requiredCapabilities: ['OPEN_INTEREST', 'MARK_AND_INDEX'],
    currentSupport: 'TESTABLE',
    validationWarning: 'OI timestamp freshness must match the decision timestamp.',
  },
  {
    featureName: 'open_interest_contraction',
    category: 'DERIVATIVES',
    featureRole: 'ALPHA',
    description: 'Open-interest decrease during directional price movement.',
    requiredCapabilities: ['OPEN_INTEREST', 'MARK_AND_INDEX'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Cannot identify long versus short closing from OI alone.',
  },
  {
    featureName: 'funding_extreme',
    category: 'DERIVATIVES',
    featureRole: 'ALPHA',
    description: 'Funding level relative to a trailing distribution.',
    requiredCapabilities: ['FUNDING'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Scheduled funding must not enter features before its effective timestamp.',
  },
  {
    featureName: 'funding_acceleration',
    category: 'DERIVATIVES',
    featureRole: 'ALPHA',
    description: 'Change in funding level over frozen observation windows.',
    requiredCapabilities: ['FUNDING'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Sparse funding intervals require conservative interpolation rules.',
  },
  {
    featureName: 'basis_expansion_contraction',
    category: 'DERIVATIVES',
    featureRole: 'ALPHA',
    description: 'Change in mark-to-index basis.',
    requiredCapabilities: ['MARK_AND_INDEX'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Mark and index observations must be independently sourced and synchronized.',
  },
  {
    featureName: 'positioning_long_short_imbalance',
    category: 'DERIVATIVES',
    featureRole: 'ALPHA',
    description: 'Directional positioning imbalance from a defined participant population.',
    requiredCapabilities: ['VERIFIED_POSITIONING_FEED'],
    currentSupport: 'UNSUPPORTED_WITH_CURRENT_PUBLIC_DATA',
    validationWarning: 'Population, revision policy, and historical availability must be verified.',
  },
  {
    featureName: 'liquidation_cluster',
    category: 'DERIVATIVES',
    featureRole: 'ALPHA',
    description: 'Concentrated forced-liquidation notional inside a fixed interval.',
    requiredCapabilities: ['LIQUIDATIONS', 'MARK_AND_INDEX'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Exchange liquidation coverage may be partial and must be documented.',
  },
  {
    featureName: 'liquidation_cascade',
    category: 'DERIVATIVES',
    featureRole: 'ALPHA',
    description: 'Accelerating liquidation flow with directional price displacement.',
    requiredCapabilities: ['LIQUIDATIONS', 'PUBLIC_TRADES', 'MARK_AND_INDEX'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Cascade thresholds must be frozen and cost-stressed.',
  },
  {
    featureName: 'relative_volume',
    category: 'VOLUME',
    featureRole: 'ALPHA',
    description: 'Current confirmed volume relative to a trailing baseline.',
    requiredCapabilities: ['CONFIRMED_CANDLES'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Session and interval normalization must be fixed.',
  },
  {
    featureName: 'anchored_vwap_deviation',
    category: 'VOLUME',
    featureRole: 'ALPHA',
    description: 'Price displacement from VWAP anchored at a deterministic event.',
    requiredCapabilities: ['PUBLIC_TRADES', 'CONFIRMED_CANDLES'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Anchor selection must be observable in real time and not hindsight chosen.',
  },
  {
    featureName: 'session_vwap_deviation',
    category: 'VOLUME',
    featureRole: 'ALPHA',
    description: 'Price displacement from a predeclared UTC session VWAP.',
    requiredCapabilities: ['PUBLIC_TRADES'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Session boundaries must remain constant across evaluation.',
  },
  {
    featureName: 'volume_profile_nodes',
    category: 'VOLUME',
    featureRole: 'ALPHA',
    description: 'High-volume and low-volume price nodes from executed trades.',
    requiredCapabilities: ['PUBLIC_TRADES', 'CONTRACT_METADATA'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Bin width must scale with tick size and be selected inside discovery data.',
  },
  {
    featureName: 'atr_percent',
    category: 'VOLATILITY',
    featureRole: 'REGIME',
    description: 'Average true range normalized by price.',
    requiredCapabilities: ['CONFIRMED_CANDLES'],
    currentSupport: 'TESTABLE',
    validationWarning: 'ATR is a scale and risk feature, not directional evidence by itself.',
  },
  {
    featureName: 'realized_volatility',
    category: 'VOLATILITY',
    featureRole: 'REGIME',
    description: 'Realized return volatility over a frozen window.',
    requiredCapabilities: ['CONFIRMED_CANDLES'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Annualization and sampling interval must be fixed.',
  },
  {
    featureName: 'volatility_compression_expansion',
    category: 'VOLATILITY',
    featureRole: 'ALPHA',
    description: 'Transition from compressed to expanding realized range.',
    requiredCapabilities: ['CONFIRMED_CANDLES'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Transition labels must use only information available at decision time.',
  },
  {
    featureName: 'ema_alignment',
    category: 'TREND',
    featureRole: 'ALPHA',
    description: 'Ordering and slope alignment of frozen EMA windows.',
    requiredCapabilities: ['CONFIRMED_CANDLES'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Must show value beyond simpler trend efficiency.',
  },
  {
    featureName: 'trend_efficiency',
    category: 'TREND',
    featureRole: 'REGIME',
    description: 'Net directional movement relative to total path movement.',
    requiredCapabilities: ['CONFIRMED_CANDLES'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Window selection belongs inside purged discovery folds.',
  },
  {
    featureName: 'adx',
    category: 'TREND',
    featureRole: 'REGIME',
    description: 'Directional movement strength measured by ADX.',
    requiredCapabilities: ['CONFIRMED_CANDLES'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Retain only after paired ablation versus trend efficiency.',
  },
  {
    featureName: 'multi_timeframe_confirmation',
    category: 'TREND',
    featureRole: 'ALPHA',
    description: 'Agreement between independently closed higher and lower timeframes.',
    requiredCapabilities: ['MULTI_TIMEFRAME_CANDLES'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Higher-timeframe candles must be closed before use.',
  },
  {
    featureName: 'spread_filter',
    category: 'EXECUTION',
    featureRole: 'EXECUTION_FILTER',
    description: 'Reject entries whose quoted spread exceeds a fixed threshold.',
    requiredCapabilities: ['BEST_BID_AND_ASK'],
    currentSupport: 'TESTABLE',
    validationWarning: 'This protects execution realism and is not directional alpha.',
  },
  {
    featureName: 'slippage_filter',
    category: 'EXECUTION',
    featureRole: 'EXECUTION_FILTER',
    description: 'Reject orders whose simulated depth walk exceeds allowed slippage.',
    requiredCapabilities: ['SEQUENCE_COMPLETE_DEPTH', 'CONTRACT_METADATA'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Participation and latency assumptions must be stress tested.',
  },
  {
    featureName: 'depth_filter',
    category: 'EXECUTION',
    featureRole: 'EXECUTION_FILTER',
    description: 'Require sufficient executable depth for requested contracts.',
    requiredCapabilities: ['SEQUENCE_COMPLETE_DEPTH', 'CONTRACT_METADATA'],
    currentSupport: 'TESTABLE',
    validationWarning: 'Visible depth can disappear before fill and requires adverse stress.',
  },
  {
    featureName: 'participation_rate_limit',
    category: 'EXECUTION',
    featureRole: 'RISK_FILTER',
    description: 'Limit order size as a fraction of observed executable depth or volume.',
    requiredCapabilities: [
      'SEQUENCE_COMPLETE_DEPTH',
      'PUBLIC_TRADES',
      'CONTRACT_METADATA',
    ],
    currentSupport: 'TESTABLE',
    validationWarning: 'This is a capacity control, not a directional feature.',
  },
  {
    featureName: 'news_event_blackout',
    category: 'EXECUTION',
    featureRole: 'RISK_FILTER',
    description: 'Suppress new risk near verified scheduled or breaking events.',
    requiredCapabilities: ['VERIFIED_EVENT_FEED'],
    currentSupport: 'UNSUPPORTED_WITH_CURRENT_PUBLIC_DATA',
    validationWarning: 'A hand-maintained or hindsight event list is not reproducible evidence.',
  },
];

export interface ConfluenceReadinessDecision {
  readonly featureName: string;
  readonly category: ConfluenceCategory;
  readonly featureRole: FeatureRole;
  readonly status:
    | 'READY_FOR_ABLATION'
    | 'BLOCKED_MISSING_DATA'
    | 'UNSUPPORTED_WITH_CURRENT_PUBLIC_DATA';
  readonly missingCapabilities: readonly ResearchDataCapability[];
  readonly validationWarning: string;
  readonly retainedInStrategy: false;
}

export const assessConfluenceReadiness = (input: {
  readonly availableCapabilities: readonly ResearchDataCapability[];
  readonly catalog?: readonly ConfluenceResearchDefinition[];
}): readonly ConfluenceReadinessDecision[] => {
  const catalog = input.catalog ?? CONFLUENCE_RESEARCH_CATALOG;
  const available = new Set(input.availableCapabilities);
  const featureNames = new Set<string>();
  return catalog.map((definition) => {
    if (definition.featureName.trim().length === 0) {
      throw new Error('confluence featureName must not be empty');
    }
    if (featureNames.has(definition.featureName)) {
      throw new Error(`duplicate confluence ${definition.featureName}`);
    }
    featureNames.add(definition.featureName);
    const missingCapabilities = definition.requiredCapabilities.filter(
      (capability) => !available.has(capability),
    );
    const status =
      definition.currentSupport === 'UNSUPPORTED_WITH_CURRENT_PUBLIC_DATA'
        ? 'UNSUPPORTED_WITH_CURRENT_PUBLIC_DATA'
        : missingCapabilities.length > 0
          ? 'BLOCKED_MISSING_DATA'
          : 'READY_FOR_ABLATION';
    return {
      featureName: definition.featureName,
      category: definition.category,
      featureRole: definition.featureRole,
      status,
      missingCapabilities,
      validationWarning: definition.validationWarning,
      retainedInStrategy: false,
    };
  });
};
