import { describe, expect, it } from 'vitest';
import {
  NotificationService,
  type NotificationChannel,
  type TradingNotification,
} from '../src/notifications/NotificationService';

const notification: TradingNotification = {
  type: 'TRADE_OPENED',
  timestamp: 1_000,
  title: 'Trade opened',
  message: 'BTC long',
};

describe('NotificationService', () => {
  it('fans out notifications and isolates a failing channel', async () => {
    const received: string[] = [];
    const working: NotificationChannel = {
      id: 'working',
      async send(value) {
        received.push(value.type);
      },
    };
    const failing: NotificationChannel = {
      id: 'failing',
      async send() {
        throw new Error('offline');
      },
    };

    const deliveries = await new NotificationService([
      working,
      failing,
    ]).send(notification);

    expect(received).toEqual(['TRADE_OPENED']);
    expect(deliveries).toEqual([
      { channelId: 'working', delivered: true, error: null },
      { channelId: 'failing', delivered: false, error: 'offline' },
    ]);
  });
});
