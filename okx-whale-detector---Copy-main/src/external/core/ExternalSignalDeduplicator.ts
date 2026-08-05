import type {
  ExternalSignalEvidence,
  ExternalWhaleSignal,
} from '../types/ExternalWhaleSignal';

const mergeEvidence = (
  existing: readonly ExternalSignalEvidence[],
  incoming: readonly ExternalSignalEvidence[],
): ExternalSignalEvidence[] => {
  const byProviderEvent = new Map<string, ExternalSignalEvidence>();

  for (const evidence of [...existing, ...incoming]) {
    const key = `${evidence.provider}:${evidence.providerEventId ?? ''}`;
    const current = byProviderEvent.get(key);

    if (!current || evidence.receivedAt < current.receivedAt) {
      byProviderEvent.set(key, evidence);
    }
  }

  return [...byProviderEvent.values()];
};

export class ExternalSignalDeduplicator {
  public merge(
    existing: ExternalWhaleSignal,
    incoming: ExternalWhaleSignal,
  ): ExternalWhaleSignal {
    if (existing.underlyingEventId !== incoming.underlyingEventId) {
      throw new Error('Cannot merge unrelated external whale signals');
    }

    const preferred =
      incoming.confidence > existing.confidence ? incoming : existing;

    return {
      ...preferred,
      id: existing.id,
      underlyingEventId: existing.underlyingEventId,
      occurredAt: Math.min(existing.occurredAt, incoming.occurredAt),
      receivedAt: Math.min(existing.receivedAt, incoming.receivedAt),
      confidence: Math.max(existing.confidence, incoming.confidence),
      evidence: mergeEvidence(existing.evidence, incoming.evidence),
    };
  }
}
