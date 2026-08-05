import { ExternalSignalCorrelationEngine } from '../core/ExternalSignalCorrelationEngine';
import { ExternalSignalRelevanceEngine } from '../core/ExternalSignalRelevanceEngine';
import { ExternalSignalStore } from '../core/ExternalSignalStore';
import type { CorrelatedMarketSignal } from '../core/ExternalSignalCorrelationEngine';
import type { SyntheticExternalScenario } from './SyntheticExternalScenarios';

export interface SyntheticScenarioRunReport {
  name: string;
  description: string;
  symbol: string;
  rawSignals: number;
  deduplicatedSignals: number;
  mergedSignals: number;
  evidenceProviders: string[];
  correlation: CorrelatedMarketSignal;
}

export const runSyntheticExternalScenario = (
  scenario: SyntheticExternalScenario,
): SyntheticScenarioRunReport => {
  const store = new ExternalSignalStore();
  const relevanceEngine = new ExternalSignalRelevanceEngine();
  const correlationEngine = new ExternalSignalCorrelationEngine();
  let mergedSignals = 0;

  for (const signal of scenario.signals) {
    const result = store.add(signal, scenario.now);
    if (result.merged) {
      mergedSignals += 1;
    }
  }

  const storedSignals = store.getAll(scenario.now);
  const effectiveSignals = storedSignals.map((signal) =>
    relevanceEngine.evaluate(signal, scenario.symbol, scenario.now),
  );
  const correlation = correlationEngine.correlate(
    scenario.symbol,
    scenario.okxSignal,
    effectiveSignals,
    scenario.now,
  );
  const evidenceProviders = [
    ...new Set(
      storedSignals.flatMap((signal) =>
        signal.evidence.map((evidence) => evidence.provider),
      ),
    ),
  ].sort();

  return {
    name: scenario.name,
    description: scenario.description,
    symbol: scenario.symbol,
    rawSignals: scenario.signals.length,
    deduplicatedSignals: storedSignals.length,
    mergedSignals,
    evidenceProviders,
    correlation,
  };
};
