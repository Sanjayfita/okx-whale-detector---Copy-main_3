# Final foundation technical review

## Decision model

The repository now separates two decisions that must never be conflated:

1. **Research-platform merge readiness** — whether the software is safe, maintainable, documented, migration-consistent, tested, and suitable to become the maintained `main`-branch foundation.
2. **Trading-strategy release readiness** — whether a frozen strategy has sufficient real-market evidence for paper promotion, testnet review, or any later live consideration.

`ResearchPlatformMergeGate` governs the first decision. `ReleaseCandidateGate` continues to govern the second. A successful platform merge does not promote a strategy, authorize testnet activity, create a release candidate, or enable live execution.

## Final technical-review corrections

### Data collection

`ContinuousDerivativesCollector` now treats a regular source watermark as the latest complete observation boundary. Interior and trailing gaps are recovered through bounded passes. Unresolved gaps, watermark regression, future watermarks, records beyond the watermark, receive timestamps materially preceding exchange timestamps, synthetic data, conflicting duplicates, and timestamp or sequence regression prevent checkpoint advancement.

### Execution simulation

Any non-zero market fill is now represented as `PARTIALLY_FILLED` rather than discarded as rejected exposure. The simulator records whether the preferred minimum fill ratio was achieved, preserves entry fees, reports residual open quantity after incomplete exits, and never treats an unclosed remainder as a completed trade.

### Shadow evaluation

Daily shadow reports now measure favorable movement on unfilled order quantity for both fully rejected and partially filled orders. Reports include missed contracts and average unfilled contracts in addition to fill ratio, slippage, paper comparison, and forward outcomes.

### Portfolio construction

Portfolio state and proposed allocations are netted by instrument before gross exposure, net exposure, leverage, and historical VaR are calculated. Risk-reducing hedges can pass limits that are already saturated. The engine requires sufficient finite scenario observations and complete instrument coverage instead of interpreting missing returns as zero risk.

`PortfolioRiskGateway` now fails closed when required pair-correlation evidence is absent, rejects conflicting correlation inputs, treats adjustments to existing positions separately from new-position capacity, and resolves duplicate instrument proposals deterministically.

## Foundation architecture

```text
OKX derivatives data
  -> source watermark, chronology, gap, duplicate and sequence gates
  -> immutable PostgreSQL research records and manifests
  -> point-in-time replay and feature pipelines
  -> explainable regime and timeframe context
  -> governed model-assisted research and ablation
  -> strategy laboratory and event-risk filtering
  -> structured trade explanations
  -> correlation-complete portfolio risk gateway
  -> depth-, latency-, fee-, funding- and partial-fill-aware simulation
  -> purged walk-forward and discovery-only optimization
  -> frozen holdout and execution-aware Monte Carlo
  -> paper trading
  -> shadow reconciliation and missed-opportunity analysis
  -> empirical strategy release gate
```

## Safety state after merge

- Strategy profitability remains unvalidated.
- No strategy is promoted by this merge.
- Testnet execution remains unauthorized.
- Live order submission remains disabled.
- No release tag should claim trading performance.
- Real-market collection, holdout, paper, shadow, and paired-baseline evidence remain mandatory.

## Remaining research milestones

1. Deploy every required OKX derivatives collector continuously.
2. Build an immutable, sequence-complete dataset spanning multiple instruments and market regimes.
3. Reproduce the original whale baseline on that corrected dataset.
4. Run feature importance, paired ablation, and redundancy analysis by purged fold.
5. Run discovery-only optimization and complete cost, latency, funding, missed-fill, and partial-fill stress matrices.
6. Freeze code, features, and parameters before accessing the untouched holdout exactly once.
7. Complete prolonged reconciled paper and shadow runs.
8. Demonstrate statistically significant paired improvement over the baseline before strategy promotion.
9. Complete exchange-exact margin, liquidation-tier, account-mode, and operational review before any testnet proposal.

Engineering readiness is evidence that the platform can support these experiments. It is not evidence of positive expectancy.
