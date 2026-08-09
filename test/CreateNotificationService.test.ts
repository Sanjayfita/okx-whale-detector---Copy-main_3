import { describe, expect, it, vi } from 'vitest';
import { createNotificationServiceFromEnvironment } from '../src/notifications/createNotificationService';

describe('createNotificationServiceFromEnvironment', () => {
  it('allows a no-credentials notification service without network calls', async () => {
    const service = createNotificationServiceFromEnvironment({});
    const deliveries = await service.send({
      type: 'DAILY_SUMMARY',
      timestamp: 1_000,
      title: 'Summary',
      message: 'No channels configured',
    });
    expect(deliveries).toEqual([]);
  });

  it('does not require partially configured Telegram credentials', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const service = createNotificationServiceFromEnvironment({
      TELEGRAM_BOT_TOKEN: 'token-only',
    });
    expect(
      await service.send({
        type: 'ERROR',
        timestamp: 1_000,
        title: 'Test',
        message: 'No complete channel',
      }),
    ).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
