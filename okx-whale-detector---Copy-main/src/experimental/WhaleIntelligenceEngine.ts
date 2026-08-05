import type { Whale } from '../types/whale';

import type { WhaleIntelligenceResult } from '../types/whale-intelligence';

import { WhaleEventDetector } from '../core/WhaleEventDetector';

export class WhaleIntelligenceEngine {
  private eventDetector = new WhaleEventDetector();

  public analyze(currentWhales: Whale[]): WhaleIntelligenceResult {
    const events = this.eventDetector.detect(currentWhales);

    const newWhales = events
      .filter((event) => event.type === 'NEW')
      .map((event) => event.whale);

    const removedWhales = events
      .filter((event) => event.type === 'REMOVED')
      .map((event) => event.whale);

    const increasedWhales = events
      .filter((event) => event.type === 'INCREASED')
      .map((event) => event.whale);

    const decreasedWhales = events
      .filter((event) => event.type === 'DECREASED')
      .map((event) => event.whale);

    const persistentWhales = currentWhales.filter(
      (whale) => (whale.ageSeconds ?? 0) >= 60,
    );

    const strongWhales = currentWhales.filter(
      (whale) => (whale.ageSeconds ?? 0) >= 120,
    );

    return {
      activeWhales: currentWhales,

      newWhales,
      removedWhales,

      increasedWhales,
      decreasedWhales,

      persistentWhales,
      strongWhales,
    };
  }
}
