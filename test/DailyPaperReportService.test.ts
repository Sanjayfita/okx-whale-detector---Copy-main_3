import { describe, expect, it } from 'vitest';

import {
  DailyPaperReportService,
  type DailyReportClock,
} from '../src/paper/DailyPaperReportService';
import type { PaperDailyReport } from '../src/paper/PaperTradingEngine';

const now = Date.UTC(2026, 7, 5, 23, 59, 59);

const report = (day: string): PaperDailyReport => ({
  day,
  submittedOrders: 1,
  filledOrders: 1,
  partiallyFilledOrders: 0,
  rejectedOrders: 0,
  retryExhaustedOrders: 0,
  closedTrades: 1,
  grossPnl: 10,
  fees: 1,
  fundingPnl: -0.1,
  netPnl: 8.9,
  openPositions: 0,
  liveExecutionAllowed: false,
});

describe('DailyPaperReportService', () => {
  it('schedules at the next UTC midnight and writes the completed day', async () => {
    let scheduledDelay = 0;
    let scheduledCallback: (() => void) | null = null;
    const written: PaperDailyReport[] = [];
    const clock: DailyReportClock = {
      now: () => now,
      setTimeout(callback, delayMs) {
        scheduledCallback = callback;
        scheduledDelay = delayMs;
        return 1;
      },
      clearTimeout() {},
    };
    const service = new DailyPaperReportService(
      {
        generateDailyReport(timestamp) {
          return report(new Date(timestamp).toISOString().slice(0, 10));
        },
      },
      {
        async write(value) {
          written.push(value);
        },
      },
      clock,
    );

    service.start();
    expect(scheduledDelay).toBe(1_000);
    expect(scheduledCallback).not.toBeNull();

    const callback = scheduledCallback as unknown as () => void;
    callback();
    await Promise.resolve();
    await Promise.resolve();

    expect(written).toHaveLength(1);
    expect(written[0]?.day).toBe('2026-08-05');
    expect(written[0]?.liveExecutionAllowed).toBe(false);
    expect(service.getLastError()).toBeNull();
    service.stop();
    expect(service.isRunning()).toBe(false);
  });

  it('supports explicit report generation for operational backfills', async () => {
    const written: PaperDailyReport[] = [];
    const service = new DailyPaperReportService(
      {
        generateDailyReport(timestamp) {
          return report(new Date(timestamp).toISOString().slice(0, 10));
        },
      },
      {
        async write(value) {
          written.push(value);
        },
      },
    );

    const value = await service.generateNow(Date.UTC(2026, 7, 6));

    expect(value.day).toBe('2026-08-05');
    expect(written).toEqual([value]);
  });
});
