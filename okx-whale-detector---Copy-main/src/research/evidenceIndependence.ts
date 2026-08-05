import type { QualifiedAlertEvidenceRecord } from './qualifiedAlertEvidence';

export interface EvidenceIndependenceMetrics {
  readonly maximumOutcomeHorizonMinutes: number;
  readonly independentAlertCount: number;
  readonly dependentAlertCount: number;
}

type EvidenceAlertIdentity = Pick<
  QualifiedAlertEvidenceRecord,
  'alertId' | 'instrumentId' | 'detectedAt'
>;

const compareAlerts = (
  left: Pick<QualifiedAlertEvidenceRecord, 'detectedAt' | 'alertId'>,
  right: Pick<QualifiedAlertEvidenceRecord, 'detectedAt' | 'alertId'>,
): number =>
  left.detectedAt - right.detectedAt || left.alertId.localeCompare(right.alertId);

const validateHorizonWindow = (horizonsMinutes: readonly number[]): number => {
  if (
    horizonsMinutes.length === 0 ||
    horizonsMinutes.some(
      (horizon) => !Number.isSafeInteger(horizon) || horizon <= 0,
    )
  ) {
    throw new Error('Evidence outcome horizons must be positive safe integers');
  }

  const maximumOutcomeHorizonMinutes = Math.max(...horizonsMinutes);
  const labelWindowMs = maximumOutcomeHorizonMinutes * 60_000;
  if (!Number.isSafeInteger(labelWindowMs)) {
    throw new Error('Maximum evidence outcome horizon is too large');
  }
  return labelWindowMs;
};

/**
 * Selects a deterministic non-overlapping alert sample per instrument.
 *
 * The first event-time alert is retained, then all later alerts whose label
 * window overlaps it are excluded until the full maximum horizon has elapsed.
 */
export const selectIndependentEvidenceAlertIds = (
  alerts: readonly EvidenceAlertIdentity[],
  horizonsMinutes: readonly number[],
): ReadonlySet<string> => {
  const labelWindowMs = validateHorizonWindow(horizonsMinutes);
  const alertsByInstrument = new Map<
    string,
    Array<Pick<QualifiedAlertEvidenceRecord, 'alertId' | 'detectedAt'>>
  >();
  const seenAlertIds = new Set<string>();

  for (const alert of alerts) {
    if (
      alert.instrumentId.trim().length === 0 ||
      alert.alertId.trim().length === 0 ||
      seenAlertIds.has(alert.alertId) ||
      !Number.isSafeInteger(alert.detectedAt) ||
      alert.detectedAt < 0
    ) {
      throw new Error('Evidence alert identity or timestamp is invalid');
    }
    seenAlertIds.add(alert.alertId);
    const instrumentAlerts = alertsByInstrument.get(alert.instrumentId) ?? [];
    instrumentAlerts.push({ alertId: alert.alertId, detectedAt: alert.detectedAt });
    alertsByInstrument.set(alert.instrumentId, instrumentAlerts);
  }

  const selected = new Set<string>();
  for (const instrumentAlerts of alertsByInstrument.values()) {
    instrumentAlerts.sort(compareAlerts);
    let nextIndependentAt = Number.NEGATIVE_INFINITY;

    for (const alert of instrumentAlerts) {
      if (alert.detectedAt < nextIndependentAt) {
        continue;
      }
      selected.add(alert.alertId);
      const next = alert.detectedAt + labelWindowMs;
      nextIndependentAt = Number.isSafeInteger(next)
        ? next
        : Number.POSITIVE_INFINITY;
    }
  }

  return selected;
};

/**
 * Counts deterministic, non-overlapping label windows per instrument.
 *
 * Alerts whose maximum configured outcome window overlaps a previously
 * accepted alert from the same instrument are dependent observations. They
 * remain in the dataset, but cannot satisfy the minimum independent-sample
 * requirement used for final evaluation readiness.
 */
export const measureEvidenceIndependence = (
  alerts: readonly EvidenceAlertIdentity[],
  horizonsMinutes: readonly number[],
): EvidenceIndependenceMetrics => {
  const maximumOutcomeHorizonMinutes = Math.max(...horizonsMinutes);
  const selected = selectIndependentEvidenceAlertIds(alerts, horizonsMinutes);

  return Object.freeze({
    maximumOutcomeHorizonMinutes,
    independentAlertCount: selected.size,
    dependentAlertCount: alerts.length - selected.size,
  });
};
