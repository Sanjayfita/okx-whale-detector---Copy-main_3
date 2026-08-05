# Whale-conditioned alpha research

This pipeline tests whether information already available when a qualified whale
alert was detected changes its subsequent cost-adjusted expectancy. Whale alerts
remain the event generator. No candidate feature is a standalone trigger, and no
research result automatically changes live signal behavior.

## Current evidence status

The repository contains no `data/evaluations/*` dataset, recordings, or historical
alpha snapshots. The supplied frozen baseline therefore remains the only empirical
result:

- 344 qualified alerts
- 1,581 completed observations
- 10.0569% win rate
- -0.1799 USDT net expectancy
- 0.20% round-trip cost

Its dataset period is unavailable, and it cannot be regenerated from this checkout.
Profitability remains unproven. `npm run alpha:simulate` uses synthetic data only to
test the pipeline and always reports `NO_EMPIRICAL_DATA`.

## Collecting and running research

Initialize and collect a new frozen evidence evaluation as before:

```bash
npm run evidence:init -- <evaluation-id>
npm run evidence:collect -- <evaluation-id>
```

Evidence collection now creates `alpha-snapshots.ndjson`. After each whale-derived
alert is durably persisted, a matching snapshot captures:

- confirmed 1-minute candles that were present at the alert;
- a synchronized, uncrossed order book;
- public trades retained for research, including event and availability times;
- contemporaneous whale persistence, refill count, execution ratio, and notional.

Inspect and seal the evidence after every configured outcome has completed:

```bash
npm run evidence:progress -- <evaluation-id>
npm run evidence:finalize -- <evaluation-id>
```

The command reads `qualified-alerts.ndjson` as the authoritative alert population,
then joins `alpha-snapshots.ndjson` and `outcomes.ndjson`. The authoritative
finalizer writes a content-addressed immutable dataset and report. The optional
exploratory `alpha:research` command writes
`reports/alpha-research-report-<dataset-fingerprint>.json` with an exclusive,
non-overwriting create. Malformed records, duplicate alert IDs,
future-informed values, invalid books, inconsistent directional returns, or mixed
evaluation identities fail closed. Missing snapshots or target outcomes produce
`INCOMPLETE_DATA`; no feature ranking from that subset is treated as usable.
Inputs are streamed line by line with configurable hard limits (16 MiB per line and
5,000,000 records by default), so startup does not duplicate complete evidence files
in memory. Diagnostics retain at most 100 malformed line numbers while preserving
the full malformed count.

## Event-time and target rules

- Candle interval end and availability, book event and availability, trade event
  and availability, and whale-context availability must be no later than the alert's
  `detectedAt` timestamp.
- Only confirmed, contiguous candle history is used. A gap resets the usable suffix.
- Books older than 5 seconds and candles older than 2 minutes are marked unavailable
  by default. Future, crossed, locked, one-sided, or misordered books are rejected.
- The default target is the 15-minute direction-adjusted return minus 0.20 percentage
  points. Cost is subtracted exactly once.
- The 0.20% policy is a fixed baseline assumption. It does not replace a future
  observation-specific model for latency, depth slippage, partial fills, funding,
  tick size, or minimum order size.

## Candidate features

The extractor exposes exactly 50 candidates. A positive directional value means
alignment with the whale-alert direction. Every period, tolerance, window, session,
freshness limit, and enabled feature list is defined by
`AlphaFeatureExtractionConfig`; the names use semantic terms such as fast, medium,
and slow so changing a configured period does not mislabel the output.
`alphaFeatureRegistry.ts` is the typed catalog for group, source, orientation,
look-ahead, and production-state metadata. Registry completeness is checked against
the feature schema at startup; every entry is research-only and production-disabled.

