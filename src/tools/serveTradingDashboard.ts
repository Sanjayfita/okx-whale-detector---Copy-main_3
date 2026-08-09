import { TradingPlatformApplication } from '../platform/TradingPlatformApplication';

export const serveTradingDashboard = async (): Promise<void> => {
  const application = new TradingPlatformApplication({
    mode: process.env.TRADING_MODE?.toUpperCase() === 'LIVE' ? 'LIVE' : 'PAPER',
    startingEquity: Number(process.env.PAPER_STARTING_EQUITY ?? 10_000),
    server: {
      host: process.env.DASHBOARD_HOST?.trim() || '0.0.0.0',
      port: Number(process.env.DASHBOARD_PORT ?? 4173),
      staticDirectory: process.env.DASHBOARD_STATIC_DIR?.trim() || 'web',
    },
  });
  await application.start();
  console.log(`Dashboard-only mode: ${application.getUrl()}`);
  console.log('No OKX runtime was started by this command.');

  const close = (): void => {
    void application.close().catch((error: unknown) => {
      console.error('Dashboard shutdown failed:', error);
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
};

if (require.main === module) {
  void serveTradingDashboard().catch((error: unknown) => {
    console.error('Failed to serve trading dashboard:', error);
    process.exitCode = 1;
  });
}
