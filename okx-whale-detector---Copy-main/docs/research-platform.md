# Quantitative research platform architecture

## Purpose and safety boundary

The platform asks whether a whale-derived event has cost-adjusted predictive value
under conditions known at the event timestamp. It does not place orders, infer that
displayed liquidity is genuine intent, or automatically promote a feature. Every
alpha snapshot and report carries `liveOrderExecutionAllowed: false`; every feature
registry entry carries `productionEnabled: false`.

The supplied empirical baseline remains negative and cannot be regenerated because
the underlying dataset and period are absent. Synthetic fixtures validate software
and statistical plumbing only.

## Dependency boundaries

| Layer                  | Main modules                                                                              | Responsibility                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Raw evidence           | `qualifiedAlertEvidence.ts`, `alertOutcomeObservation.ts`, `alphaSnapshotParser.ts`       | Parse versioned external records and reject malformed values                                             |
| Event-time state       | `alphaResearchSnapshot.ts`, `alphaResearchSnapshotRecorder.ts`                            | Persist only state available at alert time                                                               |
| Feature catalog        | `alphaFeatureRegistry.ts`, `alphaFeatureTypes.ts`                                         | Stable names, groups, sources, orientation, and research-only flags                                      |
| Feature computation    | `alphaFeatureExtractor.ts`                                                                | Deterministic transformation of validated event-time state                                               |
| Joined dataset         | `alphaResearchDataset.ts`, `alphaResearchFingerprint.ts`                                  | Authoritative joins, cost accounting, sorting, and semantic identity                                     |
| Evidence release       | `evidenceEvaluationLease.ts`, `evidenceProgressInspector.ts`, `evidenceDatasetRelease.ts` | Exclusive mutation, quality gates, stable source freeze, content addressing, and corruption verification |
| Time-aware validation  | `alphaWalkForward.ts`, `chronologicalDatasetSplit.ts`                                     | Chronological holdout, purging, and embargo                                                              |
| Models and diagnostics | `alphaLinearModel.ts`, `alphaCalibration.ts`, `alphaFeatureDrift.ts`                      | Ridge importance, SHAP, partial dependence, calibration, and PSI                                         |
| Uncertainty            | `alphaStatistics.ts`, `alphaMonteCarlo.ts`                                                | Cluster bootstrap, effect inference, power, Bayesian bootstrap, and path dispersion                      |
| Report orchestration   | `alphaResearchAnalysis.ts`, `runAlphaResearch.ts`                                         | Rank hypotheses and apply non-execution promotion gates                                                  |

Raw exchange messages do not enter feature or label code directly. Labels never
enter snapshot creation or live feature computation. The continuous-return ridge
model is used for research importance and diagnostics, not as an order signal.

## Reproducibility contract

An alpha report records:

- methodology, report-schema, and feature-registry versions;
- the complete extraction and analysis configuration;
- a canonical configuration SHA-256 fingerprint;
- a semantic dataset SHA-256 fingerprint over sorted rows, features, targets, cost,
  synthetic status, and join accounting;
- chronological fold boundaries, sample counts, missingness, and independent episode
  counts;
- explicit random seeds and iteration counts.

The pseudo-random generators accept unsigned 32-bit seeds and every derived stream
wraps deterministically. Default bootstrap behavior is deterministic. Reordering
source lines or object keys does not change the semantic dataset fingerprint;
changing an analyzed value does.

Evidence readers stream NDJSON and default to 16 MiB per line, 5,000,000 non-empty
records, and 100 retained issue details. Full malformed counts are never truncated.
The limits protect research workstations from accidental unbounded allocations and
can be overridden explicitly through `EvidenceNdjsonReadOptions`.

New event snapshots contain both raw event-time inputs and the full feature vector.
The vector is reproduced from raw inputs and the frozen configuration whenever it is
loaded; a mismatch blocks finalization. Immutable releases include hashes of every
raw source, the materialized dataset, and the research report. See
[`evidence-collection.md`](evidence-collection.md) for the operational contract.

