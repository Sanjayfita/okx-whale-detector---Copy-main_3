import { describe, expect, it } from 'vitest';

import { BehaviorTransitionTracker } from '../src/core/BehaviorTransitionTracker';

import type { Whale } from '../src/types/whale';

import type {
  WhaleBehavior,
  WhaleBehaviorType,
} from '../src/core/WhaleBehaviorEngine';

const createWhale = (overrides: Partial<Whale> = {}): Whale => ({
  wallId: 'wall-1',
  side: 'ASK',

  price: 100.01,

  size: 10_000,

  notionalQuote: 1_010_000,

  quoteCurrency: 'USDT',

  detectedAt: 1_000,

  firstSeenAt: 1_000,

  lastSeenAt: 1_000,

  ageSeconds: 30,

  updateCount: 1,

  maxNotionalQuote: 1_010_000,

  ...overrides,
});

const createBehavior = (
  whale: Whale,
  type: WhaleBehaviorType,
  confidence: number = 80,
): WhaleBehavior => ({
  type,
  whale,
  confidence,

  reason: `${type} test behavior`,

  detectedAt: 1_000,
});

describe('BehaviorTransitionTracker', () => {
  it('returns a behavior when it first appears', () => {
    const tracker = new BehaviorTransitionTracker();

    const whale = createWhale();

    const persistent = createBehavior(whale, 'PERSISTENT');

    expect(tracker.getEnteredBehaviors(whale, [persistent])).toEqual([
      persistent,
    ]);
  });

  it('does not return the same behavior repeatedly', () => {
    const tracker = new BehaviorTransitionTracker();

    const whale = createWhale();

    tracker.getEnteredBehaviors(whale, [
      createBehavior(whale, 'PERSISTENT', 80),
    ]);

    const secondResult = tracker.getEnteredBehaviors(whale, [
      createBehavior(whale, 'PERSISTENT', 95),
    ]);

    expect(secondResult).toEqual([]);
  });

  it('reuses one immutable empty result for empty and unchanged behavior sets', () => {
    const tracker = new BehaviorTransitionTracker();
    const whale = createWhale();
    const emptyResult = tracker.getEnteredBehaviors(whale, []);

    tracker.getEnteredBehaviors(whale, [createBehavior(whale, 'PERSISTENT')]);

    const unchangedResult = tracker.getEnteredBehaviors(whale, [
      createBehavior(whale, 'PERSISTENT', 95),
    ]);

    expect(emptyResult).toBe(unchangedResult);
    expect(Object.isFrozen(emptyResult)).toBe(true);
  });

  it('returns only the newly added behavior', () => {
    const tracker = new BehaviorTransitionTracker();

    const whale = createWhale();

    tracker.getEnteredBehaviors(whale, [createBehavior(whale, 'PERSISTENT')]);

    const entered = tracker.getEnteredBehaviors(whale, [
      createBehavior(whale, 'PERSISTENT'),

      createBehavior(whale, 'DISTRIBUTION'),
    ]);

    expect(entered.map((behavior) => behavior.type)).toEqual(['DISTRIBUTION']);
  });

  it('returns newly entered behavior objects in their input order', () => {
    const tracker = new BehaviorTransitionTracker();
    const whale = createWhale();
    const distribution = createBehavior(whale, 'DISTRIBUTION');
    const absorption = createBehavior(whale, 'ABSORPTION');

    const entered = tracker.getEnteredBehaviors(whale, [
      distribution,
      absorption,
    ]);

    expect(entered).toEqual([distribution, absorption]);
    expect(entered[0]).toBe(distribution);
    expect(entered[1]).toBe(absorption);
  });

  it('preserves duplicate behavior semantics for new and existing types', () => {
    const tracker = new BehaviorTransitionTracker();
    const whale = createWhale();
    const first = createBehavior(whale, 'PERSISTENT', 80);
    const duplicate = createBehavior(whale, 'PERSISTENT', 95);

    const initiallyEntered = tracker.getEnteredBehaviors(whale, [
      first,
      duplicate,
    ]);
    const alreadyActive = tracker.getEnteredBehaviors(whale, [
      duplicate,
      first,
    ]);

    expect(initiallyEntered).toEqual([first, duplicate]);
    expect(alreadyActive).toEqual([]);
  });

  it('removes missing types while retaining other active types', () => {
    const tracker = new BehaviorTransitionTracker();
    const whale = createWhale();

    tracker.getEnteredBehaviors(whale, [
      createBehavior(whale, 'PERSISTENT'),
      createBehavior(whale, 'DISTRIBUTION'),
    ]);
    tracker.getEnteredBehaviors(whale, [createBehavior(whale, 'PERSISTENT')]);

    const returned = tracker.getEnteredBehaviors(whale, [
      createBehavior(whale, 'PERSISTENT'),
      createBehavior(whale, 'DISTRIBUTION'),
    ]);

    expect(returned.map((behavior) => behavior.type)).toEqual(['DISTRIBUTION']);
  });

  it('does not re-emit behavior when the same wall moves', () => {
    const tracker = new BehaviorTransitionTracker();

    const before = createWhale({
      price: 100.02,
    });

    const after = createWhale({
      price: 100.01,
    });

    tracker.getEnteredBehaviors(before, [createBehavior(before, 'PERSISTENT')]);

    const entered = tracker.getEnteredBehaviors(after, [
      createBehavior(after, 'PERSISTENT'),
    ]);

    expect(entered).toEqual([]);
  });

  it('emits a behavior again after it disappears and later returns', () => {
    const tracker = new BehaviorTransitionTracker();

    const whale = createWhale();

    tracker.getEnteredBehaviors(whale, [createBehavior(whale, 'PERSISTENT')]);

    tracker.getEnteredBehaviors(whale, []);

    const returned = tracker.getEnteredBehaviors(whale, [
      createBehavior(whale, 'PERSISTENT'),
    ]);

    expect(returned.map((behavior) => behavior.type)).toEqual(['PERSISTENT']);
  });

  it('tracks different whales independently', () => {
    const tracker = new BehaviorTransitionTracker();

    const firstWhale = createWhale({
      wallId: 'wall-1',
      price: 101,
    });

    const secondWhale = createWhale({
      wallId: 'wall-2',
      price: 102,
    });

    tracker.getEnteredBehaviors(firstWhale, [
      createBehavior(firstWhale, 'PERSISTENT'),
    ]);

    const secondResult = tracker.getEnteredBehaviors(secondWhale, [
      createBehavior(secondWhale, 'PERSISTENT'),
    ]);

    expect(secondResult.map((behavior) => behavior.type)).toEqual([
      'PERSISTENT',
    ]);
  });

  it('allows behavior output again after the whale is pruned', () => {
    const tracker = new BehaviorTransitionTracker();

    const whale = createWhale();

    tracker.getEnteredBehaviors(whale, [createBehavior(whale, 'PERSISTENT')]);

    tracker.prune([]);

    const returned = tracker.getEnteredBehaviors(whale, [
      createBehavior(whale, 'PERSISTENT'),
    ]);

    expect(returned.map((behavior) => behavior.type)).toEqual(['PERSISTENT']);
  });

  it('clears all transition history on reset', () => {
    const tracker = new BehaviorTransitionTracker();

    const whale = createWhale();

    tracker.getEnteredBehaviors(whale, [createBehavior(whale, 'PERSISTENT')]);

    tracker.reset();

    const entered = tracker.getEnteredBehaviors(whale, [
      createBehavior(whale, 'PERSISTENT'),
    ]);

    expect(entered.map((behavior) => behavior.type)).toEqual(['PERSISTENT']);
  });
});
