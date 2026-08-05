export interface AutonomousCandidateEvidence {
  readonly candidateId: string;
  readonly candidateFingerprint: string;
  readonly experimentCompleted: boolean;
  readonly dataQualityPassed: boolean;
  readonly splitIntegrityPassed: boolean;
  readonly robustnessPassed: boolean;
  readonly scenarioCount: number;
  readonly completedScenarioCount: number;
  readonly independentEpisodeCount: number;
  readonly tradeCount: number;
  readonly expectancyConfidenceLower: number | null;
  readonly adjustedPValue: number | null;
  readonly profitFactor: number | null;
  readonly maximumDrawdownFraction: number | null;
  readonly expectedShortfallReturnFraction: number | null;
  readonly probabilityOfRuin: number | null;
  readonly hypothesisFamilySize: number;
  readonly complexityUnits: number;
}

export interface AutonomousRankingPolicy {
  readonly minimumIndependentEpisodes: number;
  readonly minimumTrades: number;
  readonly maximumAdjustedPValue: number;
  readonly maximumDrawdownFraction: number;
  readonly maximumProbabilityOfRuin: number;
  readonly drawdownPenalty: number;
  readonly tailLossPenalty: number;
  readonly ruinPenalty: number;
  readonly complexityPenalty: number;
  readonly hypothesisPenalty: number;
}

export const DEFAULT_AUTONOMOUS_RANKING_POLICY: AutonomousRankingPolicy = {
  minimumIndependentEpisodes: 100,
  minimumTrades: 100,
  maximumAdjustedPValue: 0.05,
  maximumDrawdownFraction: 0.2,
  maximumProbabilityOfRuin: 0.01,
  drawdownPenalty: 2,
  tailLossPenalty: 2,
  ruinPenalty: 5,
  complexityPenalty: 0.05,
  hypothesisPenalty: 0.1,
};

export interface AutonomousResearchRankingRow {
  readonly candidateId: string;
  readonly candidateFingerprint: string;
  readonly researchPriorityRank: number | null;
  readonly conservativeResearchScore: number | null;
  readonly evidenceStatus:
    | 'REPLICATION_PRIORITY'
    | 'EXPLORATORY_ONLY'
    | 'BLOCKED';
  readonly blockingReasons: readonly string[];
  readonly independentEpisodeCount: number;
  readonly tradeCount: number;
  readonly hypothesisFamilySize: number;
  readonly complexityUnits: number;
  readonly discoveryEvidenceOnly: true;
  readonly strategyPromotionAllowed: false;
  readonly liveExecutionAllowed: false;
}

export interface AutonomousResearchRankingReport {
  readonly candidateCount: number;
  readonly rankedCount: number;
  readonly replicationPriorityCount: number;
  readonly blockedCount: number;
  readonly rows: readonly AutonomousResearchRankingRow[];
  readonly strategyPromotionAllowed: false;
  readonly liveExecutionAllowed: false;
}

const validatePolicy = (policy: AutonomousRankingPolicy): void => {
  if (
    !Number.isSafeInteger(policy.minimumIndependentEpisodes) ||
    policy.minimumIndependentEpisodes <= 0 ||
    !Number.isSafeInteger(policy.minimumTrades) ||
    policy.minimumTrades <= 0 ||
    policy.maximumAdjustedPValue <= 0 ||
    policy.maximumAdjustedPValue >= 1 ||
    policy.maximumDrawdownFraction <= 0 ||
    policy.maximumDrawdownFraction >= 1 ||
    policy.maximumProbabilityOfRuin < 0 ||
    policy.maximumProbabilityOfRuin >= 1
  ) {
    throw new Error('invalid autonomous ranking policy');
  }
  for (const [name, value] of Object.entries(policy)) {
    if (name.endsWith('Penalty') && (!Number.isFinite(value) || value < 0)) {
      throw new Error(`${name} must be finite and non-negative`);
    }
  }
};

const requireFiniteNullable = (value: number | null, name: string): void => {
  if (value !== null && !Number.isFinite(value)) {
    throw new Error(`${name} must be finite when present`);
  }
};

