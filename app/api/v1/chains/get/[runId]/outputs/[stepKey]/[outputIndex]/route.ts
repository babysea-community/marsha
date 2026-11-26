import type { NextRequest } from 'next/server';

import {
  assertRunAccess,
  authenticateRequest,
  parseSchema,
  routeParams,
} from '@/lib/api';
import { createDataUrlOutputResponse } from '@/lib/chains/output-files';
import { RunIdSchema } from '@/lib/chains/schemas';
import { AppError } from '@/lib/utils/errors';
import { jsonError } from '@/lib/security/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const runtime = 'nodejs';

type RouteContext = {
  params:
    | Promise<{ outputIndex: string; runId: string; stepKey: string }>
    | { outputIndex: string; runId: string; stepKey: string };
};

/**
 * GET /api/v1/chains/get/:runId/outputs/:stepKey/:outputIndex
 *
 * Serves inline provider outputs that are stored as data URLs without placing
 * those media bytes inside the run JSON response.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { outputIndex, runId, stepKey } = await routeParams(context.params);
    const parsedRunId = parseSchema(RunIdSchema, runId, 'invalid_run_id');
    const parsedOutputIndex = parseOutputIndex(outputIndex);
    const { principal, store } = await authenticateRequest(
      request,
      'chains:read',
    );
    const record = await store.getRunWithSteps(parsedRunId);

    if (!record) {
      throw new AppError('run_not_found', 'Chain run was not found.', 404);
    }

    assertRunAccess(record.run, principal);

    const step = record.steps.find(
      (candidate) => candidate.stepKey === stepKey,
    );
    const outputFile = step?.outputFiles[parsedOutputIndex];

    if (!outputFile) {
      throw new AppError(
        'output_not_found',
        'Chain output file was not found.',
        404,
      );
    }

    const response = createDataUrlOutputResponse(outputFile);

    if (!response) {
      throw new AppError(
        'output_not_available',
        'Chain output file is not available through this endpoint.',
        404,
      );
    }

    return response;
  } catch (error) {
    return await jsonError(error);
  }
}

function parseOutputIndex(value: string) {
  if (!/^\d+$/.test(value)) {
    throw new AppError(
      'invalid_output_index',
      'Output index must be a non-negative integer.',
      400,
    );
  }

  return Number(value);
}
