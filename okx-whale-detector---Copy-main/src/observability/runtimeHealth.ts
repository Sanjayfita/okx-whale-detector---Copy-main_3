export type RuntimeComponentHealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';

export interface RuntimeComponentHealthInput {
  name: string;
  status: RuntimeComponentHealthStatus;
  observedAt: number;
  message?: string;
  metrics?: Readonly<Record<string, number>>;
}

export interface RuntimeComponentHealth {
  name: string;
  status: RuntimeComponentHealthStatus;
  observedAt: number;
  message: string | null;
  metrics: Readonly<Record<string, number>>;
}

export interface RuntimeHealthSnapshot {
  generatedAt: number;
  startedAt: number;
  uptimeMs: number;
  status: RuntimeComponentHealthStatus;
  healthyCount: number;
  degradedCount: number;
  unhealthyCount: number;
  components: readonly RuntimeComponentHealth[];
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const assertTimestamp = (name: string, value: number): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

const normalizeMetrics = (
  componentName: string,
  metrics: Readonly<Record<string, number>> | undefined,
): Readonly<Record<string, number>> => {
  const normalized: Record<string, number> = {};

  for (const [name, value] of Object.entries(metrics ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!IDENTIFIER_PATTERN.test(name)) {
      throw new Error(`Component ${componentName} contains an invalid metric name: ${name}`);
    }
    if (!Number.isFinite(value)) {
      throw new Error(`Component ${componentName} metric ${name} must be finite`);
    }
    normalized[name] = value;
  }

  return Object.freeze(normalized);
};

const statusRank: Readonly<Record<RuntimeComponentHealthStatus, number>> = Object.freeze({
  HEALTHY: 0,
  DEGRADED: 1,
  UNHEALTHY: 2,
});

export const createRuntimeHealthSnapshot = (input: {
  generatedAt: number;
  startedAt: number;
  components: readonly RuntimeComponentHealthInput[];
}): RuntimeHealthSnapshot => {
  assertTimestamp('generatedAt', input.generatedAt);
  assertTimestamp('startedAt', input.startedAt);
  if (input.startedAt > input.generatedAt) {
    throw new Error('startedAt cannot be later than generatedAt');
  }
  if (input.components.length === 0) {
    throw new Error('Runtime health snapshot requires at least one component');
  }

  const names = new Set<string>();
  const components = input.components
    .map((component): RuntimeComponentHealth => {
      if (!IDENTIFIER_PATTERN.test(component.name)) {
        throw new Error(`Invalid runtime component name: ${component.name}`);
      }
      if (names.has(component.name)) {
        throw new Error(`Duplicate runtime component name: ${component.name}`);
      }
      names.add(component.name);
      assertTimestamp(`Component ${component.name} observedAt`, component.observedAt);
      if (component.observedAt > input.generatedAt) {
        throw new Error(`Component ${component.name} cannot be observed in the future`);
      }
      if (component.message !== undefined && component.message.trim() === '') {
        throw new Error(`Component ${component.name} message must be non-empty when provided`);
      }

      return Object.freeze({
        name: component.name,
        status: component.status,
        observedAt: component.observedAt,
        message: component.message ?? null,
        metrics: normalizeMetrics(component.name, component.metrics),
      });
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  const healthyCount = components.filter((component) => component.status === 'HEALTHY').length;
  const degradedCount = components.filter((component) => component.status === 'DEGRADED').length;
  const unhealthyCount = components.filter(
    (component) => component.status === 'UNHEALTHY',
  ).length;
  const status = components.reduce<RuntimeComponentHealthStatus>(
    (worst, component) =>
      statusRank[component.status] > statusRank[worst] ? component.status : worst,
    'HEALTHY',
  );

  return Object.freeze({
    generatedAt: input.generatedAt,
    startedAt: input.startedAt,
    uptimeMs: input.generatedAt - input.startedAt,
    status,
    healthyCount,
    degradedCount,
    unhealthyCount,
    components: Object.freeze(components),
  });
};
