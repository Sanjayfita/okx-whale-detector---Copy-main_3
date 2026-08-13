import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseAlertOutcomeObservation, formatOutcomeHorizon, type AlertOutcomeObservation } from '../alertOutcomeObservation';
import { readEvidenceNdjsonFile } from '../evidenceNdjson';
import { parseQualifiedAlertEvidenceRecord } from '../qualifiedAlertEvidence';
import { parseQuarantinedEvidenceEpisode } from '../evidenceQuarantine';
import { parseAlphaResearchEventSnapshot } from '../alphaSnapshotParser';
import type { HistoricalDerivedContextRecord } from './historicalMidpointContext';
import type { HistoricalFundingIndex } from './historicalFunding';
import { parseEvidenceCoverageGap } from '../evidenceCoverageGap';

const mean = (values: readonly number[]): number | null => values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
const pct = (count: number, total: number): number | null => total === 0 ? null : count / total;

const parseContext = (value: unknown): HistoricalDerivedContextRecord | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Partial<HistoricalDerivedContextRecord>;
  return record.schemaVersion === 1 && typeof record.alertId === 'string' && typeof record.instrumentId === 'string' && typeof record.detectedAt === 'number' && record.source === 'DERIVED_FROM_HISTORICAL_L2_MIDPOINT'
    ? record as HistoricalDerivedContextRecord
    : undefined;
};

const summarizeOutcomes = (
  outcomes: readonly AlertOutcomeObservation[],
  costPercent: number,
  directionByAlert: ReadonlyMap<string, 'BULLISH' | 'BEARISH'>,
  fundingIndex?: HistoricalFundingIndex,
) => {
  const groups = new Map<number, AlertOutcomeObservation[]>();
  for (const outcome of outcomes) {
    const group = groups.get(outcome.horizonMinutes) ?? [];
    group.push(outcome);
    groups.set(outcome.horizonMinutes, group);
  }
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([left], [right]) => left - right)
      .map(([horizon, rows]) => {
        const fundingAdjusted = rows.map((row) => {
          const direction = directionByAlert.get(row.alertId);
          if (direction === undefined || fundingIndex === undefined) return null;
          const directionSign = direction === 'BULLISH' ? 1 : -1;
          const fundingPercent =
            fundingIndex.sumRates(row.instrumentId, row.detectedAt, row.observedAt) *
            100;
          return (
            row.directionAdjustedReturnPercent -
            costPercent -
            directionSign * fundingPercent
          );
        });
        const availableFundingAdjusted = fundingAdjusted.filter(
          (value): value is number => value !== null,
        );
        return [
          formatOutcomeHorizon(
            horizon as AlertOutcomeObservation['horizonMinutes'],
          ),
          {
            horizonMinutes: horizon,
            samples: rows.length,
            continuationRate: pct(
              rows.filter((row) => row.directionAdjustedReturnPercent > 0)
                .length,
              rows.length,
            ),
            reversalRate: pct(
              rows.filter((row) => row.directionAdjustedReturnPercent < 0)
                .length,
              rows.length,
            ),
            flatRate: pct(
              rows.filter((row) => row.directionAdjustedReturnPercent === 0)
                .length,
              rows.length,
            ),
            meanGrossDirectionalReturnPercent: mean(
              rows.map((row) => row.directionAdjustedReturnPercent),
            ),
            meanNetDirectionalReturnPercent: mean(
              rows.map(
                (row) => row.directionAdjustedReturnPercent - costPercent,
              ),
            ),
            meanFundingAdjustedNetDirectionalReturnPercent:
              fundingIndex === undefined
                ? null
                : mean(availableFundingAdjusted),
            fundingAdjustedSamples: availableFundingAdjusted.length,
            meanMfePercent: mean(
              rows.map((row) => row.maximumFavorableExcursionPercent),
            ),
            meanMaePercent: mean(
              rows.map((row) => row.maximumAdverseExcursionPercent),
            ),
            observedPathRate: pct(
              rows.filter(
                (row) => row.excursionMeasurement === 'OBSERVED_PATH',
              ).length,
              rows.length,
            ),
          },
        ];
      }),
  );
};

