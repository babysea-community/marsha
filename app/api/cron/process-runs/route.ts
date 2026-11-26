import type { NextRequest } from 'next/server';

import { parseSchema, readJsonBody } from '@/lib/api';
import { processRun } from '@/lib/chains/runner';
import { CronRequestSchema } from '@/lib/chains/schemas';
import { createChainStore } from '@/lib/chains/store';
import { getEnv } from '@/lib/utils/env';
import { AppError, toErrorMessage } from '@/lib/utils/errors';
import { jsonEnvelopeOk, jsonError } from '@/lib/security/http';

export const dynamic = 'force-dynamic';
// Keep in sync with APP_SDK_ROUTE_MAX_DURATION_SECONDS.
// The starter keeps this at 300 for broad Vercel compatibility. Raise it only
// on deployments whose plan supports a higher route duration.
export const maxDuration = 300;
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return handleCron(request, readLimitFromQuery(request));
}

export async function POST(request: NextRequest) {
  try {
    return await handleCron(request, await readJsonBody(request));
  } catch (error) {
    return await jsonError(error);
  }
}

async function handleCron(request: NextRequest, rawInput: unknown) {
  try {
    const env = getEnv();

    if (!env.APP_CRON_SECRET) {
      throw new AppError(
        'cron_not_configured',
        'APP_CRON_SECRET is required.',
        500,
      );
    }

    if (
      request.headers.get('authorization') !== `Bearer ${env.APP_CRON_SECRET}`
    ) {
      throw new AppError('unauthorized', 'Invalid cron token.', 401);
    }

    const input = parseSchema(CronRequestSchema, rawInput);
    const store = createChainStore();
    const runs = await store.findRunsToProcess(input.limit);
    const processed: Array<{
      id: string;
      status: string;
      error?: string;
    }> = [];

    // Isolate per-run failures so a single transient BabySea/database error
    // does not abort processing of the remaining runs in this batch.
    for (const run of runs) {
      try {
        const record = await processRun(run, { store });
        processed.push({ id: record.run.id, status: record.run.status });
      } catch (error) {
        processed.push({
          id: run.run.id,
          status: run.run.status,
          error: toErrorMessage(error).slice(0, 500),
        });
      } finally {
        // Release the processing lease so the next pass can advance the run
        // immediately; a crashed pass's lease expires on its own.
        await store.releaseRunClaim(run.run.id).catch(() => {});
      }
    }

    // Best-effort retention pruning; never let it block run processing.
    await store.pruneExpiredRecords().catch(() => {});

    return jsonEnvelopeOk(
      { processed, processed_count: processed.length },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return await jsonError(error);
  }
}

function readLimitFromQuery(request: NextRequest) {
  return {
    limit: request.nextUrl.searchParams.get('limit') ?? undefined,
  };
}
