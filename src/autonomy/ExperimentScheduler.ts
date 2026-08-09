import { fingerprintResearchValue } from '../research/ResearchFingerprint';

export type ExperimentTaskType =
  | 'HYPOTHESIS_GENERATION'
  | 'FEATURE_DISCOVERY'
  | 'CANDIDATE_GENERATION'
  | 'BACKTEST_SHARD'
  | 'RESULT_AGGREGATION'
  | 'STATISTICAL_VALIDATION'
  | 'CONTINUOUS_REPORT';

export type ExperimentTaskStatus =
  | 'PENDING'
  | 'LEASED'
  | 'COMPLETED'
  | 'FAILED'
  | 'BLOCKED';

export interface ExperimentTaskSpec {
  readonly taskId: string;
  readonly cycleId: string;
  readonly taskType: ExperimentTaskType;
  readonly dependencyTaskIds: readonly string[];
  readonly priority: number;
  readonly createdAt: number;
  readonly maximumAttempts: number;
  readonly leaseDurationMs: number;
  readonly resourceUnits: number;
  readonly payloadFingerprint: string;
}

export interface ExperimentTaskSnapshot extends ExperimentTaskSpec {
  readonly status: ExperimentTaskStatus;
  readonly attemptCount: number;
  readonly leasedBy: string | null;
  readonly leaseExpiresAt: number | null;
  readonly resultFingerprint: string | null;
  readonly failureReason: string | null;
  readonly updatedAt: number;
}

export interface ExperimentSchedulerSnapshot {
  readonly schedulerFingerprint: string;
  readonly tasks: readonly ExperimentTaskSnapshot[];
  readonly counts: Readonly<Record<ExperimentTaskStatus, number>>;
  readonly strategyPromotionAllowed: false;
  readonly liveExecutionAllowed: false;
}

interface MutableTask extends ExperimentTaskSpec {
  status: ExperimentTaskStatus;
  attemptCount: number;
  leasedBy: string | null;
  leaseExpiresAt: number | null;
  resultFingerprint: string | null;
  failureReason: string | null;
  updatedAt: number;
}

