import { NextResponse } from 'next/server';

import { AppError, toAppError } from '../utils/errors';
import { getErrorGuidance } from '../utils/error-guidance';
import { captureServerError } from '../monitoring/sentry-server';

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function jsonAccepted<T>(data: T, init?: ResponseInit) {
  return jsonOk(data, { ...init, status: 202 });
}

export function jsonEnvelopeOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(
    {
      status: 'success',
      data,
      timestamp: new Date().toISOString(),
    },
    init,
  );
}

export async function jsonError(error: unknown) {
  const appError = toAppError(error);
  const guidance = getErrorGuidance({
    code: appError.code,
    message: appError.message,
  });

  if (appError.status >= 500) {
    await captureServerError(error, {
      tags: {
        error_code: appError.code,
        status: String(appError.status),
      },
      extra: {
        details: appError.details,
      },
    });
  }

  return NextResponse.json(
    {
      error: {
        type: getErrorType(appError),
        code: appError.code,
        message: appError.message,
        ...(appError.details ? { details: appError.details } : {}),
        ...(guidance ? { guidance } : {}),
      },
    },
    { status: appError.status },
  );
}

function getErrorType(error: AppError) {
  if (error.code === 'idempotency_conflict') {
    return 'idempotency_error';
  }

  if (error.status === 401) {
    return 'authentication_error';
  }

  if (error.status === 403) {
    return 'permission_error';
  }

  if (error.status === 429) {
    return 'rate_limit_error';
  }

  if (error.status >= 500) {
    return 'api_error';
  }

  return 'invalid_request_error';
}

export function assertMethodToken(
  received: string | null,
  expected: string | undefined,
  label: string,
) {
  if (!expected) {
    return;
  }

  if (received !== `Bearer ${expected}`) {
    throw new AppError('unauthorized', `Invalid ${label}.`, 401);
  }
}
