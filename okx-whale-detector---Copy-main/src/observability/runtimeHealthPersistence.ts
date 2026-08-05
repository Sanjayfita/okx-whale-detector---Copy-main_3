import { readFile, writeFile } from 'node:fs/promises';

import { canonicalJsonStringify } from '../evaluation/canonicalJson';
import {
  createRuntimeHealthSnapshot,
  type RuntimeComponentHealthStatus,
  type RuntimeHealthSnapshot,
} from './runtimeHealth';

export const RUNTIME_HEALTH_DOCUMENT_SCHEMA_VERSION = 1 as const;
export const RUNTIME_HEALTH_DOCUMENT_GENERATOR_VERSION = 'runtime-health-document-v1' as const;

export interface RuntimeHealthDocument {
  schemaVersion: typeof RUNTIME_HEALTH_DOCUMENT_SCHEMA_VERSION;
  generatorVersion: typeof RUNTIME_HEALTH_DOCUMENT_GENERATOR_VERSION;
  snapshot: RuntimeHealthSnapshot;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStatus = (value: unknown): value is RuntimeComponentHealthStatus =>
  value === 'HEALTHY' || value === 'DEGRADED' || value === 'UNHEALTHY';

const validateSnapshot = (value: unknown): RuntimeHealthSnapshot => {
  if (!isRecord(value)) throw new Error('Runtime health snapshot must be an object');
  if (!Array.isArray(value.components)) {
    throw new Error('snapshot.components must be an array');
  }

  const components = value.components.map((component, index) => {
    if (!isRecord(component)) {
      throw new Error(`snapshot.components[${index}] must be an object`);
    }
    if (typeof component.name !== 'string') {
      throw new Error(`snapshot.components[${index}].name must be a string`);
    }
    if (!isStatus(component.status)) {
      throw new Error(`snapshot.components[${index}].status is invalid`);
    }
    if (typeof component.message !== 'string' && component.message !== null) {
      throw new Error(`snapshot.components[${index}].message must be string or null`);
    }
    if (!isRecord(component.metrics)) {
      throw new Error(`snapshot.components[${index}].metrics must be an object`);
    }

    const metrics: Record<string, number> = {};
    for (const [name, metricValue] of Object.entries(component.metrics)) {
      if (typeof metricValue !== 'number') {
        throw new Error(`snapshot.components[${index}].metrics.${name} must be a number`);
      }
      metrics[name] = metricValue;
    }

    return {
      name: component.name,
      status: component.status,
      observedAt: component.observedAt as number,
      message: component.message ?? undefined,
      metrics,
    };
  });

  const snapshot = createRuntimeHealthSnapshot({
    generatedAt: value.generatedAt as number,
    startedAt: value.startedAt as number,
    components,
  });

  if (value.uptimeMs !== snapshot.uptimeMs) {
    throw new Error('snapshot.uptimeMs is inconsistent');
  }
  if (value.status !== snapshot.status) {
    throw new Error('snapshot.status is inconsistent');
  }
  if (value.healthyCount !== snapshot.healthyCount) {
    throw new Error('snapshot.healthyCount is inconsistent');
  }
  if (value.degradedCount !== snapshot.degradedCount) {
    throw new Error('snapshot.degradedCount is inconsistent');
  }
  if (value.unhealthyCount !== snapshot.unhealthyCount) {
    throw new Error('snapshot.unhealthyCount is inconsistent');
  }

  return snapshot;
};

export const createRuntimeHealthDocument = (
  snapshot: RuntimeHealthSnapshot,
): RuntimeHealthDocument =>
  Object.freeze({
    schemaVersion: RUNTIME_HEALTH_DOCUMENT_SCHEMA_VERSION,
    generatorVersion: RUNTIME_HEALTH_DOCUMENT_GENERATOR_VERSION,
    snapshot: validateSnapshot(snapshot),
  });

export const serializeRuntimeHealthDocument = (document: RuntimeHealthDocument): string => {
  validateRuntimeHealthDocument(document);
  return `${canonicalJsonStringify(document)}\n`;
};

export const validateRuntimeHealthDocument = (
  value: unknown,
): value is RuntimeHealthDocument => {
  if (!isRecord(value)) throw new Error('Runtime health document must be an object');
  if (value.schemaVersion !== RUNTIME_HEALTH_DOCUMENT_SCHEMA_VERSION) {
    throw new Error('Unsupported runtime health document schema version');
  }
  if (value.generatorVersion !== RUNTIME_HEALTH_DOCUMENT_GENERATOR_VERSION) {
    throw new Error('Unsupported runtime health document generator version');
  }
  validateSnapshot(value.snapshot);
  return true;
};

export const readRuntimeHealthDocumentFromText = (text: string): RuntimeHealthDocument => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Malformed runtime health document JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  validateRuntimeHealthDocument(parsed);
  return parsed as RuntimeHealthDocument;
};

export const writeRuntimeHealthDocument = async (
  filePath: string,
  document: RuntimeHealthDocument,
): Promise<void> => {
  await writeFile(filePath, serializeRuntimeHealthDocument(document), 'utf8');
};

export const readRuntimeHealthDocument = async (
  filePath: string,
): Promise<RuntimeHealthDocument> =>
  readRuntimeHealthDocumentFromText(await readFile(filePath, 'utf8'));
