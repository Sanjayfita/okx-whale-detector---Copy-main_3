import { describe, expect, it } from 'vitest';

import {
  ALERT_ALIGNMENT_SOURCE_ORDER,
  AlignmentReason,
  createAlertAlignmentEvaluationConfiguration,
  generateAlertAlignmentEvaluations,
} from '../src/evaluation';
import type { CorrelatedAlertRecordV1 } from '../src/recording/CorrelatedAlertRecorder';
import {
  EVALUATION_NOW,
  createDefaultEvaluationConfiguration,
  createEvaluationAlert,
  createEvaluationMarketLines,
  createPreparedEvaluationMarket,
} from './helpers/alignmentEvaluationFixtures';

const generate = (
  overrides: Partial<
    Parameters<typeof generateAlertAlignmentEvaluations>[0]
  > = {},
) =>
  generateAlertAlignmentEvaluations({
    alerts: [createEvaluationAlert()],
    marketRecording: createPreparedEvaluationMarket(),
    configuration: createDefaultEvaluationConfiguration(),
    evaluationRunId: 'evaluation-run:test',
    now: EVALUATION_NOW + 7_200_000,
    ...overrides,
  });

describe('alert alignment evaluation configuration and identity', () => {
  it('creates a stable fingerprint independent of input source order', () => {
    const left = createAlertAlignmentEvaluationConfiguration({
      requestedSources: ['CONFIRMED_CANDLE_CLOSE', 'ORDER_BOOK_MIDPOINT'],
    });
    const right = createAlertAlignmentEvaluationConfiguration({
      requestedSources: ['ORDER_BOOK_MIDPOINT', 'CONFIRMED_CANDLE_CLOSE'],
    });

    expect(left.fingerprint).toBe(right.fingerprint);
    expect(left.requestedSources).toEqual([
      'ORDER_BOOK_MIDPOINT',
      'CONFIRMED_CANDLE_CLOSE',
    ]);
  });

  it('changes the fingerprint for outcome-affecting configuration', () => {
    const original = createDefaultEvaluationConfiguration();
    const changed = createAlertAlignmentEvaluationConfiguration({
      alignment: {
        version: 'alignment-v1',
        horizonsMs: [60_000],
        sourceFallback: 'NONE',
        orderBookMaximumEventLatenessMs: 5_001,
        candleMaximumEventLatenessMs: 60_000,
        localArrivalAllowanceMs: 5_000,
        allowedClockSkewMs: 5_000,
        legacyReferenceMaximumAgeMs: 5_000,
        minimumValidTimestampMs: Date.UTC(2000, 0, 1),
        maximumValidTimestampMs: Date.UTC(2100, 0, 1),
        maximumFutureOffsetMs: 86_400_000,
      },
    });

    expect(changed.fingerprint).not.toBe(original.fingerprint);
  });

  it('rejects duplicate and unsupported requested sources', () => {
    expect(() =>
      createAlertAlignmentEvaluationConfiguration({
        requestedSources: ['ORDER_BOOK_MIDPOINT', 'ORDER_BOOK_MIDPOINT'],
      }),
    ).toThrow(/unique/);
    expect(() =>
      createAlertAlignmentEvaluationConfiguration({
        requestedSources: ['INVALID' as never],
      }),
    ).toThrow(/supported/);
  });

  it('keeps evaluationId stable across run IDs and recordedAt values', () => {
    const first = generate()[0]!;
    const second = generate({
      evaluationRunId: 'evaluation-run:other',
      now: EVALUATION_NOW + 7_300_000,
    })[0]!;

    expect(second.evaluationId).toBe(first.evaluationId);
    expect(second.evaluationRunId).not.toBe(first.evaluationRunId);
    expect(second.recordedAt).not.toBe(first.recordedAt);
  });

  it('changes evaluationId for recording or configuration changes', () => {
    const original = generate()[0]!;
    const changedRecording = generate({
      marketRecording: createPreparedEvaluationMarket(
        createEvaluationMarketLines({ recordingId: 'recording:other' }),
      ),
    })[0]!;
    const configuration = createAlertAlignmentEvaluationConfiguration({
      requestedSources: ['ORDER_BOOK_MIDPOINT'],
    });
    const changedConfiguration = generate({
      configuration,
      marketRecording: createPreparedEvaluationMarket(
        createEvaluationMarketLines(),
        configuration,
      ),
    })[0]!;

    expect(changedRecording.evaluationId).not.toBe(original.evaluationId);
    expect(changedConfiguration.evaluationId).not.toBe(original.evaluationId);
  });
});

