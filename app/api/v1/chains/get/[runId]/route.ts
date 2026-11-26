import type { NextRequest } from 'next/server';

import {
  assertRunAccess,
  authenticateRequest,
  parseSchema,
  routeParams,
} from '@/lib/api';
import { serializeRunWithSteps } from '@/lib/chains/presenters';
import { processRun } from '@/lib/chains/runner';
import { RunIdSchema } from '@/lib/chains/schemas';
import { AppError } from '@/lib/utils/errors';
import { jsonError, jsonOk } from '@/lib/security/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ runId: string }> | { runId: string };
};

/**
 * GET /api/v1/chains/get/:runId
 *
 * Fetches the current run state. If the run is still in progress (queued or
 * running), it also attempts to advance/process the run before returning the
 * latest state. This merges the old "get" and "process" endpoints into one.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { runId } = await routeParams(context.params);
    const parsedRunId = parseSchema(RunIdSchema, runId, 'invalid_run_id');
    const { principal, store } = await authenticateRequest(
      request,
      'chains:read',
    );
    const record = await store.getRunWithSteps(parsedRunId);

    if (!record) {
      throw new AppError('run_not_found', 'Chain run was not found.', 404);
    }

    assertRunAccess(record.run, principal);

    // If the run is in-flight, advance it. A run that already has a failed or
    // canceled step but has not yet reached a terminal status (for example one
    // parked at `awaiting_agent`) must also be advanced so the failure is
    // escalated: failRun then marks the remaining queued steps `skipped`
    // instead of leaving the next card stuck on `queued`. If the run is
    // terminal but the final callback has not been delivered, retry that
    // delivery opportunistically.
    const isTerminalRun =
      record.run.status === 'succeeded' ||
      record.run.status === 'failed' ||
      record.run.status === 'canceled';

    const hasUnresolvedStepFailure =
      !isTerminalRun &&
      record.steps.some(
        (step) => step.status === 'failed' || step.status === 'canceled',
      );

    const shouldProcess =
      record.run.status === 'queued' ||
      record.run.status === 'running' ||
      hasUnresolvedStepFailure ||
      (Boolean(record.run.callbackUrl) &&
        record.run.callbackStatus !== 'delivered');

    if (shouldProcess) {
      try {
        const advanced = await processRun(record, { store });

        return jsonOk(serializeRunWithSteps(advanced), {
          headers: { 'cache-control': 'no-store' },
        });
      } catch {
        // If processing fails, still return the current state.
      }
    }

    return jsonOk(serializeRunWithSteps(record), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return await jsonError(error);
  }
}
