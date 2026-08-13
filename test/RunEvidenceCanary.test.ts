import { describe, expect, it } from 'vitest';

import {
  isRetryableCanaryInspectionError,
  readCanaryInspectionSeconds,
} from '../src/tools/runEvidenceCanary';

describe('runEvidenceCanary live inspection controls', () => {
  it('keeps the existing five-second inspection interval by default', () => {
    expect(readCanaryInspectionSeconds([])).toBe(5);
  });

  it('accepts a slower inspection interval for long unattended soaks', () => {
    expect(readCanaryInspectionSeconds(['--inspection-seconds', '300'])).toBe(
      300,
    );
  });

  it('rejects invalid inspection intervals', () => {
    expect(() =>
      readCanaryInspectionSeconds(['--inspection-seconds', '1']),
    ).toThrow('--inspection-seconds must be an integer from 5 to 3600');
  });

  it('treats only stable-snapshot contention as retryable', () => {
    expect(
      isRetryableCanaryInspectionError(
        new Error(
          'Evidence sources changed repeatedly during inspection; retry the read',
        ),
      ),
    ).toBe(true);
    expect(isRetryableCanaryInspectionError(new Error('real failure'))).toBe(
      false,
    );
  });
});