describe('alert alignment evaluation matrix generation', () => {
  it('creates the complete default 5 by 3 matrix in canonical order', () => {
    const record = generate()[0]!;

    expect(record.alignments).toHaveLength(15);
    expect(
      record.alignments.map(({ horizonMs, source }) => [horizonMs, source]),
    ).toEqual(
      [60_000, 300_000, 900_000, 1_800_000, 3_600_000].flatMap((horizonMs) =>
        ALERT_ALIGNMENT_SOURCE_ORDER.map((source) => [horizonMs, source]),
      ),
    );
    expect(
      record.alignments.every(
        (alignment) => alignment.completeness === 'COMPLETE',
      ),
    ).toBe(true);
  });

  it('preserves captured reference values exactly', () => {
    const alert = createEvaluationAlert({
      referenceBestBid: 100.1,
      referenceBestAsk: 100.3,
      referenceMidpoint: 100.2,
      referenceSpread: 0.2,
      referenceSpreadPercent: (0.2 / 100.2) * 100,
    });
    const record = generate({ alerts: [alert] })[0]!;

    expect(record.reference).toEqual({
      referenceTimestamp: alert.evaluationContext.referenceTimestamp,
      sourceMarketTimestamp: alert.evaluationContext.sourceMarketTimestamp,
      sourceSignalTimestamp: alert.evaluationContext.sourceSignalTimestamp,
      midpoint: 100.2,
      bestBid: 100.1,
      bestAsk: 100.3,
      spread: 0.2,
      spreadPercent: (0.2 / 100.2) * 100,
      provenance: 'CAPTURED_ALERT_CONTEXT',
    });
  });

  it('emits typed INVALID cells for inconsistent captured arithmetic', () => {
    const record = generate({
      alerts: [createEvaluationAlert({ referenceMidpoint: 999 })],
    })[0]!;

    expect(
      record.alignments.every(
        (alignment) =>
          alignment.completeness === 'INVALID' &&
          alignment.primaryReason ===
            AlignmentReason.REFERENCE_CONTEXT_INVALID &&
          alignment.selectedObservation === null,
      ),
    ).toBe(true);
    expect(record.reference?.midpoint).toBe(999);
  });

  it('emits every matrix position for a session mismatch', () => {
    const record = generate({
      alerts: [createEvaluationAlert({ sourceSessionId: 'different-session' })],
    })[0]!;

    expect(record.alignments).toHaveLength(15);
    expect(
      record.alignments.every(
        (alignment) =>
          alignment.completeness === 'MISSING' &&
          alignment.primaryReason ===
            AlignmentReason.NO_MATCHING_MARKET_SESSION,
      ),
    ).toBe(true);
  });

  it('emits every matrix position for an instrument mismatch', () => {
    const record = generate({
      alerts: [createEvaluationAlert({ instId: 'ETH-USDT' })],
    })[0]!;

    expect(
      record.alignments.every(
        (alignment) =>
          alignment.primaryReason === AlignmentReason.INSTRUMENT_MISMATCH,
      ),
    ).toBe(true);
  });

  it('marks clean end-before-horizon and truncated observations explicitly', () => {
    const clean = generate({
      alerts: [
        createEvaluationAlert({
          referenceTimestamp: EVALUATION_NOW + 3_600_000,
        }),
      ],
    })[0]!;
    const truncated = generate({
      marketRecording: createPreparedEvaluationMarket(
        createEvaluationMarketLines({ clean: false }),
      ),
    })[0]!;

    expect(
      clean.alignments.some(
        (alignment) =>
          alignment.primaryReason ===
          AlignmentReason.RECORDING_ENDED_BEFORE_HORIZON,
      ),
    ).toBe(true);
    expect(truncated.provenance.recordingTermination).toBe('TRUNCATED');
    expect(
      truncated.alignments.some(
        (alignment) =>
          alignment.completeness === 'PARTIAL' &&
          alignment.primaryReason === AlignmentReason.RECORDING_TRUNCATED,
      ),
    ).toBe(true);
  });

  it('keeps legacy alerts complete and explicitly unverified', () => {
    const versioned = createEvaluationAlert();
    const legacy: CorrelatedAlertRecordV1 = {
      schemaVersion: 1,
      recordedAt: versioned.recordedAt,
      alert: {
        ...versioned.alert,
        sourceSessionId: undefined,
        alertSequence: undefined,
      },
    };
    const record = generate({ alerts: [legacy] })[0]!;

    expect(record.reference).toBeNull();
    expect(record.instrument.instType).toBeNull();
    expect(record.alignments).toHaveLength(15);
    expect(
      record.alignments.every(
        (alignment) =>
          alignment.primaryReason === AlignmentReason.LEGACY_LINKAGE_UNVERIFIED,
      ),
    ).toBe(true);
  });

  it('sorts multiple alerts by reference timestamp then durable ID', () => {
    const records = generate({
      alerts: [
        createEvaluationAlert({
          sequence: 2,
          referenceTimestamp: EVALUATION_NOW + 1,
        }),
        createEvaluationAlert({ sequence: 1 }),
      ],
    });

    expect(records.map((record) => record.alertIdentity.alertSequence)).toEqual(
      [1, 2],
    );
  });

  it('evaluates multiple alerts against one prepared recording', () => {
    const records = generate({
      alerts: [
        createEvaluationAlert({ sequence: 1 }),
        createEvaluationAlert({ sequence: 2 }),
      ],
    });

    expect(records).toHaveLength(2);
    expect(records.every((record) => record.alignments.length === 15)).toBe(
      true,
    );
    expect(new Set(records.map((record) => record.evaluationId)).size).toBe(2);
  });

  it('keeps SPOT and SWAP instruments isolated', () => {
    const marketRecording = createPreparedEvaluationMarket(
      createEvaluationMarketLines({
        instruments: [
          {
            instId: 'BTC-USDT',
            instType: 'SPOT',
            quoteCurrency: 'USDT',
            baseUnitsPerSize: 1,
          },
          {
            instId: 'ETH-USDT-SWAP',
            instType: 'SWAP',
            quoteCurrency: 'USDT',
            baseUnitsPerSize: 0.01,
          },
        ],
      }),
    );
    const record = generate({
      alerts: [
        createEvaluationAlert({
          instId: 'ETH-USDT-SWAP',
          instType: 'SWAP',
        }),
      ],
      marketRecording,
    })[0]!;

    expect(record.instrument).toEqual({
      instId: 'ETH-USDT-SWAP',
      instType: 'SWAP',
    });
    expect(
      record.alignments.every(
        (alignment) => alignment.selectedObservation === null,
      ),
    ).toBe(true);
  });

  it('preserves sequence-gap provenance in order-book results', () => {
    const lines = createEvaluationMarketLines();
    const updateIndex = lines.findIndex((line) => {
      const value = JSON.parse(line) as {
        type?: string;
        update?: { action?: string };
      };
      return value.type === 'orderBook' && value.update?.action === 'update';
    });
    const update = JSON.parse(lines[updateIndex]!) as {
      update: { prevSeqId: number };
    };
    update.update.prevSeqId = 999;
    lines[updateIndex] = JSON.stringify(update);
    const record = generate({
      marketRecording: createPreparedEvaluationMarket(lines),
    })[0]!;

    expect(
      record.alignments.some(
        (alignment) =>
          alignment.source === 'ORDER_BOOK_MIDPOINT' &&
          alignment.primaryReason === AlignmentReason.SEQUENCE_GAP,
      ),
    ).toBe(true);
  });

  it('does not infer legacy market linkage', () => {
    const legacyMarket = createPreparedEvaluationMarket([
      JSON.stringify({
        type: 'instrument',
        recordedAt: EVALUATION_NOW,
        instrument: { instId: 'BTC-USDT' },
      }),
    ]);
    const record = generate({ marketRecording: legacyMarket })[0]!;

    expect(record.provenance.marketRecordingFormat).toBe('LEGACY_UNVERSIONED');
    expect(record.provenance.recordingId).toBeNull();
    expect(
      record.alignments.every(
        (alignment) =>
          alignment.primaryReason === AlignmentReason.LEGACY_LINKAGE_UNVERIFIED,
      ),
    ).toBe(true);
  });

  it('marks a recording that starts after the captured reference', () => {
    const record = generate({
      alerts: [
        createEvaluationAlert({
          referenceTimestamp: EVALUATION_NOW - 2_000,
        }),
      ],
    })[0]!;

    expect(
      record.alignments.every(
        (alignment) =>
          alignment.primaryReason ===
          AlignmentReason.RECORDING_STARTED_AFTER_REFERENCE,
      ),
    ).toBe(true);
  });
});
