# Phase 6 — Autonomous Quantitative Research Laboratory

## Decision and scope

Phase 6 extends the permanent research foundation with autonomous **research operations**. It does not create an autonomous trading system and does not weaken any promotion, holdout, paper, shadow, testnet, or live-execution gate.

The laboratory can generate and schedule falsifiable hypotheses, create adaptive feature specifications, enumerate bounded strategy families, partition discovery backtests, aggregate complete results, prioritize replication, and publish continuous research status. It cannot:

- access the frozen holdout during discovery;
- silently truncate a hypothesis family;
- omit failed or missing distributed work;
- accept worker metrics whose content fingerprint is invalid;
- let one independent episode span folds or instruments;
- treat discovery ranking as strategy validation;
- claim profitability from simulated examples;
- promote a strategy;
- submit testnet or live orders.

Every Phase 6 contract sets `strategyPromotionAllowed: false` and `liveExecutionAllowed: false`.

## Architecture

```text
Immutable point-in-time discovery dataset
  -> canonical research fingerprints
  -> bounded hypothesis templates
  -> data-capability and falsification audit
  -> adaptive feature candidate generation
  -> lineage, lookback, target-leakage and prior-test audit
  -> bounded strategy candidate families
  -> autonomous cycle manifest
  -> dependency-aware experiment scheduler
  -> deterministic distributed backtest work units
  -> workers execute existing depth/cost-aware backtest engine
  -> result-content and exact-coverage verification
  -> complete-result aggregation
  -> existing statistical, walk-forward, robustness and Monte Carlo gates
  -> uncertainty-aware research-priority ranking
  -> continuous blocker and next-action report
  -> PostgreSQL evidence persistence
  -> human review and later frozen-holdout process
```

The architecture is additive. Existing strategy, backtest, statistical, portfolio, release, paper, and shadow components remain the source of truth for their domains.

## Canonical research identity

`ResearchFingerprint` provides canonical JSON serialization and SHA-256 fingerprints.

Properties:

- object keys are sorted;
- array order is preserved where order is meaningful;
- undefined object properties are excluded;
- negative zero is normalized to zero;
- non-finite numbers are rejected;
- unsupported and cyclic values are rejected.

Cycle, hypothesis, feature, candidate, backtest-plan, work-unit, result, scheduler, and report identities can therefore be compared across machines without relying on insertion order.

A cycle fingerprint binds not only upstream family IDs, but also hypothesis/feature readiness, blocking reasons, candidate status, backtest-plan status, exact work units, scheduling policy, task specifications, creation time, and final cycle status. A change in scientific readiness or execution policy therefore produces a different cycle identity.

## Automated hypothesis generation

`ResearchHypothesis` expands explicit templates into discovery hypotheses.

A template records:

- hypothesis kind;
- strategy and version;
- research question;
- economic or market rationale;
- explicit falsification criterion;
- feature sets;
- discrete parameter space;
- required data capabilities;
- complexity units.

Generation is bounded by:

- maximum template count;
- maximum hypothesis count;
- maximum features per hypothesis;
- maximum parameter dimensions;
- maximum search-space size;
- maximum complexity.

Hypotheses are blocked when required streams are unavailable or the same fingerprint has already been tested. Oversized families are rejected instead of sampled or truncated.

This module generates specifications. It does not invent a favorable result or decide that a hypothesis is true.

## Adaptive feature discovery

`AdaptiveFeatureDiscovery` creates candidate feature specifications from registered point-in-time base features and controlled transformation recipes.

Supported recipe classes:

- identity;
- lag;
- change;
- rolling z-score;
- ratio;
- interaction.

Each generated candidate records:

- source feature lineage;
- operation and window;
- total required lookback;
- required data capabilities;
- role: alpha, regime, risk filter, or execution filter;
- complexity;
- deterministic fingerprint;
- prior experiment status;
- blocking reasons.

Target-derived base fields are never used. Missing source streams, excessive lookbacks, excessive complexity, and already-tested identities fail closed. A generated feature remains only a candidate for block-aware importance and familywise-corrected paired ablation.

## Autonomous experiment scheduling

`ExperimentScheduler` manages a deterministic experiment DAG.

Task types:

1. hypothesis generation;
2. feature discovery;
3. candidate generation;
4. backtest shard;
5. result aggregation;
6. statistical validation;
7. continuous report.

The scheduler provides:

- dependency enforcement;
- deterministic priority ordering;
- worker capability filtering;
- resource-unit limits;
- leases and heartbeats;
- bounded attempts;
- retryable and terminal failures;
- expired-lease recovery;
- dependency failure propagation;
- idempotent completion by result fingerprint;
- cycle and dependency validation.

