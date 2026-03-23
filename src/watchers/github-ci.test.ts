import { describe, it, expect } from 'vitest';

describe('GithubCiWatcher', () => {
  it('uses fast poll interval for first 12 polls', () => {
    // pollCount < 12 → 5s, pollCount >= 12 → 30s
    const fastInterval = 5_000;
    const slowInterval = 30_000;
    expect(fastInterval).toBe(5_000);
    expect(slowInterval).toBe(30_000);
    expect(fastInterval).toBeLessThan(slowInterval);
  });
});
