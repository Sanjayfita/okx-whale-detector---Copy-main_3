# Empirical research hardening audit

## Objective and safety state

This audit treats the current architecture as the permanent research foundation. Changes were made only where a concrete research bias, missing evidence contract, or observability gap could be identified and tested.

The work does not claim that any strategy is profitable. The Original Whale Strategy, Derivatives Flow V1, Trend Following V1, and Mean Reversion V1 remain unvalidated research candidates. Testnet and live order submission remain disabled.

## Audit method

Every research subsystem was reviewed against the following questions:

1. Was the input actually available at the historical decision timestamp?
2. Can an episode or label horizon leak across discovery, test, or holdout boundaries?
3. Is the complete opportunity universe represented, including decisions not to trade?
4. Is the number of tested hypotheses recorded and corrected for statistically?
5. Does feature evidence preserve temporal and regime structure?
6. Does execution stress include correlated adverse conditions and selection effects?
7. Can every result be reproduced from an immutable dataset, commit, configuration, and candidate family?
8. Can a reviewer see why an experiment is blocked without reconstructing many independent reports?

## Findings and implemented corrections

### Point-in-time data availability

Prior feature code filtered primarily by exchange observation time. A record observed before a decision but received afterward could therefore enter a historical feature vector.

`PointInTimeRecords` now provides one reusable selector that:

- requires the expected instrument;
- excludes exchange observations after the decision;
- excludes records received after the decision;
- applies a bounded lookback window;
- applies a source-specific freshness limit;
- reports future, unavailable, and outside-window exclusions separately;
- fails closed when a required source is stale or underpopulated.

The standard feature pipeline and advanced order-flow pipeline both use this selector. Their output includes maximum source observation and receipt timestamps plus per-source quality evidence.

**Measurable improvement:** every feature vector exposes how many records were excluded for future observation, late arrival, and lookback age. A chronology violation can no longer be silently interpreted as valid data.

### Episode-safe walk-forward and holdout construction

The earlier splitter partitioned individual observations and did not model label end times. One market episode could appear on both sides of a fold or the final holdout boundary.

The purged walk-forward planner now:

- accepts each observation's `labelEndAt`;
- assigns complete episodes to the holdout;
- purges discovery labels that reach into the holdout boundary;
- applies holdout embargo separately from label purge;
- purges training labels before each test fold;
- removes every training observation whose episode appears in the test fold;
- reports purged, embargoed, and overlapping-episode counts.

**Measurable improvement:** every split reports an explicit overlapping-episode count and the number of observations removed by holdout purge and embargo. Promotion tooling rejects nonzero overlap.

### Complete strategy comparison universe

Earlier paired comparison used only episodes in which both strategies traded. This could remove candidate no-trade decisions and baseline-only trades from the comparison.

Each strategy can now declare a frozen `evaluatedEpisodeIds` universe. Episode PnL is computed across that entire shared universe, with a no-trade outcome represented as zero rather than omitted. Missing or mismatched universes block promotion.

**Measurable improvement:** reports expose evaluation-universe size, trade-episode counts for each strategy, and paired-episode count. Selective pairing is visible and cannot receive an eligible status.

### Statistical significance and multiple testing

The platform now provides deterministic episode-level:

- paired bootstrap confidence intervals;
- probability of improvement;
- sign-randomization p-values;
- standardized paired effects;
- Holm-Bonferroni familywise correction.

The same statistical engine is used for strategy comparison and feature ablation. Raw and adjusted p-values, family size, confidence bounds, and rejection reasons are preserved.

**Measurable improvement:** an apparently significant candidate can be compared with its adjusted familywise p-value and the exact number of hypotheses tested.

### Feature importance and feature selection

Global permutation can destroy time and regime structure and may exaggerate feature importance. Permutation importance can now shuffle within frozen blocks such as purged folds, instruments, or regimes. The result records its scope, block count, and number of usable blocks.

Research-feature selection now requires:

- importance from enough independent folds;
- positive and stable importance;
- block-aware permutation evidence;
- paired ablation that survives familywise correction;
- complete pairwise correlation evidence among otherwise eligible features;
- a frozen complexity budget.

