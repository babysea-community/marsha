import type { NextRequest } from 'next/server';

import { getSession } from '@/lib/auth/owner';
import { createDataUrlOutputResponse } from '@/lib/chains/output-files';
import { RunIdSchema } from '@/lib/chains/schemas';
import { createChainStore } from '@/lib/chains/store';
import { parseSchema, routeParams } from '@/lib/api';
import { jsonError } from '@/lib/security/http';
import { AppError } from '@/lib/utils/errors';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const runtime = 'nodejs';

type RouteContext = {
  params:
    | Promise<{ outputIndex: string; runId: string; stepKey: string }>
    | { outputIndex: string; runId: string; stepKey: string };
};

/**
 * Dashboard preview route for inline provider outputs. Public API clients use
 * the bearer-authenticated /api/v1 output URL; browser media tags use this
 * owner-session route because they cannot attach Authorization headers.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const session = await getSession();

    if (!session) {
      throw new AppError(
        'missing_session',
        'Login is required to view this output.',
        401,
      );
    }

    const { outputIndex, runId, stepKey } = await routeParams(context.params);
    const parsedRunId = parseSchema(RunIdSchema, runId, 'invalid_run_id');
    const parsedOutputIndex = parseOutputIndex(outputIndex);
    const store = createChainStore();
    const record = await store.getRunWithSteps(parsedRunId);

    if (!record) {
      throw new AppError('run_not_found', 'Chain run was not found.', 404);
    }

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
