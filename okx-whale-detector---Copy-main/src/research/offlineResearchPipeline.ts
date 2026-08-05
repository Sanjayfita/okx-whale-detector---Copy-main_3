import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  createResearchSessionManifest,
  type ResearchSessionArtifactReference,
  type ResearchSessionManifest,
  writeResearchSessionManifest,
} from './researchSessionManifest';

export interface OfflineResearchPipelineStep {
  id: string;
  command: string;
  args: readonly string[];
  artifacts: readonly ResearchSessionArtifactReference[];
}

export interface OfflineResearchPipelinePlan {
  sessionId: string;
  createdAt: number;
  instrumentIds: readonly string[];
  notes?: string | null;
  manifestPath: string;
  steps: readonly OfflineResearchPipelineStep[];
}

export interface OfflineResearchPipelineStepResult {
  id: string;
  command: string;
  args: readonly string[];
  exitCode: number;
}

export interface OfflineResearchPipelineResult {
  manifest: ResearchSessionManifest;
  stepResults: readonly OfflineResearchPipelineStepResult[];
}

export type OfflineResearchCommandRunner = (input: {
  command: string;
  args: readonly string[];
}) => Promise<number>;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

const assertPlan = (plan: OfflineResearchPipelinePlan): void => {
  if (!IDENTIFIER_PATTERN.test(plan.sessionId)) {
    throw new Error('sessionId must be a valid durable identifier');
  }
  if (!Number.isSafeInteger(plan.createdAt) || plan.createdAt < 0) {
    throw new Error('createdAt must be a non-negative safe integer');
  }
  if (!Array.isArray(plan.instrumentIds) || plan.instrumentIds.length === 0) {
    throw new Error('instrumentIds must contain at least one instrument');
  }
  if (typeof plan.manifestPath !== 'string' || plan.manifestPath.trim() === '') {
    throw new Error('manifestPath must be a non-empty string');
  }
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    throw new Error('steps must contain at least one pipeline step');
  }
  const ids = new Set<string>();
  plan.steps.forEach((step, index) => {
    if (!IDENTIFIER_PATTERN.test(step.id)) throw new Error(`steps[${index}].id is invalid`);
    if (ids.has(step.id)) throw new Error(`Duplicate pipeline step id: ${step.id}`);
    ids.add(step.id);
    if (typeof step.command !== 'string' || step.command.trim() === '') {
      throw new Error(`steps[${index}].command must be non-empty`);
    }
    if (!Array.isArray(step.args) || step.args.some((arg: unknown) => typeof arg !== 'string')) {
      throw new Error(`steps[${index}].args must be an array of strings`);
    }
    if (!Array.isArray(step.artifacts)) {
      throw new Error(`steps[${index}].artifacts must be an array`);
    }
  });
};

export const readOfflineResearchPipelinePlan = async (
  filePath: string,
): Promise<OfflineResearchPipelinePlan> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Unable to read offline research pipeline plan: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const plan = parsed as OfflineResearchPipelinePlan;
  assertPlan(plan);
  return plan;
};

export const runOfflineResearchPipeline = async (input: {
  plan: OfflineResearchPipelinePlan;
  runCommand: OfflineResearchCommandRunner;
  now?: () => number;
}): Promise<OfflineResearchPipelineResult> => {
  assertPlan(input.plan);
  const now = input.now ?? Date.now;
  const manifestPath = resolve(input.plan.manifestPath);
  await mkdir(dirname(manifestPath), { recursive: true });

  await writeResearchSessionManifest(
    manifestPath,
    createResearchSessionManifest({
      sessionId: input.plan.sessionId,
      createdAt: input.plan.createdAt,
      updatedAt: input.plan.createdAt,
      status: 'RUNNING',
      instrumentIds: input.plan.instrumentIds,
      notes: input.plan.notes,
      artifacts: [],
    }),
  );

  const artifacts: ResearchSessionArtifactReference[] = [];
  const stepResults: OfflineResearchPipelineStepResult[] = [];

  try {
    for (const step of input.plan.steps) {
      const exitCode = await input.runCommand({ command: step.command, args: step.args });
      stepResults.push(
        Object.freeze({
          id: step.id,
          command: step.command,
          args: Object.freeze([...step.args]),
          exitCode,
        }),
      );
      if (exitCode !== 0) {
        throw new Error(`Pipeline step ${step.id} failed with exit code ${exitCode}`);
      }
      artifacts.push(...step.artifacts);
    }

    const manifest = createResearchSessionManifest({
      sessionId: input.plan.sessionId,
      createdAt: input.plan.createdAt,
      updatedAt: now(),
      status: 'COMPLETED',
      instrumentIds: input.plan.instrumentIds,
      notes: input.plan.notes,
      artifacts,
    });
    await writeResearchSessionManifest(manifestPath, manifest);
    return Object.freeze({ manifest, stepResults: Object.freeze(stepResults) });
  } catch (error) {
    await writeResearchSessionManifest(
      manifestPath,
      createResearchSessionManifest({
        sessionId: input.plan.sessionId,
        createdAt: input.plan.createdAt,
        updatedAt: now(),
        status: 'FAILED',
        instrumentIds: input.plan.instrumentIds,
        notes: input.plan.notes,
        artifacts,
      }),
    );
    throw error;
  }
};
