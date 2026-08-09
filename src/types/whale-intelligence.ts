import type { Whale } from './whale';

export interface WhaleIntelligenceResult {
  activeWhales: Whale[];

  newWhales: Whale[];
  removedWhales: Whale[];

  increasedWhales: Whale[];
  decreasedWhales: Whale[];

  persistentWhales: Whale[];
  strongWhales: Whale[];
}
