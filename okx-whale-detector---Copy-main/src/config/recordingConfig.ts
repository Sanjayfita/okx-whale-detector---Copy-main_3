import path from 'node:path';

export interface RecordingConfig {
  enabled: boolean;
  directory: string;
}

export const recordingConfig: RecordingConfig = {
  enabled: process.env.RECORD_MARKET_DATA === 'true',
  directory: process.env.RECORDING_DIRECTORY ?? path.join('data', 'recordings'),
};

export const validateRecordingConfig = (config: RecordingConfig): void => {
  if (typeof config.enabled !== 'boolean') {
    throw new Error('recording.enabled must be a boolean');
  }

  if (
    typeof config.directory !== 'string' ||
    config.directory.trim().length === 0
  ) {
    throw new Error('recording.directory must be a non-empty string');
  }
};
