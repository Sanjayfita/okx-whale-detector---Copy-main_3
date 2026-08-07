export type TradingNotificationType =
  | 'TRADE_OPENED'
  | 'TRADE_CLOSED'
  | 'STOP_HIT'
  | 'TAKE_PROFIT'
  | 'DAILY_SUMMARY'
  | 'ERROR';

export interface TradingNotification {
  readonly type: TradingNotificationType;
  readonly timestamp: number;
  readonly title: string;
  readonly message: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface NotificationDelivery {
  readonly channelId: string;
  readonly delivered: boolean;
  readonly error: string | null;
}

export interface NotificationChannel {
  readonly id: string;
  send(notification: TradingNotification): Promise<void>;
}

export type JsonPoster = (
  url: string,
  body: Readonly<Record<string, unknown>>,
) => Promise<void>;

export const defaultJsonPoster: JsonPoster = async (url, body) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`notification endpoint returned HTTP ${response.status}`);
  }
};

const formatNotification = (notification: TradingNotification): string =>
  `[${notification.type}] ${notification.title}\n${notification.message}`;

export class WebhookNotificationChannel implements NotificationChannel {
  public readonly id = 'webhook';

  public constructor(
    private readonly url: string,
    private readonly post: JsonPoster = defaultJsonPoster,
  ) {
    if (url.trim().length === 0) throw new Error('webhook URL must not be empty');
  }

  public async send(notification: TradingNotification): Promise<void> {
    await this.post(this.url, {
      ...notification,
      metadata: notification.metadata ?? {},
    });
  }
}

export class DiscordNotificationChannel implements NotificationChannel {
  public readonly id = 'discord';

  public constructor(
    private readonly webhookUrl: string,
    private readonly post: JsonPoster = defaultJsonPoster,
  ) {
    if (webhookUrl.trim().length === 0) {
      throw new Error('Discord webhook URL must not be empty');
    }
  }

  public async send(notification: TradingNotification): Promise<void> {
    await this.post(this.webhookUrl, { content: formatNotification(notification) });
  }
}

export class TelegramNotificationChannel implements NotificationChannel {
  public readonly id = 'telegram';

  public constructor(
    botToken: string,
    private readonly chatId: string,
    private readonly post: JsonPoster = defaultJsonPoster,
  ) {
    if (botToken.trim().length === 0) {
      throw new Error('Telegram bot token must not be empty');
    }
    if (chatId.trim().length === 0) {
      throw new Error('Telegram chat id must not be empty');
    }
    this.endpoint = `https://api.telegram.org/bot${botToken}/sendMessage`;
  }

  private readonly endpoint: string;

  public async send(notification: TradingNotification): Promise<void> {
    await this.post(this.endpoint, {
      chat_id: this.chatId,
      text: formatNotification(notification),
    });
  }
}

/**
 * Email is provider-neutral: point this channel at an HTTPS mail relay that accepts
 * `{to, subject, text}` JSON. This avoids embedding provider credentials or a new
 * SMTP dependency in the trading process.
 */
export class EmailRelayNotificationChannel implements NotificationChannel {
  public readonly id = 'email';

  public constructor(
    private readonly relayUrl: string,
    private readonly recipient: string,
    private readonly post: JsonPoster = defaultJsonPoster,
  ) {
    if (relayUrl.trim().length === 0) throw new Error('email relay URL must not be empty');
    if (recipient.trim().length === 0) throw new Error('email recipient must not be empty');
  }

  public async send(notification: TradingNotification): Promise<void> {
    await this.post(this.relayUrl, {
      to: this.recipient,
      subject: notification.title,
      text: formatNotification(notification),
    });
  }
}

export class NotificationService {
  public constructor(private readonly channels: readonly NotificationChannel[]) {}

  public async send(
    notification: TradingNotification,
  ): Promise<readonly NotificationDelivery[]> {
    const deliveries: NotificationDelivery[] = [];
    for (const channel of this.channels) {
      try {
        await channel.send(notification);
        deliveries.push({ channelId: channel.id, delivered: true, error: null });
      } catch (error: unknown) {
        deliveries.push({
          channelId: channel.id,
          delivered: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return deliveries;
  }
}