export const generateHistoricalReplayReport = async (input: {
  readonly workspace: string;
  readonly runId: string;
  readonly sourceFiles: readonly string[];
  readonly sourceFingerprint: string;
  readonly firstTimestamp: number;
  readonly lastTimestamp: number;
  readonly feesBps: number;
  readonly slippageBps: number;
  readonly fundingIndex?: HistoricalFundingIndex;
  readonly fundingSourceFile?: string;
}): Promise<void> => {
  const [alerts, outcomes, snapshots, quarantines, coverageGaps] = await Promise.all([
    readEvidenceNdjsonFile(join(input.workspace, 'qualified-alerts.ndjson'), parseQualifiedAlertEvidenceRecord),
    readEvidenceNdjsonFile(join(input.workspace, 'outcomes.ndjson'), parseAlertOutcomeObservation),
    readEvidenceNdjsonFile(join(input.workspace, 'alpha-snapshots.ndjson'), parseAlphaResearchEventSnapshot),
    readEvidenceNdjsonFile(join(input.workspace, 'quarantined-episodes.ndjson'), parseQuarantinedEvidenceEpisode),
    readEvidenceNdjsonFile(join(input.workspace, 'coverage-gaps.ndjson'), parseEvidenceCoverageGap),
  ]);
  const contextText = await readFile(join(input.workspace, 'historical-derived-context.ndjson'), 'utf8').catch(() => '');
  const contexts = contextText.split(/\r?\n/u).filter(Boolean).map((line) => parseContext(JSON.parse(line) as unknown)).filter((value): value is HistoricalDerivedContextRecord => value !== undefined);
  const quarantinedIds = new Set(quarantines.records.map((record) => record.alertId));
  const validAlerts = alerts.records.filter((alert) => !quarantinedIds.has(alert.alertId));
  const validOutcomes = outcomes.records.filter((outcome) => !quarantinedIds.has(outcome.alertId));
  const costPercent = ((input.feesBps + input.slippageBps) * 2) / 100;
  const directionByAlert = new Map(
    validAlerts.map((alert) => [alert.alertId, alert.direction] as const),
  );

  const byInstrument = Object.fromEntries([...new Set(validAlerts.map((alert) => alert.instrumentId))].sort().map((instrumentId) => {
    const instrumentOutcomes = validOutcomes.filter((outcome) => outcome.instrumentId === instrumentId);
    return [instrumentId, {
      validAlerts: validAlerts.filter((alert) => alert.instrumentId === instrumentId).length,
      outcomes: instrumentOutcomes.length,
      horizons: summarizeOutcomes(instrumentOutcomes, costPercent, directionByAlert, input.fundingIndex),
    }];
  }));

  const byAlert = new Map<string, AlertOutcomeObservation[]>();
  for (const outcome of validOutcomes) {
    const rows = byAlert.get(outcome.alertId) ?? [];
    rows.push(outcome);
    byAlert.set(outcome.alertId, rows);
  }
  const entryDelays = [0.08333333333333333, 0.25, 0.5].map((entryHorizon) => {
    const returns: number[] = [];
    for (const rows of byAlert.values()) {
      const entry = rows.find((row) => row.horizonMinutes === entryHorizon);
      const exit = rows.find((row) => row.horizonMinutes === 60);
      if (!entry || !exit) continue;
      const raw = ((exit.observedPrice - entry.observedPrice) / entry.observedPrice) * 100;
      const direction = directionByAlert.get(entry.alertId);
      if (direction === undefined) continue;
      const directionSign = direction === 'BULLISH' ? 1 : -1;
      const fundingPercent = input.fundingIndex === undefined
        ? 0
        : input.fundingIndex.sumRates(entry.instrumentId, entry.observedAt, exit.observedAt) * 100;
      returns.push(raw * directionSign - costPercent - directionSign * fundingPercent);
    }
    return { entryDelay: formatOutcomeHorizon(entryHorizon as AlertOutcomeObservation['horizonMinutes']), exitHorizon: '60m', samples: returns.length, meanNetDirectionalReturnPercent: mean(returns), positiveRate: pct(returns.filter((value) => value > 0).length, returns.length) };
  });

  const candidateStops = [0.25, 0.5, 1, 2];
  const candidateTargets = [0.5, 1, 2, 3];
  const complete60m = validOutcomes.filter((row) => row.horizonMinutes === 60);
  const stopTargetFeasibility = candidateStops.flatMap((stop) => candidateTargets.map((target) => ({
    stopPercent: stop,
    targetPercent: target,
    samples: complete60m.length,
    targetReachedRate: pct(complete60m.filter((row) => row.maximumFavorableExcursionPercent >= target).length, complete60m.length),
    stopReachedRate: pct(complete60m.filter((row) => row.maximumAdverseExcursionPercent >= stop).length, complete60m.length),
    bothReachedOrderAmbiguousRate: pct(complete60m.filter((row) => row.maximumFavorableExcursionPercent >= target && row.maximumAdverseExcursionPercent >= stop).length, complete60m.length),
    note: 'Feasibility only; standardized horizon samples do not prove which threshold was hit first when both are reached.',
  })));

  const chronological = [...validAlerts].sort((a,b) => a.detectedAt-b.detectedAt);
  const folds = [0,1,2].map((fold) => {
    const start = Math.floor((chronological.length * fold) / 3);
    const end = Math.floor((chronological.length * (fold + 1)) / 3);
    const ids = new Set(chronological.slice(start,end).map((alert) => alert.alertId));
    const rows = validOutcomes.filter((row) => row.horizonMinutes === 15 && ids.has(row.alertId));
    return { fold: fold + 1, samples: rows.length, startAt: chronological[start]?.detectedAt ?? null, endAt: chronological[Math.max(start,end-1)]?.detectedAt ?? null, meanNetDirectionalReturnPercent: mean(rows.map((row) => row.directionAdjustedReturnPercent - costPercent)), positiveRate: pct(rows.filter((row) => row.directionAdjustedReturnPercent - costPercent > 0).length, rows.length) };
  });

  const report = Object.freeze({
    schemaVersion: 1,
    runId: input.runId,
    source: 'OKX_HISTORICAL_L2_REPLAY',
    sourceFingerprint: input.sourceFingerprint,
    sourceFiles: input.sourceFiles,
    firstTimestamp: input.firstTimestamp,
    lastTimestamp: input.lastTimestamp,
    replaySpanDays: (input.lastTimestamp - input.firstTimestamp) / 86_400_000,
    totalQualifiedAlerts: alerts.records.length,
    validEpisodes: validAlerts.length,
    quarantinedEpisodes: quarantines.records.length,
    validSnapshots: snapshots.records.filter((snapshot) => !quarantinedIds.has(snapshot.evidence.alertId)).length,
    completedObservations: validOutcomes.length,
    costAssumptions: {
      feesBpsPerSide: input.feesBps,
      slippageBpsPerSide: input.slippageBps,
      roundTripCostPercent: costPercent,
      funding: input.fundingIndex === undefined ? null : 'HISTORICAL_COMPANION',
      fundingSourceFile: input.fundingSourceFile ?? null,
      fundingRecords: input.fundingIndex?.recordCount ?? 0,
      fundingAvailability:
        input.fundingIndex === undefined
          ? 'UNAVAILABLE_NO_COMPANION_FUNDING_DATA_PROVIDED'
          : 'AVAILABLE_FROM_EXPLICIT_COMPANION_DATA',
    },
    outcomeHorizons: summarizeOutcomes(
      validOutcomes,
      costPercent,
      directionByAlert,
      input.fundingIndex,
    ),
    crossInstrument: byInstrument,
    entryDelayAnalysis: entryDelays,
    stopTargetFeasibility,
    timeExitAnalysis: summarizeOutcomes(
      validOutcomes,
      costPercent,
      directionByAlert,
      input.fundingIndex,
    ),
    walkForwardChronologicalThirds15m: folds,
    unavailablePeriods: {
      coverageGapCount: coverageGaps.records.length,
      totalGapDurationMs: coverageGaps.records.reduce(
        (sum, gap) => sum + gap.durationMs,
        0,
      ),
      ranges: coverageGaps.records.map((gap) => ({
        startedAt: gap.startedAt,
        endedAt: gap.endedAt,
        durationMs: gap.durationMs,
        instruments: gap.instrumentIds,
        reason: gap.reason,
      })),
    },
    derivedMarketContextAvailability: {
      records: contexts.length,
      ema20: contexts.filter((row) => row.ema20 !== null).length,
      ema50: contexts.filter((row) => row.ema50 !== null).length,
      ema200: contexts.filter((row) => row.ema200 !== null).length,
      realizedVolatility20: contexts.filter((row) => row.realizedVolatility20Percent !== null).length,
      marketStructure: contexts.filter((row) => row.marketStructure !== 'UNAVAILABLE').length,
      source: 'DERIVED_FROM_HISTORICAL_L2_MIDPOINT',
      volume: 'UNAVAILABLE_FROM_L2_ONLY',
    },
    featureAvailabilityNotes: {
      wallPersistenceRefillOrderBookImbalance: 'Captured by the same MarketEngine/alpha snapshot path when available.',
      spoofAbsorptionTradeFlow: 'Unavailable unless historical trade-flow inputs support those detectors; never fabricated.',
      funding: input.fundingIndex === undefined ? 'Unavailable because no companion funding data was provided; never fabricated.' : 'Funding-adjusted expectancy uses the explicit companion funding records.',
    },
    liveOrderExecutionAllowed: false,
  });
  await writeFile(join(input.workspace, 'historical-replay-summary.json'), `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8' });
}
