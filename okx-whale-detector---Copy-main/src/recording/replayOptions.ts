export type ReplaySpeed = 'instant' | 'realtime' | number;

export interface ReplayOptions {
  filePath: string;
  symbol?: string;
  speed: ReplaySpeed;
  report: boolean;
  reportPath?: string;
}

export const parseReplayOptions = (args: readonly string[]): ReplayOptions => {
  const [filePath, ...flags] = args;

  if (!filePath) {
    throw new Error(
      'Usage: npm run replay -- <recording.ndjson> [--symbol BTC-USDT] [--speed instant|realtime|10x] [--report [report.json]]',
    );
  }

  let symbol: string | undefined;
  let speed: ReplaySpeed = 'instant';
  let report = false;
  let reportPath: string | undefined;

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    const value = flags[index + 1];

    if (flag === '--symbol') {
      if (!value || value.startsWith('--')) {
        throw new Error('--symbol requires a market symbol');
      }
      symbol = value;
      index += 1;
      continue;
    }

    if (flag === '--speed') {
      if (!value || value.startsWith('--')) {
        throw new Error(
          '--speed requires instant, realtime, or a multiplier such as 10x',
        );
      }
      speed = parseReplaySpeed(value);
      index += 1;
      continue;
    }

    if (flag === '--report') {
      report = true;
      if (value && !value.startsWith('--')) {
        reportPath = value;
        index += 1;
      }
      continue;
    }

    throw new Error(`Unknown replay option: ${flag}`);
  }

  return { filePath, symbol, speed, report, reportPath };
};

export const parseReplaySpeed = (value: string): ReplaySpeed => {
  if (value === 'instant' || value === 'realtime') {
    return value;
  }

  const match = /^(\d+(?:\.\d+)?)x$/.exec(value);
  const multiplier = match?.[1] === undefined ? Number.NaN : Number(match[1]);

  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new Error(
      'Replay speed must be instant, realtime, or a positive multiplier such as 10x',
    );
  }

  return multiplier;
};

export const calculateReplayDelayMs = (
  previousRecordedAt: number | undefined,
  recordedAt: number,
  speed: ReplaySpeed,
): number => {
  if (previousRecordedAt === undefined || speed === 'instant') {
    return 0;
  }

  const originalDelay = Math.max(0, recordedAt - previousRecordedAt);
  return speed === 'realtime' ? originalDelay : originalDelay / speed;
};

export const calculateAnchoredReplayDelayMs = (
  firstRecordedAt: number | undefined,
  recordedAt: number,
  playbackElapsedMs: number,
  speed: ReplaySpeed,
): number => {
  if (firstRecordedAt === undefined || speed === 'instant') {
    return 0;
  }

  const recordedElapsedMs = Math.max(0, recordedAt - firstRecordedAt);
  const targetElapsedMs =
    speed === 'realtime' ? recordedElapsedMs : recordedElapsedMs / speed;

  return Math.max(0, targetElapsedMs - Math.max(0, playbackElapsedMs));
};
