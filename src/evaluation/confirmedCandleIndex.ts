import {
  AlignmentReason,
  alignmentFailure,
  alignmentSuccess,
  type AlignmentValidationResult,
  type InstrumentKey,
} from './alignmentTypes';
import {
  createConfirmedCandleIdentity,
  type NormalizedCandleRecording,
  type NormalizedConfirmedCandle,
  type SupportedConfirmedCandleInterval,
} from './candleNormalization';
import {
  serializeInstrumentKey,
  validateInstrumentKey,
} from './alignmentValidation';

const createIndexKey = (
  instrument: InstrumentKey,
  interval: SupportedConfirmedCandleInterval,
): string => `${serializeInstrumentKey(instrument)}\u001f${interval}`;

const compareCandles = (
  left: NormalizedConfirmedCandle,
  right: NormalizedConfirmedCandle,
): number =>
  left.intervalEnd - right.intervalEnd ||
  left.availabilityTimestamp - right.availabilityTimestamp ||
  left.recordOrdinal - right.recordOrdinal;

export class ConfirmedCandleIndex {
  private readonly candlesByKey = new Map<
    string,
    readonly NormalizedConfirmedCandle[]
  >();
  private readonly conflictingIdentities: ReadonlySet<string>;

  public constructor(recording: NormalizedCandleRecording) {
    const mutableIndex = new Map<string, NormalizedConfirmedCandle[]>();

    for (const candle of recording.confirmedCandles) {
      const key = createIndexKey(candle.instrument, candle.interval);
      const candles = mutableIndex.get(key);

      if (candles) {
        candles.push(candle);
      } else {
        mutableIndex.set(key, [candle]);
      }
    }

    for (const [key, candles] of mutableIndex) {
      this.candlesByKey.set(
        key,
        Object.freeze([...candles].sort(compareCandles)),
      );
    }

    this.conflictingIdentities = new Set(
      recording.duplicateGroups
        .filter((group) => group.conflictingRecordOrdinals.length > 0)
        .map((group) => createConfirmedCandleIdentity(group)),
    );
  }

  public findFirstAtOrAfter(
    instrument: InstrumentKey,
    interval: SupportedConfirmedCandleInterval,
    targetTimestamp: number,
  ): AlignmentValidationResult<NormalizedConfirmedCandle | undefined> {
    const candidatesResult = this.getCandidates(
      instrument,
      interval,
      targetTimestamp,
    );
    if (!candidatesResult.valid) {
      return candidatesResult;
    }

    const candidate = candidatesResult.value[0];
    if (
      candidate &&
      this.conflictingIdentities.has(createConfirmedCandleIdentity(candidate))
    ) {
      return alignmentFailure(
        AlignmentReason.CONFLICTING_DUPLICATE,
        'AMBIGUOUS',
      );
    }

    return alignmentSuccess(candidate);
  }

  public findRange(
    instrument: InstrumentKey,
    interval: SupportedConfirmedCandleInterval,
    startTimestamp: number,
    endTimestamp: number,
  ): AlignmentValidationResult<readonly NormalizedConfirmedCandle[]> {
    if (
      !Number.isSafeInteger(startTimestamp) ||
      !Number.isSafeInteger(endTimestamp) ||
      endTimestamp < startTimestamp
    ) {
      return alignmentFailure(AlignmentReason.TIMESTAMP_RANGE_INVALID);
    }

    const candidatesResult = this.getCandidates(
      instrument,
      interval,
      startTimestamp,
    );
    if (!candidatesResult.valid) {
      return candidatesResult;
    }

    const selected = candidatesResult.value.filter(
      (candle) => candle.intervalEnd <= endTimestamp,
    );
    if (selected.some((candle) => this.isAmbiguous(candle))) {
      return alignmentFailure(
        AlignmentReason.CONFLICTING_DUPLICATE,
        'AMBIGUOUS',
      );
    }

    return alignmentSuccess(Object.freeze(selected));
  }

  public isAmbiguous(candle: NormalizedConfirmedCandle): boolean {
    return this.conflictingIdentities.has(
      createConfirmedCandleIdentity(candle),
    );
  }

  public getCandidates(
    instrument: InstrumentKey,
    interval: SupportedConfirmedCandleInterval,
    targetTimestamp: number,
  ): AlignmentValidationResult<readonly NormalizedConfirmedCandle[]> {
    const instrumentResult = validateInstrumentKey(instrument);
    if (!instrumentResult.valid) {
      return instrumentResult;
    }
    if (!Number.isSafeInteger(targetTimestamp) || targetTimestamp < 0) {
      return alignmentFailure(AlignmentReason.TIMESTAMP_UNIT_INVALID);
    }

    const candles =
      this.candlesByKey.get(createIndexKey(instrument, interval)) ?? [];
    let lower = 0;
    let upper = candles.length;

    while (lower < upper) {
      const middle = lower + Math.floor((upper - lower) / 2);
      const candle = candles[middle];

      if (candle && candle.intervalEnd < targetTimestamp) {
        lower = middle + 1;
      } else {
        upper = middle;
      }
    }

    return alignmentSuccess(candles.slice(lower));
  }
}