Missing correlation evidence is no longer treated as zero correlation. Risk and execution filters can remain for safety without being represented as alpha.

**Measurable improvement:** feature decisions expose block scope, adjusted ablation p-value, correlation-evidence completeness, redundancy reason, and retained research-feature count.

### Bounded strategy candidate generation

`StrategyCandidateGenerator` adds deterministic discovery-only hypothesis generation:

- sorted discrete parameter enumeration;
- declarative cross-parameter constraints;
- maximum dimensions, values, search-space size, and candidates;
- effective-hypothesis count;
- deterministic family and candidate fingerprints;
- explicit prohibition of holdout access and live execution.

Oversized families are rejected rather than silently sampled or truncated.

**Measurable improvement:** the search-space size, constraints rejected, effective candidate count, and exact hypothesis-family fingerprint are available before optimization starts.

### Execution Monte Carlo tail realism

The earlier Monte Carlo primarily drew independent per-trade multipliers. It could also multiply a favorable funding receipt under an adverse funding scenario.

The revised simulator combines systemic and idiosyncratic shocks for fees, funding, slippage, and latency. It also:

- applies a haircut to favorable funding receipts;
- increases missed-fill probability for favorable trades;
- preserves partial-fill sampling;
- resamples independent episodes rather than isolated alerts;
- reports expected shortfall in the adverse return tail;
- reports probability of crossing a drawdown threshold;
- reports favorable and unfavorable missed fills separately;
- enforces a minimum number of independent episodes.

**Measurable improvement:** reports now include expected-shortfall return, systemic cost multiplier, drawdown exceedance probability, and asymmetric missed-fill counts in addition to ruin and return distributions.

### Immutable experiment evidence

`ResearchExperimentManifest` records:

- discovery and holdout fingerprints;
- code commit and configuration hash;
- candidate-family fingerprint;
- strategy and feature identities;
- candidate and hypothesis counts;
- split diagnostics;
- per-source point-in-time data-quality evidence;
- freeze, start, and completion times;
- holdout access count;
- significance and multiplicity methods.

Discovery runs reject any holdout access. Frozen holdout runs require exactly one access. A manifest never authorizes strategy promotion or live execution.

Migration `005_empirical_research_hardening.sql` stores normalized manifests, source-quality assessments, candidate specifications, and corrected statistical evidence. `PostgresEmpiricalResearchEvidenceStore` writes the complete evidence bundle transactionally.

### Consolidated observability

`ResearchAuditReport` combines:

- source exclusions and source rejection counts;
- split integrity;
- candidate search-space and hypothesis count;
- feature selection and correlation completeness;
- paired strategy universe and adjusted significance;
- robustness matrix status;
- Monte Carlo tail metrics;
- release-candidate status;
- all blocking reasons.

The report remains diagnostic. Even a report ready for release review sets `strategyPromotionAllowed` and `liveExecutionAllowed` to false.

## Strategy-by-strategy audit

### Original Whale Strategy

The original strategy remains necessary as the frozen baseline. It must be reproduced on the corrected dataset with the same execution assumptions as every candidate. It was not removed or retuned because doing so would invalidate paired baseline comparison.

### Derivatives Flow V1

The strategy's derivative-flow logic remains a research hypothesis. Its thresholds were not optimized during this audit. Future parameter variants must be generated as one recorded hypothesis family, evaluated on purged discovery folds, and corrected for family size.

### Trend Following V1

Trend following remains appropriate only as a candidate family evaluated across bull, bear, sideways, high-volatility, and low-volatility regimes. No threshold change was justified without corrected multi-regime data.

### Mean Reversion V1

Mean reversion remains a separate family and must be evaluated on the same frozen opportunity universe as trend and baseline candidates. No attempt was made to improve apparent win rate through selective range-regime sampling.

## Components reviewed and intentionally left unchanged

### Portfolio engine and portfolio risk gateway

