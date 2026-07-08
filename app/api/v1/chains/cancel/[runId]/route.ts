import type { NextRequest } from 'next/server';

import {
  assertRunAccess,
  authenticateRequest,
  parseSchema,
  routeParams,
} from '@/lib/api';
import { serializeRunWithSteps } from '@/lib/chains/presenters';
import { cancelRun } from '@/lib/chains/runner';
import { RunIdSchema } from '@/lib/chains/schemas';
import { AppError } from '@/lib/utils/errors';
import { jsonError, jsonOk } from '@/lib/security/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ runId: string }> | { runId: string };
};

/**
 * POST /api/v1/chains/cancel/:runId
 *
 * Cancels a running or queued chain run.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { runId } = await routeParams(context.params);
    const parsedRunId = parseSchema(RunIdSchema, runId, 'invalid_run_id');
    const { principal, store } = await authenticateRequest(
      request,
      'runs:cancel',
    );
    const existing = await store.getRunWithSteps(parsedRunId);

    if (!existing) {
      throw new AppError('run_not_found', 'Chain run was not found.', 404);
    }

    assertRunAccess(existing.run, principal);

    const record = await cancelRun(parsedRunId, { store });

    return jsonOk(serializeRunWithSteps(record), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return await jsonError(error);
  }
}