| Group                         | Count | Features                                                                                                                                                                     |
| ----------------------------- | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trend                         |    11 | Fast/medium/slow EMA distance; fast-medium and medium-slow spread; fast and medium slope; single-timeframe and higher-timeframe alignment; short and long directional return |
| Structure and liquidity       |    10 | HH/HL or LH/LL structure; BOS; CHOCH; range position; equal-high and equal-low distance; liquidity sweep; swing failure; FVG; order block                                    |
| Order flow and book           |     7 | Directional CVD log notional and ratio; trade-count log; level-1 and depth imbalance; microprice offset; spread                                                              |
| Volatility, volume, and value |     7 | ATR; realized volatility; compression/expansion ratio; relative volume; volume z-score; rolling VWAP distance; configured-window anchored VWAP distance                      |
| Strength and momentum         |     6 | ADX; directional DMI; directional RSI regime; directional MACD histogram and slope; trend efficiency                                                                         |
| Session                       |     3 | Asia, London, and New York UTC indicators; overlaps are allowed                                                                                                              |
| Whale lifecycle               |     6 | Wall persistence; refill count; spoof probability; absorption score; execution ratio; whale notional log                                                                     |

The FVG and order-block fields use deterministic, documented price-action
approximations suitable for hypothesis testing, not discretionary chart labels. The
anchored VWAP anchor is the start of its configured historical window. Spoof
probability and absorption score remain `null` in live event snapshots when they
cannot be established without later lifecycle information. They must never be
backfilled from the outcome period.

Default extraction settings are:

| Setting                                  |                                     Default |
| ---------------------------------------- | ------------------------------------------: |
| EMA fast / medium / slow                 |                               20 / 50 / 200 |
| Higher-timeframe multiplier              |              5x the confirmed base interval |
| EMA slope, return short / long           |                           5, 5 / 20 candles |
| Swing / structure / equal-level lookback |                         5 / 20 / 20 candles |
| Equal-level tolerance                    |                                       0.05% |
| FVG lookback / minimum gap               |                          20 candles / 0.02% |
| Order-block lookback                     |                                  20 candles |
| Trade lookback                           |                                  60 seconds |
| Book depth / maximum age                 |                        5 levels / 5 seconds |
| Maximum candle age                       |                                   2 minutes |
| ATR / realized volatility                |                             14 / 20 candles |
| Volatility short / long                  |                             10 / 50 candles |
| Volume / VWAP / anchored VWAP            |                        20 / 20 / 50 candles |
| ADX / RSI                                |                             14 / 14 candles |
| MACD fast / slow / signal / slope        |                     12 / 26 / 9 / 3 candles |
| Trend efficiency                         |                                  20 candles |
| Asia / London / New York                 | 00:00–08:00 / 07:00–16:00 / 13:00–22:00 UTC |

The live candle buffer is bounded at 1,200 candles so the default 200-period EMA can
also be calculated on the 5x aggregate. Trade research retention is bounded at 60
seconds and 10,000 records. The existing 5-second behavior-classification lookback is
unchanged.

Default analysis settings are:

| Setting                                     |                            Default |
| ------------------------------------------- | ---------------------------------: |
| Walk-forward folds / final holdout          |                            5 / 20% |
| Purge / embargo                             |                    60 / 15 minutes |
| Dependency episode window                   |                         60 minutes |
| Frequentist / Bayesian bootstrap iterations |                      2,000 / 2,000 |
| Monte Carlo iterations                      |                              2,000 |
| Confidence / target power                   |                          95% / 80% |
| Trimmed-mean fraction                       |                       10% per tail |
| Drift bins / minimum samples                |              10 / 30 per partition |
| Moderate / material PSI                     |                        0.10 / 0.25 |
| Partial-dependence grid                     | 5 points over 5th–95th percentiles |
| Calibration bins / minimum samples          |                            10 / 30 |
| False-discovery rate                        |                                 5% |

All values live in `AlphaResearchAnalysisConfig`; none is hidden in the report
generator.

## Statistical design

The report reserves the final 20% of chronological rows as an untouched holdout.
The preceding discovery segment uses five expanding walk-forward folds. A training
row is removed when its alert is inside the 15-minute embargo or its outcome is not
known at least 60 minutes before the next test window.

For each feature and fold:

1. Spearman direction and a 25% tail threshold are learned from training rows only.
2. Conditional expectancy and unannualized event Sharpe are measured on the next
   test window. Conditional uplift is separately bootstrapped against all rows where
   that feature was available.
3. Information coefficient and discretized mutual information are aggregated from
   out-of-sample rows.
4. A training-only, sample-normalized ridge model supplies out-of-sample permutation
   importance and exact linear-model SHAP contributions. Partial-dependence curves
   use the final discovery training rows only.
