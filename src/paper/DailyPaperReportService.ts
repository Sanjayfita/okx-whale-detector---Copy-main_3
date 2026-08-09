import type { PaperDailyReport } from './PaperTradingEngine';

export interface PaperDailyReportSource {
  generateDailyReport(timestamp: number): PaperDailyReport;
}

export interface PaperDailyReportSink {
  write(report: PaperDailyReport): Promise<void>;
}

export interface DailyReportClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemClock: DailyReportClock = {
  now: Date.now,
  setTimeout(callback, delayMs) {
    return setTimeout(callback, delayMs);
  },
  clearTimeout(handle) {
    clearTimeout(handle as NodeJS.Timeout);
  },
};

const DAY_MS = 24 * 60 * 60 * 1_000;

const nextUtcMidnight = (timestamp: number): number => {
  const date = new Date(timestamp);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1,
  );
};

export class DailyPaperReportService {
  private timer: unknown = null;
  private running = false;
  private lastError: Error | null = null;

  public constructor(
    private readonly source: PaperDailyReportSource,
    private readonly sink: PaperDailyReportSink,
    private readonly clock: DailyReportClock = systemClock,
  ) {}

  public start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.scheduleNext();
  }

  public stop(): void {
    this.running = false;
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public isRunning(): boolean {
    return this.running;
  }

  public getLastError(): Error | null {
    return this.lastError;
  }

  public async generateNow(timestamp = this.clock.now()): Promise<PaperDailyReport> {
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new Error('timestamp must be a non-negative safe integer');
    }
    const reportTimestamp = Math.max(0, timestamp - 1);
    const report = this.source.generateDailyReport(reportTimestamp);
    await this.sink.write(report);
    return report;
  }

  private scheduleNext(): void {
    if (!this.running) {
      return;
    }
    const now = this.clock.now();
    const delay = Math.max(1, nextUtcMidnight(now) - now);
    this.timer = this.clock.setTimeout(() => {
      void this.runScheduledReport();
    }, delay);
  }

  private async runScheduledReport(): Promise<void> {
    this.timer = null;
    try {
      await this.generateNow(this.clock.now());
      this.lastError = null;
    } catch (error: unknown) {
      this.lastError =
        error instanceof Error ? error : new Error(String(error));
    } finally {
      this.scheduleNext();
    }
  }
}

export const DAILY_REPORT_INTERVAL_MS = DAY_MS;