A completed task cannot be overwritten with a different result fingerprint. A failed dependency blocks downstream tasks. Scheduler policy—including lease duration, attempts, and resource requirements—is part of the cycle fingerprint.

## Distributed backtesting

`DistributedBacktest` creates immutable discovery work units across:

- strategy candidates;
- stress scenarios;
- purged folds;
- instruments;
- deterministic episode shards.

Episode IDs, rather than individual observations, determine shard assignment. A single episode is rejected if it appears in more than one fold or instrument. This preserves the independence contract used by walk-forward and statistical validation.

Every work unit binds:

- dataset fingerprint;
- code commit;
- configuration hash;
- candidate fingerprint;
- scenario-assumption fingerprint;
- fold and instrument;
- shard index and count;
- exact observation and episode IDs.

Worker result fingerprints bind the complete result payload:

- work-unit identity;
- worker identity;
- start and completion times;
- observation and independent-episode counts;
- trade count;
- net PnL, gross profit, and gross loss;
- maximum drawdown;
- completion/failure status and reason;
- live-execution-disabled state.

The aggregator verifies the result fingerprint and requires completed workers to report exactly the observation and episode coverage declared by the work unit. Changing a metric while retaining an old fingerprint is rejected before persistence or aggregation.

Aggregation rejects or marks incomplete:

- duplicate results;
- unexpected work units;
- work-unit or result-content fingerprint mismatch;
- observation/episode coverage mismatch;
- missing work units;
- failed workers;
- results from a rejected plan.

Aggregated expectancy and profit factor are descriptive discovery metrics only. Statistical significance still belongs to the existing episode-level validation engine.

## Autonomous research cycle

`AutonomousResearchLaboratory` binds one complete cycle to:

- dataset, commit, and configuration;
- hypothesis-family fingerprint and per-hypothesis readiness;
- adaptive feature-family fingerprint and per-feature readiness;
- candidate-family fingerprints, status, and hypothesis counts;
- distributed backtest-plan fingerprint, status, and exact work units;
- full effective hypothesis count;
- scheduling policy;
- exact scheduler task graph;
- blocking reasons and final cycle state.

The cycle is blocked if any upstream family is rejected, fingerprints disagree, a backtest references an unregistered candidate, task IDs collide, or the task budget is exceeded.

## Result prioritization

`AutonomousResearchRanking` produces a **research-priority** ranking, not a validated strategy leaderboard.

Structural requirements include:

- complete experiment;
- passed data quality;
- passed split integrity;
- complete scenario matrix;
- minimum independent episodes;
- minimum trades;
- complete confidence, adjusted p-value, drawdown, expected-shortfall, and ruin evidence.

Ranking inputs are validated before scoring. Adjusted p-values, drawdowns, and ruin probabilities must be in `[0, 1]`; profit factor must be non-negative; completed scenarios cannot exceed required scenarios; and hypothesis-family size and complexity must be positive.

The conservative score favors a positive lower confidence bound and profit factor while penalizing:

- drawdown;
- adverse expected shortfall;
- ruin probability;
- feature/strategy complexity;
- size of the tested hypothesis family.

Rows are labeled:

- `REPLICATION_PRIORITY`;
- `EXPLORATORY_ONLY`;
- `BLOCKED`.

Even `REPLICATION_PRIORITY` means only that a candidate deserves another independent discovery replication. It does not authorize holdout access or promotion.

## Continuous reporting

`ContinuousResearchReport` combines:

- cycle status;
- scheduler task counts and completion fraction;
- real-market collection duration;
- instrument count;
- regime coverage;
- data-capability coverage;
- unresolved gaps;
- distributed backtest status;
- ranked and replication-priority candidate counts;
- blockers;
- deterministic next actions.

Research states:

- `ACQUIRING_EVIDENCE`;
- `RUNNING_EXPERIMENTS`;
- `REVIEWING_DISCOVERY_RESULTS`;
- `BLOCKED`.

The Markdown renderer always includes the disclaimer that no profitability claim, promotion, or execution is authorized.

## PostgreSQL migration 006

Migration `006_autonomous_quantitative_research.sql` adds:

- `research.autonomous_research_cycles`;
- `research.autonomous_research_hypotheses`;
- `research.adaptive_feature_candidates`;
- `research.autonomous_experiment_tasks`;
- `research.distributed_backtest_work_units`;
- `research.distributed_backtest_results`;
- `research.autonomous_candidate_rankings`;
- `research.continuous_research_reports`.

Database checks enforce:

- discovery-only evidence;
- false holdout, promotion, profitability, and live-execution flags;
- ready counts not exceeding generated counts;
- replication-priority counts not exceeding ranked counts;
- positive hypothesis-family and complexity counts;
- valid task attempts and lease state;
- non-empty work-unit observation/episode arrays;
- valid JSON object/array shapes;
- valid timestamps, drawdowns, and count relationships.