const requireText = (value: string, name: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${name} must not be empty`);
  return normalized;
};

const requireTimestamp = (value: number, name: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
};

const validateSpec = (spec: ExperimentTaskSpec): ExperimentTaskSpec => {
  const taskId = requireText(spec.taskId, 'taskId');
  const cycleId = requireText(spec.cycleId, 'cycleId');
  const payloadFingerprint = requireText(
    spec.payloadFingerprint,
    'payloadFingerprint',
  );
  requireTimestamp(spec.createdAt, 'createdAt');
  if (
    !Number.isSafeInteger(spec.priority) ||
    !Number.isSafeInteger(spec.maximumAttempts) ||
    spec.maximumAttempts <= 0 ||
    !Number.isSafeInteger(spec.leaseDurationMs) ||
    spec.leaseDurationMs <= 0 ||
    !Number.isSafeInteger(spec.resourceUnits) ||
    spec.resourceUnits <= 0
  ) {
    throw new Error('invalid experiment task integer policy');
  }
  const dependencyTaskIds = [...new Set(
    spec.dependencyTaskIds.map((dependency) =>
      requireText(dependency, 'dependencyTaskId'),
    ),
  )].sort();
  if (dependencyTaskIds.includes(taskId)) {
    throw new Error(`task ${taskId} cannot depend on itself`);
  }
  return {
    ...spec,
    taskId,
    cycleId,
    payloadFingerprint,
    dependencyTaskIds,
  };
};

const assertAcyclic = (tasks: ReadonlyMap<string, MutableTask>): void => {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (taskId: string): void => {
    if (visited.has(taskId)) return;
    if (visiting.has(taskId)) {
      throw new Error(`experiment task dependency cycle detected at ${taskId}`);
    }
    visiting.add(taskId);
    const task = tasks.get(taskId);
    if (task === undefined) throw new Error(`unknown task ${taskId}`);
    for (const dependencyId of task.dependencyTaskIds) visit(dependencyId);
    visiting.delete(taskId);
    visited.add(taskId);
  };
  for (const taskId of tasks.keys()) visit(taskId);
};

const snapshotTask = (task: MutableTask): ExperimentTaskSnapshot => ({
  taskId: task.taskId,
  cycleId: task.cycleId,
  taskType: task.taskType,
  dependencyTaskIds: task.dependencyTaskIds,
  priority: task.priority,
  createdAt: task.createdAt,
  maximumAttempts: task.maximumAttempts,
  leaseDurationMs: task.leaseDurationMs,
  resourceUnits: task.resourceUnits,
  payloadFingerprint: task.payloadFingerprint,
  status: task.status,
  attemptCount: task.attemptCount,
  leasedBy: task.leasedBy,
  leaseExpiresAt: task.leaseExpiresAt,
  resultFingerprint: task.resultFingerprint,
  failureReason: task.failureReason,
  updatedAt: task.updatedAt,
});

export class ExperimentScheduler {
  private readonly tasks = new Map<string, MutableTask>();

  public constructor(specs: readonly ExperimentTaskSpec[]) {
    if (specs.length === 0) throw new Error('experiment scheduler requires tasks');
    for (const rawSpec of specs) {
      const spec = validateSpec(rawSpec);
      if (this.tasks.has(spec.taskId)) {
        throw new Error(`duplicate experiment task ${spec.taskId}`);
      }
      this.tasks.set(spec.taskId, {
        ...spec,
        status: 'PENDING',
        attemptCount: 0,
        leasedBy: null,
        leaseExpiresAt: null,
        resultFingerprint: null,
        failureReason: null,
        updatedAt: spec.createdAt,
      });
    }
    for (const task of this.tasks.values()) {
      for (const dependencyId of task.dependencyTaskIds) {
        const dependency = this.tasks.get(dependencyId);
        if (dependency === undefined) {
          throw new Error(
            `task ${task.taskId} references unknown dependency ${dependencyId}`,
          );
        }
        if (dependency.cycleId !== task.cycleId) {
          throw new Error('cross-cycle task dependencies are not permitted');
        }
      }
    }
    assertAcyclic(this.tasks);
  }

  private refresh(now: number): void {
    requireTimestamp(now, 'now');
    for (const task of this.tasks.values()) {
      if (
        task.status === 'LEASED' &&
        task.leaseExpiresAt !== null &&
        task.leaseExpiresAt <= now
      ) {
        task.leasedBy = null;
        task.leaseExpiresAt = null;
        task.failureReason = 'LEASE_EXPIRED';
        task.updatedAt = now;
        task.status =
          task.attemptCount >= task.maximumAttempts ? 'FAILED' : 'PENDING';
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const task of this.tasks.values()) {
        if (task.status !== 'PENDING') continue;
        const dependencyStates = task.dependencyTaskIds.map(
          (dependencyId) => this.tasks.get(dependencyId)?.status,
        );
        if (
          dependencyStates.some(
            (status) => status === 'FAILED' || status === 'BLOCKED',
          )
        ) {
          task.status = 'BLOCKED';
          task.failureReason = 'DEPENDENCY_NOT_COMPLETED';
          task.updatedAt = now;
          changed = true;
        }
      }
    }
  }

  public claim(input: {
    readonly workerId: string;
    readonly now: number;
    readonly availableResourceUnits: number;
    readonly supportedTaskTypes?: readonly ExperimentTaskType[];
  }): ExperimentTaskSnapshot | null {
    const workerId = requireText(input.workerId, 'workerId');
    requireTimestamp(input.now, 'now');
    if (
      !Number.isSafeInteger(input.availableResourceUnits) ||
      input.availableResourceUnits <= 0
    ) {
      throw new Error('availableResourceUnits must be positive');
    }
    this.refresh(input.now);
    const supported =
      input.supportedTaskTypes === undefined
        ? null
        : new Set(input.supportedTaskTypes);
    const eligible = [...this.tasks.values()]
      .filter((task) => {
        if (task.status !== 'PENDING') return false;
        if (task.resourceUnits > input.availableResourceUnits) return false;
        if (supported !== null && !supported.has(task.taskType)) return false;
        return task.dependencyTaskIds.every(
          (dependencyId) => this.tasks.get(dependencyId)?.status === 'COMPLETED',
        );
      })
      .sort(
        (left, right) =>
          right.priority - left.priority ||
          left.createdAt - right.createdAt ||
          left.taskId.localeCompare(right.taskId),
      );
    const task = eligible[0];
    if (task === undefined) return null;
    task.status = 'LEASED';
    task.attemptCount += 1;
    task.leasedBy = workerId;
    task.leaseExpiresAt = input.now + task.leaseDurationMs;
    task.failureReason = null;
    task.updatedAt = input.now;
    return snapshotTask(task);
  }

  public heartbeat(input: {
    readonly taskId: string;
    readonly workerId: string;
    readonly now: number;
  }): ExperimentTaskSnapshot {
    const task = this.requireTask(input.taskId);
    const workerId = requireText(input.workerId, 'workerId');
    this.refresh(input.now);
    if (task.status !== 'LEASED' || task.leasedBy !== workerId) {
      throw new Error(`worker ${workerId} does not hold task ${task.taskId}`);
    }
    task.leaseExpiresAt = input.now + task.leaseDurationMs;
    task.updatedAt = input.now;
    return snapshotTask(task);
  }

  public complete(input: {
    readonly taskId: string;
    readonly workerId: string;
    readonly now: number;
    readonly resultFingerprint: string;
  }): ExperimentTaskSnapshot {
    const task = this.requireTask(input.taskId);
    const workerId = requireText(input.workerId, 'workerId');
    const resultFingerprint = requireText(
      input.resultFingerprint,
      'resultFingerprint',
    );
    if (task.status === 'COMPLETED') {
      if (task.resultFingerprint !== resultFingerprint) {
        throw new Error(`task ${task.taskId} already completed with another result`);
      }
      return snapshotTask(task);
    }
    this.refresh(input.now);
    if (task.status !== 'LEASED' || task.leasedBy !== workerId) {
      throw new Error(`worker ${workerId} does not hold task ${task.taskId}`);
    }
    task.status = 'COMPLETED';
    task.resultFingerprint = resultFingerprint;
    task.leasedBy = null;
    task.leaseExpiresAt = null;
    task.failureReason = null;
    task.updatedAt = input.now;
    return snapshotTask(task);
  }

  public fail(input: {
    readonly taskId: string;
    readonly workerId: string;
    readonly now: number;
    readonly reason: string;
    readonly retryable: boolean;
  }): ExperimentTaskSnapshot {
    const task = this.requireTask(input.taskId);
    const workerId = requireText(input.workerId, 'workerId');
    const reason = requireText(input.reason, 'reason');
    this.refresh(input.now);
    if (task.status !== 'LEASED' || task.leasedBy !== workerId) {
      throw new Error(`worker ${workerId} does not hold task ${task.taskId}`);
    }
    task.status =
      input.retryable && task.attemptCount < task.maximumAttempts
        ? 'PENDING'
        : 'FAILED';
    task.leasedBy = null;
    task.leaseExpiresAt = null;
    task.failureReason = reason;
    task.updatedAt = input.now;
    this.refresh(input.now);
    return snapshotTask(task);
  }

  public snapshot(now: number): ExperimentSchedulerSnapshot {
    this.refresh(now);
    const tasks = [...this.tasks.values()]
      .map(snapshotTask)
      .sort((left, right) => left.taskId.localeCompare(right.taskId));
    const counts: Record<ExperimentTaskStatus, number> = {
      PENDING: 0,
      LEASED: 0,
      COMPLETED: 0,
      FAILED: 0,
      BLOCKED: 0,
    };
    for (const task of tasks) counts[task.status] += 1;
    return {
      schedulerFingerprint: fingerprintResearchValue(
        tasks.map((task) => ({
          taskId: task.taskId,
          status: task.status,
          attemptCount: task.attemptCount,
          resultFingerprint: task.resultFingerprint,
          failureReason: task.failureReason,
        })),
      ),
      tasks,
      counts,
      strategyPromotionAllowed: false,
      liveExecutionAllowed: false,
    };
  }

  private requireTask(taskId: string): MutableTask {
    const normalized = requireText(taskId, 'taskId');
    const task = this.tasks.get(normalized);
    if (task === undefined) throw new Error(`unknown experiment task ${normalized}`);
    return task;
  }
}
