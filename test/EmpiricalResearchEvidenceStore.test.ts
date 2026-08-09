import { describe, expect, it } from 'vitest';

import { createResearchExperimentManifest } from '../src/research/ResearchExperimentManifest';
import { generateStrategyCandidates } from '../src/research/StrategyCandidateGenerator';
import { PostgresEmpiricalResearchEvidenceStore } from '../src/storage/EmpiricalResearchEvidenceStore';
import type {
  SqlConnection,
  SqlParameter,
  SqlPool,
  SqlQueryResult,
} from '../src/storage/PostgresResearchStore';

interface RecordedQuery {
  readonly text: string;
  readonly parameters: readonly SqlParameter[];
}

class RecordingConnection implements SqlConnection {
  public readonly queries: RecordedQuery[] = [];
  public released = false;

  public query<Row = Readonly<Record<string, unknown>>>(
    text: string,
    parameters: readonly SqlParameter[] = [],
  ): Promise<SqlQueryResult<Row>> {
    this.queries.push({ text, parameters });
    return Promise.resolve({ rows: [], rowCount: 1 });
  }

  public release(): void {
    this.released = true;
  }
}

class RecordingPool implements SqlPool {
  public readonly connection = new RecordingConnection();

  public query<Row = Readonly<Record<string, unknown>>>(
    _text: string,
    _parameters: readonly SqlParameter[] = [],
  ): Promise<SqlQueryResult<Row>> {
    return Promise.resolve({ rows: [], rowCount: 1 });
  }

  public connect(): Promise<SqlConnection> {
    return Promise.resolve(this.connection);
  }

  public end(): Promise<void> {
    return Promise.resolve();
  }
}

const quality = (sourceName: string) => ({
  sourceName,
  inputCount: 100,
  selectedCount: 90,
  excludedFutureObservationCount: 0,
  excludedUnavailableAtDecisionCount: 5,
  excludedOutsideLookbackCount: 5,
  latestObservedAt: 900,
  latestReceivedAt: 901,
  ageMs: 99,
  status: 'PASSED' as const,
  rejectionReasons: [],
});

const bundle = () => {
  const candidates = generateStrategyCandidates({
    strategyId: 'trend',
    strategyVersion: 1,
    hypothesisFamilyId: 'family-1',
    datasetFingerprint: 'discovery-fingerprint',
    codeCommit: 'commit-sha',
    configurationHash: 'configuration-hash',
    parameterSpace: { threshold: [0.3] },
    discoveryScope: 'PURGED_DISCOVERY',
    holdoutAccessed: false,
  });
  if (candidates.status !== 'GENERATED') {
    throw new Error('test candidate generation failed');
  }
  const manifest = createResearchExperimentManifest({
    experimentId: 'experiment-1',
    scope: 'PURGED_DISCOVERY',
    hypothesisFamilyId: 'family-1',
    strategyIds: ['trend'],
    featureNames: ['cvd'],
    discoveryDatasetFingerprint: 'discovery-fingerprint',
    holdoutDatasetFingerprint: 'holdout-fingerprint',
    codeCommit: 'commit-sha',
    configurationHash: 'configuration-hash',
    candidateFamilyFingerprint: candidates.familyFingerprint,
    candidateCount: candidates.candidates.length,
    hypothesisCount: candidates.effectiveHypothesisCount,
    splitAudit: {
      foldCount: 3,
      discoveryObservationCount: 100,
      holdoutObservationCount: 20,
      overlappingEpisodeCount: 0,
      holdoutPurgedObservationCount: 2,
      holdoutEmbargoedObservationCount: 1,
    },
    dataQuality: [quality('books'), quality('trades')],
    frozenAt: 1_000,
    startedAt: 1_100,
    completedAt: 2_000,
    holdoutAccessCount: 0,
    significanceMethod: 'PAIRED_BOOTSTRAP_AND_RANDOMIZATION',
    multiplicityMethod: 'HOLM_BONFERRONI',
  });
  return {
    manifest,
    candidates: candidates.candidates,
    statisticalEvidence: [
      {
        evidenceId: 'evidence-1',
        evidenceType: 'STRATEGY_COMPARISON' as const,
        hypothesisId: candidates.candidates[0]?.candidateId ?? 'candidate',
        independentPairCount: 100,
        meanDifference: 0.1,
        standardizedEffect: 0.2,
        confidenceLower: 0.01,
        confidenceUpper: 0.2,
        confidenceLevel: 0.95,
        probabilityOfImprovement: 0.97,
        rawPValue: 0.01,
        adjustedPValue: 0.02,
        multiplicityMethod: 'HOLM_BONFERRONI' as const,
        hypothesisFamilySize: 1,
        status: 'PASSED' as const,
        rejectionReasons: [],
        liveExecutionAllowed: false as const,
      },
    ],
  };
};

describe('PostgresEmpiricalResearchEvidenceStore', () => {
  it('persists manifests, source quality, candidates and evidence atomically', async () => {
    const pool = new RecordingPool();
    const store = new PostgresEmpiricalResearchEvidenceStore(pool);

    await store.saveBundle(bundle());

    expect(pool.connection.queries.map((query) => query.text)).toEqual([
      'BEGIN',
      expect.stringContaining('research.research_experiment_manifests'),
      expect.stringContaining('research.research_data_quality_assessments'),
      expect.stringContaining('research.research_data_quality_assessments'),
      expect.stringContaining('research.strategy_candidate_specifications'),
      expect.stringContaining('research.statistical_evidence_runs'),
      'COMMIT',
    ]);
    expect(pool.connection.queries[1]?.parameters).toHaveLength(24);
    expect(pool.connection.released).toBe(true);
  });

  it('rejects candidates from a different hypothesis family before opening a transaction', async () => {
    const pool = new RecordingPool();
    const store = new PostgresEmpiricalResearchEvidenceStore(pool);
    const input = bundle();

    await expect(
      store.saveBundle({
        ...input,
        candidates: input.candidates.map((candidate) => ({
          ...candidate,
          hypothesisFamilyId: 'different-family',
        })),
      }),
    ).rejects.toThrow('conflicts with manifest');
    expect(pool.connection.queries).toEqual([]);
  });
});
