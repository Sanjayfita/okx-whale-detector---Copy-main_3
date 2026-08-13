# Empirical evidence pipeline operationalization — 2026-08-10

## Scope and result

This phase operationalizes evidence collection; it does not tune the detector or
trading strategy. Live order execution remains disabled. The runtime path is:

```text
OKX public book/trades/candles
  -> MarketEngine whale scan and OKX-only alert qualification
  -> EvidenceAwareCorrelatedAlertRecorder callback
  -> CorrelatedAlertEvidenceBridge (frozen evaluation identity/provenance)
  -> QualifiedAlertRecorder + AlphaResearchSnapshotRecorder
  -> PersistentOutcomeScheduler
  -> OKXResilientPriceReader using validated order-book WebSocket midpoint labels with bounded OKX REST ticker fallback
  -> LiveEvidenceCollector sampled path/outcomes
  -> EvidenceProgressInspector + EvidenceDatasetQuality
  -> EvidenceDatasetRelease (content-addressed immutable copy)
  -> chronological alpha-dataset + purged walk-forward/final holdout report
```

Paper trade acceptance is not in this path. Every OKX-only qualified event is
recorded and observed whether or not a paper strategy would trade it.

## Existing-module disposition

| Area                      | Modules                                                                                                                                                                     | Status after this phase                                                                                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session freeze            | `evaluationSessionManifest`, `evidenceEvaluationDefinition`, `evidenceCollectBootstrap`, `evidenceEvaluationLease`                                                          | Operational; clean commit, configuration fingerprint, instruments, thresholds, horizons, and safety locks are frozen and exclusively leased.                                                             |
| Live ingestion            | `collectEvidence`, `evidenceCollectRuntimeFactory`, `evidenceCollectionRuntime`, `correlatedAlertEvidenceBridge`, `qualifiedAlertRecorder`, `alphaResearchSnapshotRecorder` | Operational and connected to the live MarketEngine callback. Bounded pending snapshot correlation prevents memory growth.                                                                                |
| Point-in-time features    | `alphaResearchSnapshot`, `alphaCapturedFeatures`, `alphaFeatureExtractor`, `alphaFeatureRegistry`                                                                           | Operational; raw sources and 50 versioned features are persisted and recomputed on read. Source availability cannot exceed event time.                                                                   |
| Outcome recovery          | `persistentOutcomeScheduler`, `liveEvidenceCollector`, `okxResilientPriceReader`, `okxStreamingPriceReader`                                                                | Operational; nine horizons, atomic state, idempotent reconciliation, durable missed-window states, sampled raw paths, restart recovery, WebSocket-first labels, bounded batched REST fallback, and persisted source provenance without extending the observation window. |
| Integrity/quality         | `evidenceNdjson`, `evidenceIntegrity`, `evidenceDatasetQuality`, `evidenceProgressInspector`, `evidenceSourceFingerprint`                                                   | Operational; duplicates, malformed/unmatched data, schedule gaps, timestamp metadata, completeness, distribution, and hashes gate release.                                                               |
| Release                   | `evidenceDatasetRelease`, `alphaResearchDatasetLoader`, `alphaResearchDataset`                                                                                              | Operational; exclusive content-addressed release, source/dataset/report SHA-256 verification, no overwrite.                                                                                              |
| Chronology/statistics     | `alphaWalkForward`, `alphaResearchAnalysis`, `statisticalValidation`, `evidenceProfitability`                                                                               | Operational but gated; chronological sorting, purging by label availability, embargo, walk-forward folds, bootstrap/Monte Carlo, and final holdout. No profitability conclusion is currently authorized. |
| Legacy/general evaluation | `evaluationFreeze`, alert alignment/path/target-stop generators                                                                                                             | Separate historical/replay tooling. Not part of the authoritative live evidence session and not used to reconstruct point-in-time features.                                                              |

## Frozen evidence contract

The qualified record includes evaluation ID, event/alert ID, instrument and type,
detector/source/reference/local timestamps, direction, event type, confidence,
bid/ask/mid/spread, source commit, and configuration fingerprint. The snapshot adds
confirmed candles, bounded multi-level book, public trades, whale side/price/size/
notional/distance/lifecycle data, versioned derived features, and explicit data
quality flags. Funding/open interest are explicit missing values, never fabricated.

Outcomes are observed at approximately 5s, 15s, 30s, 1m, 3m, 5m, 15m, 30m, and
60m. Each observation retains raw return, alert-direction return, raw upward and
downward sampled excursion, direction-relative MFE/MAE, time-to-extrema, sample
count, and sampling provenance. Binary success labels are derived later.

## Release gates and limitations

Finalization requires at least 1,000 independent, non-overlapping episodes spanning
30 UTC evidence days and at least two instruments, complete verified snapshots and
features, every horizon outcome, sampled paths, no pending/missed/overdue/scheduler
gaps, no malformed or unmatched records, no active collector lease, every source
file, and the clean source commit frozen by the manifest.

These minimums authorize research, not a profitability claim. Coverage balance,
confidence intervals, effect sizes, drift, transaction costs, instruments, sides,
event subtypes, regimes, and untouched holdout performance still require review.
The standardized path is coarse rather than tick-complete, and derivatives remain
missing. A future schema or detector change must initialize a new evaluation.
