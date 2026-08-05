import type { Whale } from '../types/whale';

export type WhaleStrength = 'WEAK' | 'MODERATE' | 'STRONG' | 'VERY_STRONG';

export interface WhaleScore {
  whale: Whale;
  totalScore: number;
  strength: WhaleStrength;
  components: {
    sizeScore: number;
    distanceScore: number;
    persistenceScore: number;
    stabilityScore: number;
  };
  explanation: string[];
}

export interface WhaleScoreEngineConfig {
  maxScore: number;
  maxSizeScore: number;
  maxDistanceScore: number;
  maxPersistenceScore: number;
  maxStabilityScore: number;
  persistenceWindowMs: number;
  minimumScoredNotionalQuote: number;
  veryStrongThreshold: number;
  strongThreshold: number;
  moderateThreshold: number;
}

interface WhaleHistory {
  firstSeen: number;
  lastSeen: number;
  highestNotional: number;
  lowestNotional: number;
  lastPrice: number;
}

const DEFAULT_CONFIG: WhaleScoreEngineConfig = {
  maxScore: 100,
  maxSizeScore: 30,
  maxDistanceScore: 25,
  maxPersistenceScore: 25,
  maxStabilityScore: 20,
  persistenceWindowMs: 120_000,
  minimumScoredNotionalQuote: 500_000,
  veryStrongThreshold: 80,
  strongThreshold: 60,
  moderateThreshold: 35,
};

export class WhaleScoreEngine {
  private readonly config: WhaleScoreEngineConfig;
  private readonly history = new Map<string, WhaleHistory>();

  public constructor(config: Partial<WhaleScoreEngineConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }

  public prune(activeWhales: Whale[]): void {
    const activeKeys = new Set(activeWhales.map((whale) => this.getKey(whale)));

    for (const key of this.history.keys()) {
      if (!activeKeys.has(key)) {
        this.history.delete(key);
      }
    }
  }

  public score(whale: Whale, currentPrice: number): WhaleScore {
    const now = Date.now();
    const key = this.getKey(whale);
    let history = this.history.get(key);

    if (!history) {
      history = {
        firstSeen: now,
        lastSeen: now,
        highestNotional: whale.notionalQuote,
        lowestNotional: whale.notionalQuote,
        lastPrice: whale.price,
      };
      this.history.set(key, history);
    }

    history.lastSeen = now;
    history.highestNotional = Math.max(
      history.highestNotional,
      whale.notionalQuote,
    );
    history.lowestNotional = Math.min(
      history.lowestNotional,
      whale.notionalQuote,
    );

    const sizeScore = this.calculateSizeScore(whale.notionalQuote);
    const distanceScore = this.calculateDistanceScore(
      whale.price,
      currentPrice,
    );
    const ageMs = now - history.firstSeen;
    const persistenceScore =
      Math.min(ageMs / this.config.persistenceWindowMs, 1) *
      this.config.maxPersistenceScore;
    const stabilityScore = this.calculateStabilityScore(history);
    const rawScore =
      sizeScore + distanceScore + persistenceScore + stabilityScore;
    const totalScore = Math.min(Math.round(rawScore), this.config.maxScore);
    const strength = this.getStrength(totalScore);
    const explanation = this.buildExplanation(
      totalScore,
      sizeScore,
      distanceScore,
      persistenceScore,
      stabilityScore,
    );

    history.lastPrice = whale.price;

    return {
      whale,
      totalScore,
      strength,
      components: {
        sizeScore: Math.round(sizeScore),
        distanceScore: Math.round(distanceScore),
        persistenceScore: Math.round(persistenceScore),
        stabilityScore: Math.round(stabilityScore),
      },
      explanation,
    };
  }

  public scoreMany(whales: Whale[], currentPrice: number): WhaleScore[] {
    return whales.map((whale) => this.score(whale, currentPrice));
  }

  private calculateSizeScore(notionalQuote: number): number {
    const minimum = this.config.minimumScoredNotionalQuote;
    const score =
      Math.log10(Math.max(notionalQuote, minimum) / minimum) *
      this.config.maxSizeScore;

    return Math.min(score, this.config.maxSizeScore);
  }

  private calculateDistanceScore(
    whalePrice: number,
    currentPrice: number,
  ): number {
    const distancePercent =
      Math.abs((whalePrice - currentPrice) / currentPrice) * 100;
    const score = this.config.maxDistanceScore / (1 + distancePercent);

    return Math.min(score, this.config.maxDistanceScore);
  }

  private calculateStabilityScore(history: WhaleHistory): number {
    if (history.highestNotional === 0) {
      return 0;
    }

    const range = history.highestNotional - history.lowestNotional;
    const volatility = range / history.highestNotional;
    const stability = 1 - Math.min(volatility, 1);

    return stability * this.config.maxStabilityScore;
  }

  private getStrength(score: number): WhaleStrength {
    if (score >= this.config.veryStrongThreshold) {
      return 'VERY_STRONG';
    }

    if (score >= this.config.strongThreshold) {
      return 'STRONG';
    }

    if (score >= this.config.moderateThreshold) {
      return 'MODERATE';
    }

    return 'WEAK';
  }

  private buildExplanation(
    totalScore: number,
    sizeScore: number,
    distanceScore: number,
    persistenceScore: number,
    stabilityScore: number,
  ): string[] {
    const explanation: string[] = [];

    if (sizeScore >= 20) {
      explanation.push('Large order size');
    }

    if (distanceScore >= 20) {
      explanation.push('Close to market price');
    }

    if (persistenceScore >= 15) {
      explanation.push('Persistent order book presence');
    }

    if (stabilityScore >= 15) {
      explanation.push('Stable liquidity');
    }

    if (totalScore < this.config.moderateThreshold) {
      explanation.push('Low-confidence whale');
    }

    return explanation;
  }

  private getKey(whale: Whale): string {
    return whale.wallId;
  }

  public reset(): void {
    this.history.clear();
  }
}
