import { createHash } from 'node:crypto';

const canonicalize = (
  value: unknown,
  ancestors: ReadonlySet<object>,
): string => {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('research fingerprints require finite numbers');
    }
    return Object.is(value, -0) ? '0' : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new Error('research fingerprints do not support cyclic values');
    }
    const next = new Set(ancestors).add(value);
    return `[${value.map((entry) => canonicalize(entry, next)).join(',')}]`;
  }
  if (typeof value === 'object') {
    if (ancestors.has(value)) {
      throw new Error('research fingerprints do not support cyclic values');
    }
    const next = new Set(ancestors).add(value);
    const entries = Object.entries(value as Readonly<Record<string, unknown>>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalize(nested, next)}`)
      .join(',')}}`;
  }
  throw new Error(`unsupported research fingerprint value: ${typeof value}`);
};

export const canonicalResearchJson = (value: unknown): string =>
  canonicalize(value, new Set<object>());

export const fingerprintResearchValue = (value: unknown): string =>
  createHash('sha256').update(canonicalResearchJson(value)).digest('hex');
