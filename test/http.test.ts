import { describe, expect, it } from 'vitest';

import { AppError } from '@/lib/utils/errors';
import {
  jsonAccepted,
  jsonEnvelopeOk,
  jsonError,
  jsonOk,
} from '@/lib/security/http';

describe('jsonError', () => {
  it('does not capture expected 4xx errors', async () => {
    const response = await jsonError(
      new AppError('unauthorized', 'Invalid token.', 401),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: {
        type: 'authentication_error',
        code: 'unauthorized',
        message: 'Invalid token.',
      },
    });
  });

  it('classifies idempotency validation as an invalid request', async () => {
    const response = await jsonError(
      new AppError(
        'invalid_idempotency_key',
        'Idempotency-Key must be 1-255 URL-safe characters.',
        400,
      ),
    );

    await expect(response.json()).resolves.toMatchObject({
      error: {
        type: 'invalid_request_error',
        code: 'invalid_idempotency_key',
      },
    });
  });

  it('classifies idempotency conflicts separately', async () => {
    const response = await jsonError(
      new AppError(
        'idempotency_conflict',
        'Idempotency-Key was already used with different run input.',
        409,
      ),
    );

    await expect(response.json()).resolves.toMatchObject({
      error: {
        type: 'idempotency_error',
        code: 'idempotency_conflict',
      },
    });
  });

  it('adds guidance for actionable request errors', async () => {
    const response = await jsonError(
      new AppError(
        'byok_credentials_missing',
        'Model "bfl/flux-1.1-pro" requires BFL_API_KEY on the the app server.',
        400,
      ),
    );

    await expect(response.json()).resolves.toMatchObject({
      error: {
        type: 'invalid_request_error',
        code: 'byok_credentials_missing',
        guidance: {
          summary:
            'The app cannot reach the selected provider with the current server configuration.',
          what_to_try_next: expect.arrayContaining([
            'Set the provider API key required by the selected model, or switch APP_PROVIDER_MODE to babysea.',
          ]),
        },
      },
    });
  });

  it('returns 5xx errors as API errors', async () => {
    const error = new AppError('internal_error', 'Internal error.', 500);
    const response = await jsonError(error);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).not.toHaveProperty('status');
    expect(body).not.toHaveProperty('timestamp');
    expect(body.error.type).toBe('api_error');
    expect(body.error.code).toBe('internal_error');
  });

  it('returns actionable guidance for database network failures', async () => {
    const error = Object.assign(
      new Error('connect ETIMEDOUT 3.215.67.50:5432'),
      {
        address: '3.215.67.50',
        code: 'ETIMEDOUT',
        port: 5432,
        syscall: 'connect',
      },
    );
    const response = await jsonError(error);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toMatchObject({
      type: 'api_error',
      code: 'database_unreachable',
      message:
        'Database is not reachable from this runtime. Check DATABASE_URL, Aurora public access, and security group inbound TCP 5432.',
      details: {
        code: 'ETIMEDOUT',
      },
      guidance: {
        summary: 'The app cannot reach its Aurora PostgreSQL database.',
      },
    });
  });

  it('maps pg pool connection timeouts to database guidance', async () => {
    const response = await jsonError(
      new Error('Connection terminated due to connection timeout'),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toMatchObject({
      type: 'api_error',
      code: 'database_unreachable',
      details: { code: 'CONNECTION_TIMEOUT' },
      guidance: {
        summary: 'The app cannot reach its Aurora PostgreSQL database.',
      },
    });
  });
});

describe('jsonOk', () => {
  it('returns the resource directly without a success envelope', async () => {
    const response = jsonOk({ id: 'run_123', object: 'chain_run' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ id: 'run_123', object: 'chain_run' });
    expect(body).not.toHaveProperty('status');
    expect(body).not.toHaveProperty('data');
    expect(body).not.toHaveProperty('timestamp');
  });

  it('returns accepted resources with a 202 status', async () => {
    const response = jsonAccepted({ id: 'run_123', object: 'chain_run' });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      id: 'run_123',
      object: 'chain_run',
    });
  });

  it('keeps internal acknowledgements on the legacy envelope when requested', async () => {
    const response = jsonEnvelopeOk({ received: true });
    const body = await response.json();

    expect(body).toMatchObject({
      status: 'success',
      data: { received: true },
    });
    expect(body.timestamp).toEqual(expect.any(String));
  });
});
