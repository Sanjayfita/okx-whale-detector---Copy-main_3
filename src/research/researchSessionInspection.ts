import { access } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import type {
  ResearchSessionArtifactReference,
  ResearchSessionManifest,
} from './researchSessionManifest';

export interface ResearchSessionArtifactInspection {
  artifact: ResearchSessionArtifactReference;
  resolvedPath: string;
  exists: boolean;
}

export interface ResearchSessionInspection {
  manifestPath: string;
  manifest: ResearchSessionManifest;
  artifacts: readonly ResearchSessionArtifactInspection[];
  existingArtifactCount: number;
  missingArtifactCount: number;
  complete: boolean;
}

const artifactPath = (manifestPath: string, path: string): string =>
  isAbsolute(path) ? path : resolve(dirname(manifestPath), path);

export const inspectResearchSession = async (input: {
  manifestPath: string;
  manifest: ResearchSessionManifest;
  fileExists?: (path: string) => Promise<boolean>;
}): Promise<ResearchSessionInspection> => {
  const fileExists =
    input.fileExists ??
    (async (path: string): Promise<boolean> => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    });

  const artifacts = await Promise.all(
    input.manifest.artifacts.map(async (artifact) => {
      const resolvedPath = artifactPath(input.manifestPath, artifact.path);
      return Object.freeze({
        artifact,
        resolvedPath,
        exists: await fileExists(resolvedPath),
      });
    }),
  );

  const existingArtifactCount = artifacts.filter((entry) => entry.exists).length;
  const missingArtifactCount = artifacts.length - existingArtifactCount;

  return Object.freeze({
    manifestPath: resolve(input.manifestPath),
    manifest: input.manifest,
    artifacts: Object.freeze(artifacts),
    existingArtifactCount,
    missingArtifactCount,
    complete: input.manifest.status === 'COMPLETED' && missingArtifactCount === 0,
  });
};