5. Alert dependence is handled by clustering adjacent events by instrument and
   direction within 60 minutes, then bootstrapping whole episodes.
6. A null-centered episode bootstrap tests conditional uplift, rather than testing
   only whether the selected subset has a positive mean. Its p-values are corrected
   across candidate features with Benjamini–Hochberg at a 5% false-discovery rate.

The report also includes median and 10% trimmed mean, cluster-robust standard error,
minimum detectable effect at 80% power, a dependency-aware Bayesian bootstrap,
episode-resampled Monte Carlo path diagnostics, continuous-return calibration, and
population stability index (PSI). The Bayesian and Monte Carlo outputs are sensitivity
diagnostics and are not promotion gates. Calibration applies to predicted net return;
the ridge score is not converted into a win probability.

`NEUTRAL` now requires the entire uplift confidence interval to fall inside the
configured equivalence band. A small point estimate alone is `INCONCLUSIVE`, not
evidence of no effect.

Selected-sample expectancy is also reported by instrument and alert direction.
Instrument stability excludes groups below the configured per-instrument sample
minimum, so a large headline sample cannot hide dependence on one market.

The feature score combines absolute IC (25%), mutual information (15%), permutation
importance (20%), mean absolute linear SHAP (10%), and conditional expectancy effect
(30%). Missingness and unstable fold orientation reduce the score. These weights are
configuration, not fitted parameters. They rank research attention; they are not a
profitability gate.

Interactions are evaluated only among the ten highest discovery-ranked features by
default, avoiding exhaustive combinatorial search. Interaction bootstrap p-values
test incremental uplift over the stronger constituent subset and also receive
multiple-testing correction. The final holdout does not influence ranking or
interaction selection.

## Production gate

Every confirmation remains disabled. A single feature can only be marked
`statisticallyEligible` when all automated gates pass:

- positive cost-adjusted conditional expectancy and lower bootstrap bound;
- positive conditional uplift whose lower confidence bound exceeds the configured
  equivalence margin, with corrected discovery significance;
- at least 40 selected discovery rows and 30 independent episodes;
- at least two instruments with 10 selected rows each, with positive expectancy in
  at least 60% of eligible instruments in both discovery and final holdout;
- positive expectancy in at least 60% of walk-forward folds;
- at least 30 selected final-holdout rows and 20 holdout episodes;
- positive final-holdout expectancy and uplift lower bounds with corrected
  significance;
- stable discovery-to-holdout PSI with adequate feature observations;
- non-synthetic data.

Even then, `productionEnabled` remains `false`. Promotion requires a separate,
explicit review of the market mechanism, execution assumptions, nearby parameter
stability, instrument and regime concentration, and operational impact. Interaction
results are never auto-promoted.

## Reproducibility and interpretation

Report schema version 2 embeds the complete research configuration and its canonical
SHA-256 fingerprint plus a separate semantic SHA-256 fingerprint of the exact joined
dataset. The dataset fingerprint is independent of input-file ordering and JSON key
ordering, but changes with any row, feature, return, cost, or population-accounting
change. The report also records registry and methodology versions, dataset period,
fold boundaries, missingness, episode counts, uncertainty, calibration, drift,
interactions, and high correlations. Report status meanings are:

- `COMPLETE`: sufficient non-synthetic data was analyzed; this is not itself a
  profitability verdict.
- `INSUFFICIENT_DATA`: real rows exist but the purged split or holdout requirements
  cannot be met.
- `INCOMPLETE_DATA`: at least one qualified alert lacks its event snapshot or target
  outcome, or an outcome cannot be joined; subset analysis is blocked.
- `NO_EMPIRICAL_DATA`: no rows exist or the input is synthetic.

Do not change thresholds after viewing the final holdout. A new hypothesis or
configuration requires a newly frozen evaluation and a new untouched holdout.

Outcome-path volatility in the older statistical report is explicitly labeled
`OUTCOME_PATH_VOLATILITY` and `availableAtDecisionTime: false`. It is retrospective
label analysis, never a live volatility-regime feature. Terminal ticker labels mark
path excursions unavailable and are excluded from this grouping. See
[`research-platform.md`](research-platform.md) for module boundaries and extension
rules and [`evidence-collection.md`](evidence-collection.md) for the empirical data
lifecycle.
