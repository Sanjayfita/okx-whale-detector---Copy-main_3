# Calibrated confidence, authenticity, trade management, and risk research

## Purpose

This research layer addresses four gaps that cannot be solved by stacking more chart indicators:

1. heuristic whale pressure is not a probability of success;
2. displayed liquidity must be separated from authentic execution or deceptive cancellation;
3. target/stop research must not invent the order in which barriers were reached;
4. entry quality must be evaluated separately from sizing, costs, and portfolio exposure.

All modules are research-only. They do not change production signal qualification and they do not authorize live, testnet, simulated, or transport order execution.

## Probability-of-success model

`alphaProbabilityModel.ts` implements deterministic L2-regularized logistic regression. Medians, means, standard deviations, coefficients, and the class prior are learned from training rows only. Missing features use the training median. A training population containing only successes or only failures is rejected.

The target is explicit: a success occurs when `netReturnPercent` exceeds the configured threshold. Since the alpha dataset subtracts the configured round-trip cost exactly once, the default threshold of zero means profitable after the frozen cost assumption.

Probability diagnostics include:

- Brier score;
- logarithmic loss;
- ROC AUC;
- accuracy at 0.5;
- base success rate;
- fixed-bin reliability summaries;
- expected calibration error;
- maximum calibration error.

`alphaConfidenceResearch.ts` applies the model through the existing purged chronological walk-forward split:

1. each fold model is fit only on its training rows;
2. raw probabilities and logit scores are produced only for the next testing rows;
3. discovery calibration for a fold uses Platt scaling fit only on score/outcome pairs from earlier folds;
4. the final logistic model is fit on the purged final-training partition;
5. the final Platt calibrator is fit only on discovery out-of-sample scores;
6. the final holdout is used once for untouched probability and calibration diagnostics.

A calibrated probability does not prove positive expectancy. Promotion still requires positive cost-adjusted expectancy, stable holdout performance, adequate independent episodes, instrument stability, regime stability, and execution review.

## Whale-authenticity evidence

`whaleAuthenticityEvidence.ts` separates information available at event time from labels observed after wall removal.

Event-time observations can retain:

- whale price and notional;
- distance from the reference market;
- persistence;
- refill count;
- lifecycle update, increase, and decrease counts;
- initial, peak, minimum, and current notional;
- matching aggressive notional;
- execution ratio;
- point-in-time spoof probability and absorption score when genuinely available.

The extractor creates deterministic raw features such as notional change, peak drawdown, recovery from the minimum, update rates, distance, and execution evidence. It does not use removal classification or final lifetime when generating features.

Post-event outcomes may label a wall as:

- `LIKELY_EXECUTED`;
- `POSSIBLE_CANCELLATION`;
- `UNCONFIRMED_DISAPPEARANCE`.

Only confirmed execution and cancellation observations enter the binary authenticity dataset. Unconfirmed, missing, and unmatched outcomes are counted and excluded rather than guessed.

The next integration step is to persist these records from the live whale lifecycle and removal-assessment path. Until that wiring exists, the contract and leakage tests define the required scientific boundary but do not create historical observations retroactively.

## Trade-management bounds

`tradeManagementResearch.ts` evaluates a fixed target, stop, horizon, and round-trip cost against observed path excursions.

When only one barrier was reached, the outcome is unambiguous. When neither was reached, the terminal direction-adjusted return is used. When both MFE and MAE cross their barriers but the stored data lacks intrapath ordering, the report does not guess which occurred first. It reports:

- a conservative lower bound assuming the stop was hit first;
- an optimistic upper bound assuming the target was hit first;
- a separate result using only unambiguous observations;
- the fraction of observations with ambiguous barrier ordering.

Reported metrics include win rate, expectancy, cumulative return, profit factor, event Sharpe, event Sortino, maximum drawdown, and recovery factor. Event returns are additive diagnostics, not a leveraged capital or liquidation model.

## Risk-management research

`riskManagementResearch.ts` runs a chronological equity simulation over already labeled trade observations. It intentionally does not improve or alter the signal itself.

Before a trade is accepted, the simulator checks:

- expected move versus estimated total cost;
- fixed fractional risk;
- maximum per-trade risk;
- volatility targeting;
- maximum position fraction;
- maximum concurrent portfolio risk;
- maximum concurrent risk within a correlation group.

Sizing uses only the event-time stop distance and volatility inputs. Active risk is released only when the recorded exit time is reached. The simulator reports every acceptance or rejection and the resulting equity-return metrics.

## Empirical boundary

The repository still contains no corrected real historical evidence dataset. Unit-test fixtures validate mathematics, chronology, calibration, failure behavior, and safety invariants only. They are not feature-importance, win-rate, expectancy, Sharpe, drawdown, or profitability evidence.

Do not enable the probability model, authenticity model, target/stop policy, or sizing policy in production until a new frozen OKX-native evaluation has accumulated enough independent episodes and passed the repository's discovery and final-holdout gates.
