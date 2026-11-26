import { beforeAll, describe, expect, it } from 'vitest';

import { authenticateApiKey } from '@/lib/api/auth';

describe('api auth', () => {
  beforeAll(() => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://your-domain.example.com';
    process.env.BABYSEA_API_KEY = 'bye_test';
    process.env.BABYSEA_REGION = 'us';
    process.env.BABYSEA_API_BASE_URL = 'https://api.us.babysea.ai';
    process.env.APP_API_KEY = 'bchn_alpha,bchn_beta';
    process.env.BABYSEA_WEBHOOK_SECRET = 'whsec_test';
    process.env.APP_CALLBACK_SECRET = 'cbsec_test';
    process.env.APP_CRON_SECRET = 'cron_test';
    process.env.DATABASE_URL =
      'postgresql://postgres:postgres@localhost:5432/postgres';
  });

  it('accepts environment configured API keys', async () => {
    const principal = await authenticateApiKey(
      'Bearer bchn_alpha',
      {
        verifyApiKey: async () => null,
      },
      'chains:run',
    );

    expect(principal.apiKeyId).toBeNull();
    expect(principal.name).toBe('env-api-key');
    expect(principal.scopes).toContain('chains:run');
  });

  it('rejects missing bearer tokens', async () => {
    await expect(
      authenticateApiKey(
        null,
        {
          verifyApiKey: async () => null,
        },
        'chains:run',
      ),
    ).rejects.toMatchObject({ code: 'missing_api_key', status: 401 });
  });

  it('accepts database verified API keys', async () => {
    const principal = await authenticateApiKey(
      'Bearer bchn_db_key',
      {
        verifyApiKey: async () => ({
          id: '4a828963-4e0a-4f12-90ab-dcb0f5dc6c0e',
          keyPrefix: 'bchn_db_key',
          name: 'database-key',
          scopes: ['chains:read'],
        }),
      },
      'chains:read',
    );

    expect(principal.apiKeyId).toBe('4a828963-4e0a-4f12-90ab-dcb0f5dc6c0e');
    expect(principal.name).toBe('database-key');
  });
});
