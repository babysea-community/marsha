import { describe, expect, it } from 'vitest';

import { getInternalApiBaseUrl } from '@/lib/api/internal-url';

describe('getInternalApiBaseUrl', () => {
  it('uses local loopback during development', () => {
    expect(
      getInternalApiBaseUrl({
        NODE_ENV: 'development',
        NEXT_PUBLIC_SITE_URL: 'https://forwarded.example.dev',
      }),
    ).toBe('http://127.0.0.1:3011');
  });

  it('honors a local PORT value', () => {
    expect(
      getInternalApiBaseUrl({
        NODE_ENV: 'development',
        PORT: '3022',
      }),
    ).toBe('http://127.0.0.1:3022');
  });

  it('uses the configured public site URL on Vercel', () => {
    expect(
      getInternalApiBaseUrl({
        NODE_ENV: 'production',
        VERCEL: '1',
        NEXT_PUBLIC_SITE_URL: 'https://app.example.com/',
      }),
    ).toBe('https://app.example.com');
  });

  it('keeps loopback for local production starts', () => {
    expect(
      getInternalApiBaseUrl({
        NODE_ENV: 'production',
        NEXT_PUBLIC_SITE_URL: 'http://localhost:3011',
      }),
    ).toBe('http://127.0.0.1:3011');
  });
});