Live alpha evidence is paired with its event-time market context in a map capped at
1,024 entries. Missing contexts expire after 60 seconds by default, with one
aggregated diagnostic per pruning pass. Both limits are configurable through
`EvidenceCollectionRuntimeOptions`; expiry prevents a missing callback from causing
permanent collection saturation.

## Statistical decisions

The final chronological holdout is excluded from orientation, threshold, ranking,
and interaction selection. Expanding discovery folds purge any label unavailable at
the next test boundary and apply an embargo around the boundary. The generic bundle
splitter applies the same label-availability rule and reports purged counts.

Two quantities are deliberately separate:

1. selected-subset expectancy after the configured round-trip cost; and
2. conditional uplift versus every out-of-sample row where the feature was available.

Significance and multiple-testing correction use the uplift estimate. This prevents a
generally profitable period from making an irrelevant feature look predictive. A
null-centered cluster bootstrap resamples instrument/direction episodes. Neutrality
is an equivalence conclusion requiring the complete uplift interval inside the
configured margin; a small point estimate is insufficient.

Generic strategy-candidate comparisons also keep unlike units separate. Every
weighted metric requires a positive `normalizationScale`; the directional change is
divided by that scale before its weight is applied. This makes the score dimensionless
and prevents a numerically large metric from dominating only because of its units.
Callers of `compareStrategyCandidates` must now provide that scale explicitly.

Additional diagnostics have narrower interpretations:

- median and trimmed mean measure sensitivity to return outliers;
- cluster-robust standard error and minimum detectable effect expose low power;
- the Bayesian bootstrap is a prior-light uncertainty sensitivity check;
- Monte Carlo resamples alert episodes and reports additive return-path dispersion,
  not portfolio wealth, leverage, liquidation, or capital risk;
- regression calibration evaluates continuous return predictions and does not create
  a win probability;
- PSI compares discovery with the one-time holdout and is a promotion gate, not a
  ranking input;
- outcome-path volatility uses future MFE/MAE and is explicitly unavailable at the
  decision timestamp.

## Extending features

New candidates must be added to the stable feature-name schema, typed registry, event
snapshot source, extractor, configuration, documentation, and deterministic tests.
The registry startup invariant rejects missing or duplicate definitions. A new field
must remain `productionEnabled: false`, declare all required event-time sources, and
return `null` when its required source is unavailable or stale.

Feature growth is intentionally controlled. Adding many correlated variants raises
the false-discovery burden and is not automatically an improvement. A new candidate
needs an explainable mechanism and a distinct, event-time-computable hypothesis; it
must not be added merely because it is popular technical-analysis terminology.

## Verification

```bash
npm ci
npm run check
npm run build
npm run alpha:simulate
npm run evidence:smoke
```

`alpha:simulate` must report `NO_EMPIRICAL_DATA` and zero production features. Run
`alpha:research -- <evaluation-id>` only on a frozen completed evaluation. Never tune
after inspecting its final holdout.

## Known limitations and future work

- The repository has no empirical alpha dataset or known sample period.
- Execution costs remain a fixed 0.20% baseline rather than observation-specific
  spread, depth, latency, partial-fill, funding, tick-size, or liquidation estimates.
- Ridge diagnostics capture linear additive structure. Non-linear SHAP is not
  applicable until a justified, time-aware non-linear model is introduced.
- There is no calibrated probability classifier; regression scores must not be read
  as probabilities.
- PSI thresholds are configurable diagnostics, not universal market laws.
- The feature extractor is deterministic and tested but remains a large module;
  future group extraction should occur only when it reduces change risk without
  duplicating indicator logic.
- Bayesian hierarchical pooling, deflated Sharpe, and instrument-level random effects
  remain research hypotheses until there is enough real multi-instrument evidence to
  validate their assumptions.
