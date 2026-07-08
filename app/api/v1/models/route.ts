import { listModelSchemaSummaries } from '@/lib/models/model-library';
import { jsonError, jsonOk } from '@/lib/security/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    return jsonOk(
      {
        object: 'list',
        data: listModelSchemaSummaries(),
        has_more: false,
        url: '/api/v1/models',
      },
      noStore(),
    );
  } catch (error) {
    return jsonError(error);
  }
}

function noStore() {
  return {
    headers: {
      'cache-control': 'no-store',
    },
  } satisfies ResponseInit;
}
