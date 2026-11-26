import type { NextRequest } from 'next/server';

import {
  assertRunAccess,
  authenticateRequest,
  parseSchema,
  readJsonBody,
  routeParams,
} from '@/lib/api';
import { serializeRunWithSteps } from '@/lib/chains/presenters';
import { continueAgentRun } from '@/lib/chains/runner';
import {
  ContinueAgentRunRequestSchema,
  RunIdSchema,
} from '@/lib/chains/schemas';
import { AppError } from '@/lib/utils/errors';
import { jsonError, jsonOk } from '@/lib/security/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ runId: string }> | { runId: string };
};

/**
 * POST /api/v1/chains/continue/:runId
 *
 * Approves a Chain Agent Copilot checkpoint and resumes the run.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { runId } = await routeParams(context.params);
    const parsedRunId = parseSchema(RunIdSchema, runId, 'invalid_run_id');
    const { principal, store } = await authenticateRequest(
      request,
      'chains:run',
    );
    const existing = await store.getRunWithSteps(parsedRunId);

    if (!existing) {
      throw new AppError('run_not_found', 'Chain run was not found.', 404);
    }

    assertRunAccess(existing.run, principal);

    const body = await readJsonBody(request);
    const payload = parseSchema(ContinueAgentRunRequestSchema, body);
    const selectedPrompt =
      typeof payload.selected_params.generation_prompt === 'string' &&
      payload.selected_params.generation_prompt.trim().length > 0
        ? payload.selected_params.generation_prompt
        : payload.selected_prompt;
    const selectedParams = {
      ...payload.selected_params,
      generation_prompt: selectedPrompt,
    };
    const record = await continueAgentRun(
      parsedRunId,
      {
        checkpointId: payload.checkpoint_id,
        selectedParams,
        selectedPrompt,
      },
      { store },
    );

    return jsonOk(serializeRunWithSteps(record), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    return await jsonError(error);
  }
}