The foundation already nets exposure by instrument, requires correlation-complete evidence, allows risk-reducing hedges, and fails closed on missing VaR scenarios. No new allocation thresholds were introduced because their effect requires real portfolio-return histories.

### Professional risk manager

Existing trade, account, leverage, and drawdown limits remain conservative research controls. Adjusting them before a strategy demonstrates stable gross edge would mix alpha discovery with risk-budget optimization.

### Release candidate gate

The gate consumes the upgraded feature-selection and paired-improvement contracts. A statistically significant baseline result now carries shared-universe and Holm-adjusted evidence from `StrategyComparison`. Existing real-market, holdout, paper, operational, and live-disabled requirements remain in force.

### Strategy thresholds and feature formulas

No strategy threshold or feature formula was changed merely to improve backtest output. The audit strengthened how those hypotheses are measured and selected.

## Obsolete-code decision

No source file was removed in this change set. The apparent legacy components remain referenced by baseline reconstruction, historical audit, migration compatibility, or the current test suite. Deleting them before the corrected baseline is reproduced would reduce traceability. Future deletion should require both zero runtime/test references and a completed migration path.

## Database migration

Migration 005 adds:

- `research.research_experiment_manifests`;
- `research.research_data_quality_assessments`;
- `research.strategy_candidate_specifications`;
- `research.statistical_evidence_runs`.

All tables prevent live execution evidence from being marked true. Experiment manifests also prevent discovery and holdout fingerprints from being identical.

## Updated empirical workflow

```text
Continuous real-market collection
  -> integrity, watermark, sequence and gap validation
  -> point-in-time source selection using observation and receipt timestamps
  -> immutable discovery and holdout partitions
  -> complete episode and label-horizon audit
  -> deterministic candidate-family generation and hypothesis count
  -> block-aware feature importance
  -> paired feature ablation with familywise correction
  -> purged walk-forward discovery evaluation
  -> complete-universe paired strategy comparison with Holm correction
  -> regime and adverse-cost robustness matrix
  -> systemic execution Monte Carlo and expected-shortfall review
  -> freeze code, configuration, features and parameters
  -> access untouched holdout exactly once
  -> reconciled live-market paper trading
  -> prolonged shadow trading
  -> release-candidate review
```

## Remaining limitations

- Corrected real-market history has not yet been accumulated for the required duration and instruments.
- Sequence-complete historical depth, liquidation history, and point-in-time event data may require continuous capture rather than later REST recovery.
- Public aggregated order books cannot prove individual spoofing or iceberg identities.
- Queue position, maker fills, exchange-specific margin tiers, ADL, liquidation fees, and cross-margin behavior remain approximations until exchange-exact modeling is completed.
- Candidate and feature tooling now records hypothesis burden, but no real candidate family has completed the full pipeline.
- No frozen holdout, prolonged paper run, or prolonged shadow run has established positive expectancy.

## Milestones before statistical validation

1. Operate all required collectors continuously and monitor rejected source batches.
2. Accumulate at least 180 days across at least three liquid OKX derivatives instruments and all required regimes.
3. Freeze immutable discovery and holdout fingerprints before research begins.
4. Reproduce the Original Whale Strategy baseline on the corrected execution model.
5. Generate bounded candidate families for each strategy and record total hypothesis count.
6. Compute within-block importance and paired, familywise-corrected feature ablation.
7. Run purged walk-forward evaluation with zero episode overlap and sufficient independent episodes per fold.
8. Run complete-universe paired strategy comparison with adjusted significance and confidence bounds.
9. Pass regime, fee, funding, slippage, depth, latency, missed-fill, and partial-fill stress.
10. Pass systemic Monte Carlo tail limits using enough independent episodes.
11. Freeze the selected candidate before accessing the holdout exactly once.
12. Complete prolonged reconciled paper and shadow evaluation.
13. Demonstrate statistically significant positive expectancy and paired improvement after costs before any strategy is considered validated.
14. Complete exchange-exact operational review before any testnet proposal.

Engineering improvements increase the reliability of future experiments. They are not evidence that a profitable strategy has been discovered.
