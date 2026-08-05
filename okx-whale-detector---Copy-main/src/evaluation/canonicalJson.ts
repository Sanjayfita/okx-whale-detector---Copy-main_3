const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== undefined) {
      result[key] = canonicalize(child);
    }
  }

  return result;
};

export const canonicalJsonStringify = (value: unknown): string =>
  JSON.stringify(canonicalize(value));
