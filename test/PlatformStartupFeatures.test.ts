import { describe, expect, it } from 'vitest';
import { resolvePlatformStartupFeatures } from '../src/tools/startPlatformOrchestrator';

describe('resolvePlatformStartupFeatures', () => {
  it('keeps normal startup lean with research and Docker disabled', () => {
    expect(resolvePlatformStartupFeatures([])).toEqual({
      mode: 'PAPER',
      development: false,
      withDatabase: false,
      withResearch: false,
      noBrowser: false,
    });
  });

  it('enables the existing research runtime only with --with-research', () => {
    const features = resolvePlatformStartupFeatures(['--with-research']);
    expect(features.withResearch).toBe(true);
    expect(features.withDatabase).toBe(false);
    expect(features.mode).toBe('PAPER');
  });

  it('keeps database and research switches independent', () => {
    expect(
      resolvePlatformStartupFeatures(['--with-database', '--with-research']),
    ).toMatchObject({ withDatabase: true, withResearch: true });
    expect(
      resolvePlatformStartupFeatures(['--with-database', '--skip-database']),
    ).toMatchObject({ withDatabase: false, withResearch: false });
  });
});
