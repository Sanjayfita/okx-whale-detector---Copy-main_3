export interface ProcessMemoryReporterOptions {
  readonly intervalMs?: number;
  readonly readMemoryUsage?: () => NodeJS.MemoryUsage;
  readonly additionalMetrics?: () => Readonly<Record<string, number>>;
  readonly log?: (message: string) => void;
}

export interface ProcessMemoryReporter {
  stop(): void;
}

const megabytes = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1);

export const formatProcessMemoryUsage = (usage: NodeJS.MemoryUsage): string =>
  '[MEMORY] ' +
  `rss=${megabytes(usage.rss)}MB ` +
  `heapUsed=${megabytes(usage.heapUsed)}MB ` +
  `heapTotal=${megabytes(usage.heapTotal)}MB ` +
  `external=${megabytes(usage.external)}MB ` +
  `arrayBuffers=${megabytes(usage.arrayBuffers)}MB`;

const formatAdditionalMetrics = (
  metrics: Readonly<Record<string, number>>,
): string =>
  Object.entries(metrics)
    .map(([name, value]) => `${name}=${value}`)
    .join(' ');

export const startProcessMemoryReporter = (
  options: ProcessMemoryReporterOptions = {},
): ProcessMemoryReporter => {
  const intervalMs = options.intervalMs ?? 60_000;
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new Error('memory reporting intervalMs must be a positive safe integer');
  }

  const readMemoryUsage = options.readMemoryUsage ?? process.memoryUsage;
  const log = options.log ?? console.log;
  const report = (): void => {
    const memory = formatProcessMemoryUsage(readMemoryUsage());
    const additional =
      options.additionalMetrics === undefined
        ? ''
        : formatAdditionalMetrics(options.additionalMetrics());
    log(additional.length === 0 ? memory : `${memory} ${additional}`);
  };

  report();
  const timer = setInterval(report, intervalMs);
  timer.unref();

  return {
    stop: () => clearInterval(timer),
  };
};
