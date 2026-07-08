import { getChainTemplateSummaries } from '@/lib/chains/templates';
import { jsonOk } from '@/lib/security/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return jsonOk(
    {
      object: 'list',
      data: getChainTemplateSummaries(),
      has_more: false,
      url: '/api/v1/chains',
    },
    noStore(),
  );
}

function noStore() {
  return {
    headers: {
      'cache-control': 'no-store',
    },
  } satisfies ResponseInit;
}
