import type { Whale } from '../types/whale';

import type { WhaleBehavior, WhaleBehaviorType } from './WhaleBehaviorEngine';

const EMPTY_ENTERED_BEHAVIORS: readonly WhaleBehavior[] = Object.freeze([]);

export class BehaviorTransitionTracker {
  private readonly activeBehaviors = new Map<string, Set<WhaleBehaviorType>>();
  private readonly currentTypesScratch = new Set<WhaleBehaviorType>();

  public getEnteredBehaviors(
    whale: Whale,
    currentBehaviors: readonly WhaleBehavior[],
  ): readonly WhaleBehavior[] {
    const whaleKey = this.getWhaleKey(whale);

    if (currentBehaviors.length === 0) {
      this.activeBehaviors.delete(whaleKey);

      return EMPTY_ENTERED_BEHAVIORS;
    }

    const previousTypes = this.activeBehaviors.get(whaleKey);
    const currentTypes = this.currentTypesScratch;

    currentTypes.clear();

    let enteredBehaviors: WhaleBehavior[] | undefined;
    let hasNewType = previousTypes === undefined;

    for (const behavior of currentBehaviors) {
      currentTypes.add(behavior.type);

      if (!previousTypes?.has(behavior.type)) {
        hasNewType = true;
        enteredBehaviors ??= [];
        enteredBehaviors.push(behavior);
      }
    }

    if (
      previousTypes === undefined ||
      hasNewType ||
      previousTypes.size !== currentTypes.size
    ) {
      this.activeBehaviors.set(whaleKey, new Set(currentTypes));
    }

    return enteredBehaviors ?? EMPTY_ENTERED_BEHAVIORS;
  }

  public prune(activeWhales: Whale[]): void {
    const activeKeys = new Set(
      activeWhales.map((whale) => this.getWhaleKey(whale)),
    );

    for (const key of this.activeBehaviors.keys()) {
      if (!activeKeys.has(key)) {
        this.activeBehaviors.delete(key);
      }
    }
  }

  public reset(): void {
    this.activeBehaviors.clear();
    this.currentTypesScratch.clear();
  }

  private getWhaleKey(whale: Whale): string {
    return whale.wallId;
  }
}
