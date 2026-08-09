import {
  DiscordNotificationChannel,
  EmailRelayNotificationChannel,
  NotificationService,
  TelegramNotificationChannel,
  WebhookNotificationChannel,
  type NotificationChannel,
} from './NotificationService';

const nonEmpty = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Notification credentials stay in environment variables and are never persisted
 * in dashboard settings, logs, or research evidence.
 */
export const createNotificationServiceFromEnvironment = (
  environment: NodeJS.ProcessEnv = process.env,
): NotificationService => {
  const channels: NotificationChannel[] = [];
  const discord = nonEmpty(environment.DISCORD_WEBHOOK_URL);
  const webhook = nonEmpty(environment.TRADING_WEBHOOK_URL);
  const telegramToken = nonEmpty(environment.TELEGRAM_BOT_TOKEN);
  const telegramChat = nonEmpty(environment.TELEGRAM_CHAT_ID);
  const emailRelay = nonEmpty(environment.EMAIL_RELAY_URL);
  const emailRecipient = nonEmpty(environment.EMAIL_RECIPIENT);

  if (discord !== undefined) {
    channels.push(new DiscordNotificationChannel(discord));
  }
  if (webhook !== undefined) {
    channels.push(new WebhookNotificationChannel(webhook));
  }
  if (telegramToken !== undefined && telegramChat !== undefined) {
    channels.push(
      new TelegramNotificationChannel(telegramToken, telegramChat),
    );
  }
  if (emailRelay !== undefined && emailRecipient !== undefined) {
    channels.push(
      new EmailRelayNotificationChannel(emailRelay, emailRecipient),
    );
  }

  return new NotificationService(channels);
};
