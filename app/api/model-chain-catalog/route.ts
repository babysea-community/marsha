import type { NextRequest } from 'next/server';

import { listModelChainCatalogPage } from '@/lib/chains/catalog';
import { jsonError, jsonOk } from '@/lib/security/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parsePositiveInteger(searchParams.get('page'), 1);
    const pageSize = parsePositiveInteger(searchParams.get('pageSize'), 25);
    const query = (searchParams.get('q') ?? '').slice(0, 120);

    return jsonOk(listModelChainCatalogPage({ page, pageSize, query }), {
      headers: {
        'cache-control': 'public, max-age=60, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

function parsePositiveInteger(value: string | null, fallback: number) {
  if (!value) return fallback;

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