`PostgresAutonomousResearchStore` persists the cycle, hypotheses, features, initial tasks, and backtest work units in one transaction. Task state, rankings, and continuous reports have explicit parameterized writes. A worker result is fingerprint-verified before its SQL insert is issued.

## Deterministic simulation

`src/tools/simulateAutonomousResearch.ts` demonstrates:

- hypothesis expansion;
- feature discovery;
- candidate generation;
- distributed planning;
- cycle construction;
- scheduler execution;
- continuous evidence reporting.

The simulation intentionally finishes in `ACQUIRING_EVIDENCE` because it provides only 30 days, two instruments, incomplete regime coverage, and incomplete derivatives capabilities. It asserts that profitability, promotion, and live execution remain false.

The simulation is an engineering test, not trading evidence.

## Measurable engineering improvements

| Area | Previous limitation | Phase 6 measurement |
|---|---|---|
| Hypothesis search | Manual or disconnected proposals | Total templates, generated hypotheses, duplicates, blocked reasons, and family fingerprint |
| Feature discovery | Feature formulas implemented individually | Generated candidate count, lineage, lookback, complexity, prior-test status, and capability blockers |
| Experiment execution | Primarily single-process orchestration | Task count, dependency state, lease owner/expiry, attempts, resource units, result fingerprint |
| Backtest scaling | No immutable worker protocol | Exact work-unit count, shard identity, expected/received/missing/duplicate/failed results |
| Worker integrity | Metrics could be reported independently of result identity | Canonical content fingerprint plus exact observation/episode coverage verification |
| Independence | Episode identity could be inconsistently assigned | Planning rejection when one episode spans a fold or instrument boundary |
| Ranking | Metrics could be viewed without search burden | Lower-confidence, tail-risk, complexity, hypothesis-family penalties, and bounded evidence inputs |
| Reporting | Multiple reports required manual reconstruction | One cycle fingerprint with blockers, progress, coverage, scheduling policy, and next actions |
| Restart durability | Scheduler state could be transient | Normalized PostgreSQL cycle/task/work/result/ranking/report evidence |

## Intentionally unchanged

The following are not redesigned because the existing foundation already owns them and no evidence justified replacement:

- strategy formulas and thresholds;
- depth-aware execution simulator;
- point-in-time feature pipeline;
- purged walk-forward construction;
- statistical significance engine;
- robustness matrix;
- execution Monte Carlo;
- portfolio and professional risk controls;
- release candidate gate;
- paper and shadow trading;
- live execution disablement.

Phase 6 coordinates these components. It does not create parallel weaker versions.

## Remaining limitations

- The scheduler is deterministic and persistable, but no production worker transport or queue broker is selected.
- PostgreSQL task claiming still needs an operational repository using `FOR UPDATE SKIP LOCKED` before multiple real workers are started.
- The distributed protocol defines immutable units and aggregation, but workers still need deployment packaging, resource telemetry, artifact signing, and large-artifact storage.
- Adaptive feature discovery generates specifications, not executable feature code. Each operation needs a reviewed point-in-time implementation or a safe expression runtime.
- Automated hypothesis templates still require human-approved economic rationale and falsification language.
- No corrected 180-day, three-instrument, all-regime dataset exists yet.
- Historical sequence-complete depth and liquidation coverage depend on continuous collection.
- No Phase 6 candidate has completed corrected purged discovery, replication, frozen holdout, paper, or shadow evaluation.
- No strategy has statistically validated positive expectancy.

## Highest-priority objectives

1. Keep sequence-complete OKX derivatives collection running continuously.
2. Add collector completeness and freshness inputs directly to the autonomous evidence inventory.
3. Implement PostgreSQL atomic task claiming and heartbeat renewal for multi-worker operation.
4. Package a stateless backtest worker that consumes one immutable work unit and emits one signed, content-addressed result bundle.
5. Add content-addressed storage for large result artifacts and execution traces.
6. Implement reviewed point-in-time executors for adaptive lag, change, z-score, ratio, and interaction specifications.
7. Connect the cycle scheduler to the existing purged walk-forward, feature-ablation, robustness, Monte Carlo, and strategy-comparison modules.
8. Track cumulative hypothesis burden across cycles, not only within one cycle.
9. Add research-budget allocation based on information gain and replication value rather than apparent return alone.
10. Reproduce the Original Whale Strategy baseline on the corrected discovery dataset.
11. Run bounded families for Derivatives Flow V1, Trend Following V1, and Mean Reversion V1.
12. Permit frozen-holdout access only after one candidate survives all discovery and replication gates.
13. Complete prolonged reconciled paper and shadow evaluation before any testnet proposal.

Autonomy improves research throughput. It does not replace scientific evidence or human responsibility for promotion and execution decisions.
