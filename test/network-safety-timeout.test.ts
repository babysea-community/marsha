import { afterEach, describe, expect, it, vi } from 'vitest';

describe('network safety DNS timeout', () => {
  afterEach(() => {
    vi.doUnmock('node:dns/promises');
    vi.resetModules();
    vi.useRealTimers();
  });

  it('fails closed when DNS lookup hangs', async () => {
    vi.useFakeTimers();
    vi.doMock('node:dns/promises', () => ({
      lookup: vi.fn(() => new Promise(() => {})),
    }));

    const { lookupAllowedNetworkAddress } =
      await import('@/lib/security/network-safety');
    const lookupResult = lookupAllowedNetworkAddress('cdn.example.com');

    await vi.advanceTimersByTimeAsync(2_000);

    await expect(lookupResult).resolves.toBeNull();
  });
});