const requireProbabilityNullable = (
  value: number | null,
  name: string,
): void => {
  requireFiniteNullable(value, name);
  if (value !== null && (value < 0 || value > 1)) {
    throw new Error(`${name} must be between zero and one`);
  }
};

export const rankAutonomousResearchCandidates = (input: {
  readonly candidates: readonly AutonomousCandidateEvidence[];
  readonly policy?: Partial<AutonomousRankingPolicy>;
}): AutonomousResearchRankingReport => {
  const policy: AutonomousRankingPolicy = {
    ...DEFAULT_AUTONOMOUS_RANKING_POLICY,
    ...input.policy,
  };
  validatePolicy(policy);
  const candidateIds = input.candidates.map((candidate) => candidate.candidateId);
  const candidateFingerprints = input.candidates.map(
    (candidate) => candidate.candidateFingerprint,
  );
  if (
    new Set(candidateIds).size !== candidateIds.length ||
    new Set(candidateFingerprints).size !== candidateFingerprints.length
  ) {
    throw new Error('candidate IDs and fingerprints must be unique');
  }

  const provisional = input.candidates.map((candidate) => {
    if (
      candidate.candidateId.trim().length === 0 ||
      candidate.candidateFingerprint.trim().length === 0
    ) {
      throw new Error('candidate identity must not be empty');
    }
    for (const [name, value] of [
      ['scenarioCount', candidate.scenarioCount],
      ['completedScenarioCount', candidate.completedScenarioCount],
      ['independentEpisodeCount', candidate.independentEpisodeCount],
      ['tradeCount', candidate.tradeCount],
      ['hypothesisFamilySize', candidate.hypothesisFamilySize],
      ['complexityUnits', candidate.complexityUnits],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${name} must be a non-negative safe integer`);
      }
    }
    if (candidate.completedScenarioCount > candidate.scenarioCount) {
      throw new Error('completedScenarioCount cannot exceed scenarioCount');
    }
    if (candidate.hypothesisFamilySize <= 0) {
      throw new Error('hypothesisFamilySize must be positive');
    }
    if (candidate.complexityUnits <= 0) {
      throw new Error('complexityUnits must be positive');
    }
    requireFiniteNullable(
      candidate.expectancyConfidenceLower,
      'expectancyConfidenceLower',
    );
    requireProbabilityNullable(candidate.adjustedPValue, 'adjustedPValue');
    requireFiniteNullable(candidate.profitFactor, 'profitFactor');
    if (candidate.profitFactor !== null && candidate.profitFactor < 0) {
      throw new Error('profitFactor must be non-negative');
    }
    requireProbabilityNullable(
      candidate.maximumDrawdownFraction,
      'maximumDrawdownFraction',
    );
    requireFiniteNullable(
      candidate.expectedShortfallReturnFraction,
      'expectedShortfallReturnFraction',
    );
    requireProbabilityNullable(candidate.probabilityOfRuin, 'probabilityOfRuin');

    const blockingReasons: string[] = [];
    if (!candidate.experimentCompleted) blockingReasons.push('EXPERIMENT_INCOMPLETE');
    if (!candidate.dataQualityPassed) blockingReasons.push('DATA_QUALITY_FAILED');
    if (!candidate.splitIntegrityPassed) blockingReasons.push('SPLIT_INTEGRITY_FAILED');
    if (candidate.scenarioCount <= 0) blockingReasons.push('NO_REQUIRED_SCENARIOS');
    if (candidate.completedScenarioCount !== candidate.scenarioCount) {
      blockingReasons.push('SCENARIO_MATRIX_INCOMPLETE');
    }
    if (candidate.independentEpisodeCount < policy.minimumIndependentEpisodes) {
      blockingReasons.push('INSUFFICIENT_INDEPENDENT_EPISODES');
    }
    if (candidate.tradeCount < policy.minimumTrades) {
      blockingReasons.push('INSUFFICIENT_TRADES');
    }
    if (
      candidate.expectancyConfidenceLower === null ||
      candidate.adjustedPValue === null ||
      candidate.profitFactor === null ||
      candidate.maximumDrawdownFraction === null ||
      candidate.expectedShortfallReturnFraction === null ||
      candidate.probabilityOfRuin === null
    ) {
      blockingReasons.push('INCOMPLETE_STATISTICAL_OR_TAIL_EVIDENCE');
    }
    const structurallyRankable = blockingReasons.length === 0;
    const conservativeResearchScore = structurallyRankable
      ? (candidate.expectancyConfidenceLower ?? 0) * 100 +
        Math.log(Math.max(candidate.profitFactor ?? 0.01, 0.01)) -
        policy.drawdownPenalty * (candidate.maximumDrawdownFraction ?? 1) -
        policy.tailLossPenalty *
          Math.max(0, -(candidate.expectedShortfallReturnFraction ?? -1)) -
        policy.ruinPenalty * (candidate.probabilityOfRuin ?? 1) -
        policy.complexityPenalty * candidate.complexityUnits -
        policy.hypothesisPenalty * Math.log1p(candidate.hypothesisFamilySize)
      : null;
    const replicationPriority =
      structurallyRankable &&
      candidate.robustnessPassed &&
      (candidate.expectancyConfidenceLower ?? 0) > 0 &&
      (candidate.adjustedPValue ?? 1) <= policy.maximumAdjustedPValue &&
      (candidate.maximumDrawdownFraction ?? 1) <=
        policy.maximumDrawdownFraction &&
      (candidate.probabilityOfRuin ?? 1) <= policy.maximumProbabilityOfRuin;
    return {
      candidate,
      blockingReasons,
      conservativeResearchScore,
      evidenceStatus: !structurallyRankable
        ? ('BLOCKED' as const)
        : replicationPriority
          ? ('REPLICATION_PRIORITY' as const)
          : ('EXPLORATORY_ONLY' as const),
    };
  });

  const ranked = provisional
    .filter((entry) => entry.conservativeResearchScore !== null)
    .sort(
      (left, right) =>
        (right.conservativeResearchScore ?? Number.NEGATIVE_INFINITY) -
          (left.conservativeResearchScore ?? Number.NEGATIVE_INFINITY) ||
        left.candidate.candidateFingerprint.localeCompare(
          right.candidate.candidateFingerprint,
        ),
    );
  const rankByFingerprint = new Map(
    ranked.map((entry, index) => [
      entry.candidate.candidateFingerprint,
      index + 1,
    ] as const),
  );
  const rows = provisional
    .map((entry): AutonomousResearchRankingRow => ({
      candidateId: entry.candidate.candidateId,
      candidateFingerprint: entry.candidate.candidateFingerprint,
      researchPriorityRank:
        rankByFingerprint.get(entry.candidate.candidateFingerprint) ?? null,
      conservativeResearchScore: entry.conservativeResearchScore,
      evidenceStatus: entry.evidenceStatus,
      blockingReasons: entry.blockingReasons,
      independentEpisodeCount: entry.candidate.independentEpisodeCount,
      tradeCount: entry.candidate.tradeCount,
      hypothesisFamilySize: entry.candidate.hypothesisFamilySize,
      complexityUnits: entry.candidate.complexityUnits,
      discoveryEvidenceOnly: true,
      strategyPromotionAllowed: false,
      liveExecutionAllowed: false,
    }))
    .sort((left, right) => {
      if (left.researchPriorityRank === null && right.researchPriorityRank !== null) {
        return 1;
      }
      if (left.researchPriorityRank !== null && right.researchPriorityRank === null) {
        return -1;
      }
      return (
        (left.researchPriorityRank ?? 0) - (right.researchPriorityRank ?? 0) ||
        left.candidateFingerprint.localeCompare(right.candidateFingerprint)
      );
    });
  return {
    candidateCount: rows.length,
    rankedCount: ranked.length,
    replicationPriorityCount: rows.filter(
      (row) => row.evidenceStatus === 'REPLICATION_PRIORITY',
    ).length,
    blockedCount: rows.filter((row) => row.evidenceStatus === 'BLOCKED').length,
    rows,
    strategyPromotionAllowed: false,
    liveExecutionAllowed: false,
  };
};
