import {
  createTargetStopPolicy,
  generatePathOutcomeRecords,
  generateTargetStopOutcomeRecords,
  type AlertTargetStopOutcomeRecord,
  type TargetStopPolicyV1,
} from '../../src/evaluation';
import { PATH_OUTCOME_NOW, createPathFixture } from './pathOutcomeFixtures';

export const createTargetStopFixture = (
  options: Parameters<typeof createPathFixture>[0] = {},
): ReturnType<typeof createPathFixture> & {
  pathOutcome: ReturnType<typeof generatePathOutcomeRecords>[number];
} => {
  const fixture = createPathFixture(options);
  const pathOutcome = generatePathOutcomeRecords({
    evaluations: [fixture.evaluation],
    terminalReturns: [fixture.terminalReturn],
    marketRecording: fixture.marketRecording,
    pathOutcomeRunId: 'path-outcome-run:target-stop-fixture',
    now: PATH_OUTCOME_NOW,
  })[0]!;
  return { ...fixture, pathOutcome };
};

export const generateTargetStopFixtureRecord = (
  fixture = createTargetStopFixture(),
  policy: TargetStopPolicyV1 = createTargetStopPolicy({
    targetPercent: 1,
    stopPercent: 1,
  }),
  overrides: Partial<
    Parameters<typeof generateTargetStopOutcomeRecords>[0]
  > = {},
): AlertTargetStopOutcomeRecord =>
  generateTargetStopOutcomeRecords({
    evaluations: [fixture.evaluation],
    terminalReturns: [fixture.terminalReturn],
    pathOutcomes: [fixture.pathOutcome],
    marketRecording: fixture.marketRecording,
    policy,
    targetStopRunId: 'target-stop-run:test',
    now: PATH_OUTCOME_NOW,
    ...overrides,
  })[0]!;
