import { describe, expect, it } from 'vitest';

import { shouldAutoStartApp } from '../src/runtime/appAutoStart';

describe('shouldAutoStartApp', () => {
  it('allows the normal application entrypoint to start by default', () => {
    expect(shouldAutoStartApp({})).toBe(true);
  });

  it('prevents a second application runtime during evidence collection', () => {
    expect(shouldAutoStartApp({ OKX_SKIP_AUTO_START: '1' })).toBe(false);
  });

  it('does not treat unrelated values as the explicit stop flag', () => {
    expect(shouldAutoStartApp({ OKX_SKIP_AUTO_START: '0' })).toBe(true);
  });
});
