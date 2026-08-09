import { spawn, spawnSync } from 'node:child_process';

export interface PlatformStartupFeatures {
  readonly mode: 'PAPER' | 'LIVE';
  readonly development: boolean;
  readonly withDatabase: boolean;
  readonly withResearch: boolean;
  readonly noBrowser: boolean;
}

export const resolvePlatformStartupFeatures = (
  args: readonly string[],
): PlatformStartupFeatures => {
  const argumentsSet = new Set(args);
  return {
    mode: argumentsSet.has('--live') ? 'LIVE' : 'PAPER',
    development: argumentsSet.has('--dev'),
    withDatabase:
      argumentsSet.has('--with-database') && !argumentsSet.has('--skip-database'),
    withResearch: argumentsSet.has('--with-research'),
    noBrowser: argumentsSet.has('--no-browser'),
  };
};

const isWindowsShellCommand = (name: string): boolean =>
  process.platform === 'win32' && (name === 'npm' || name === 'npx');

/**
 * npm and npx are .cmd shims on Windows. Recent Node versions can reject a
 * direct spawnSync/spawn of those shims with EINVAL. Let the Windows command
 * shell resolve them instead, while keeping native executables such as docker
 * on the normal direct-spawn path.
 */
const run = (command: string, args: readonly string[]): void => {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: process.env,
    shell: isWindowsShellCommand(command),
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${String(result.status)}`,
    );
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

export const startPlatformOrchestrator = (
  args: readonly string[] = process.argv.slice(2),
): void => {
  const features = resolvePlatformStartupFeatures(args);
  if (features.withDatabase) {
    startDatabase();
  } else {
    console.log(
      'Local PostgreSQL/Docker startup skipped. Use --with-database when research database services are needed.',
    );
  }

  console.log(
    `Startup profile: ${features.withResearch ? 'PAPER TRADING + RESEARCH' : 'LEAN PAPER TRADING'}`,
  );
  console.log(`Research runtime: ${features.withResearch ? 'enabled' : 'disabled'}`);

  if (features.development) {
    console.log('Building dashboard assets...');
    run('npm', ['run', 'build:dashboard']);
  } else {
    console.log('Building backend and dashboard...');
    run('npm', ['run', 'build']);
  }

  const port = process.env.DASHBOARD_PORT?.trim() || '4173';
  const url = `http://127.0.0.1:${port}`;
  const childEnvironment = {
    ...process.env,
    TRADING_MODE: features.mode,
    WITH_RESEARCH_RUNTIME: features.withResearch ? 'true' : 'false',
  };
  const child = features.development
    ? spawn('npx', ['tsx', 'watch', 'src/tools/startTradingPlatform.ts'], {
        stdio: 'inherit',
        env: childEnvironment,
        shell: isWindowsShellCommand('npx'),
      })
    : spawn(process.execPath, ['dist/tools/startTradingPlatform.js'], {
        stdio: 'inherit',
        env: childEnvironment,
      });

  child.on('error', (error) => {
    console.error('Unable to start trading platform process:', error);
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });

  console.log(`Trading platform URL: ${url}`);
  console.log(`Mode: ${features.mode}. Real order execution remains disabled.`);
  if (!features.noBrowser) {
    const timer = setTimeout(() => openBrowser(url), 1_200);
    timer.unref();
  }
};

if (require.main === module) {
  try {
    startPlatformOrchestrator();
  } catch (error: unknown) {
    console.error('One-click platform startup failed:', error);
    const features = resolvePlatformStartupFeatures(process.argv.slice(2));
    if (features.withDatabase) {
      console.error(
        'Docker Desktop / Docker Engine is required only when --with-database is used.',
      );
    }
    process.exitCode = 1;
  }
}
