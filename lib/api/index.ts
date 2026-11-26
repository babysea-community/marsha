import 'server-only';

import { Buffer } from 'node:buffer';

import type { NextRequest } from 'next/server';
import type { z } from 'zod';

import { authenticateApiKey } from './auth';
import { createChainStore } from '../chains/store';
import type { ApiKeyPrincipal, ChainRunRecord } from '../chains/types';
import { AppError } from '../utils/errors';

export const MAX_JSON_BODY_BYTES = 256 * 1024;

export async function authenticateRequest(
  request: NextRequest,
  requiredScope: string,
) {
  const store = createChainStore();
  const principal = await authenticateApiKey(
    request.headers.get('authorization'),
    store,
    requiredScope,
  );

  return { principal, store };
}

export async function readJsonBody(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);

  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
    throw new AppError('payload_too_large', 'Request body is too large.', 413);
  }

  const body = await request.text();

  if (Buffer.byteLength(body, 'utf8') > MAX_JSON_BODY_BYTES) {
    throw new AppError('payload_too_large', 'Request body is too large.', 413);
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new AppError('invalid_json', 'Request body must be JSON.', 400);
  }
}

export function parseSchema<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown,
  code = 'invalid_request',
) {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new AppError(
      code,
      'Request validation failed.',
      400,
      parsed.error.flatten(),
    );
  }

  return parsed.data as z.infer<TSchema>;
}

export function assertRunAccess(
  run: ChainRunRecord,
  principal: ApiKeyPrincipal,
) {
  if (principal.apiKeyId && run.apiKeyId !== principal.apiKeyId) {
    throw new AppError('run_not_found', 'Chain run was not found.', 404);
  }

  if (
    !principal.apiKeyId &&
    (run.apiKeyId !== null || run.apiKeyPrefix !== principal.keyPrefix)
  ) {
    throw new AppError('run_not_found', 'Chain run was not found.', 404);
  }
}

export function getIdempotencyKey(request: NextRequest) {
  const value = request.headers.get('idempotency-key')?.trim();

  if (!value) {
    return null;
  }

  if (!/^[A-Za-z0-9_.:-]{1,255}$/.test(value)) {
    throw new AppError(
      'invalid_idempotency_key',
      'Idempotency-Key must be 1-255 URL-safe characters.',
      400,
    );
  }

  return value;
}

export function getClientRequestId(request: NextRequest) {
  const value = request.headers.get('x-request-id')?.trim();

  if (!value) {
    return null;
  }

  return /^[A-Za-z0-9_.:-]{1,128}$/.test(value) ? value : null;
}

export async function routeParams<TParams>(params: TParams | Promise<TParams>) {
  return params instanceof Promise ? params : Promise.resolve(params);
}
