import { spawn, spawnSync } from 'node:child_process';

const argumentsSet = new Set(process.argv.slice(2));
const mode = argumentsSet.has('--live') ? 'LIVE' : 'PAPER';
const development = argumentsSet.has('--dev');
const skipDatabase = argumentsSet.has('--skip-database');
const noBrowser = argumentsSet.has('--no-browser');

const executable = (name: string): string =>
  process.platform === 'win32' && name === 'npm' ? 'npm.cmd' : name;

const run = (command: string, args: readonly string[]): void => {
  const result = spawnSync(executable(command), args, {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${String(result.status)}`);
  }
};

const openBrowser = (url: string): void => {
  try {
    if (process.platform === 'win32') {
      const child = spawn('cmd', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return;
    }
    const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const child = spawn(command, [url], { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // Browser auto-open is a convenience only; the URL is always printed.
  }
};

const startDatabase = (): void => {
  console.log('Starting PostgreSQL database...');
  run('docker', ['compose', 'up', '-d', 'database']);
  console.log('Applying database migrations...');
  run('docker', ['compose', 'run', '--rm', 'migrations']);
};

export const startPlatformOrchestrator = (): void => {
  if (!skipDatabase) startDatabase();

  if (development) {
    console.log('Building dashboard assets...');
    run('npm', ['run', 'build:dashboard']);
  } else {
    console.log('Building backend and dashboard...');
    run('npm', ['run', 'build']);
  }

  const port = process.env.DASHBOARD_PORT?.trim() || '4173';
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(
    development ? executable('npx') : process.execPath,
    development
      ? ['tsx', 'watch', 'src/tools/startTradingPlatform.ts']
      : ['dist/tools/startTradingPlatform.js'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        TRADING_MODE: mode,
      },
    },
  );

  child.on('error', (error) => {
    console.error('Unable to start trading platform process:', error);
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });

  console.log(`Trading platform URL: ${url}`);
  console.log(`Mode: ${mode}. Real order execution remains disabled.`);
  if (!noBrowser) {
    const timer = setTimeout(() => openBrowser(url), 1_200);
    timer.unref();
  }
};

if (require.main === module) {
  try {
    startPlatformOrchestrator();
  } catch (error: unknown) {
    console.error('One-click platform startup failed:', error);
    console.error(
      'Docker Desktop / Docker Engine is required unless --skip-database is used.',
    );
    process.exitCode = 1;
  }
}
