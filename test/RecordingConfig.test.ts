import { describe, expect, it } from 'vitest';

import {
  type RecordingConfig,
  validateRecordingConfig,
} from '../src/config/recordingConfig';

const validConfig = (): RecordingConfig => ({
  enabled: false,
  directory: 'data/recordings',
});

describe('recording configuration', () => {
  it('accepts a valid disabled configuration', () => {
    expect(() => validateRecordingConfig(validConfig())).not.toThrow();
  });

  it('accepts a valid enabled configuration', () => {
    expect(() =>
      validateRecordingConfig({ ...validConfig(), enabled: true }),
    ).not.toThrow();
  });

  it('rejects an empty recording directory', () => {
    expect(() =>
      validateRecordingConfig({ ...validConfig(), directory: '   ' }),
    ).toThrow('recording.directory');
  });

  it('rejects a non-boolean enabled value', () => {
    expect(() =>
      validateRecordingConfig({
        ...validConfig(),
        enabled: 'yes' as unknown as boolean,
      }),
    ).toThrow('recording.enabled');
  });
});
