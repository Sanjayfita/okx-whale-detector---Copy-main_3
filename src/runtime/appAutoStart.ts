export const shouldAutoStartApp = (
  environment: NodeJS.ProcessEnv = process.env,
): boolean => environment.OKX_SKIP_AUTO_START !== '1';
