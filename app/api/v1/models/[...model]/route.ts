import { routeParams } from '@/lib/api';
import { getModelSchema } from '@/lib/models/model-library';
import { jsonError, jsonOk } from '@/lib/security/http';
import { AppError } from '@/lib/utils/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ model: string[] }> | { model: string[] };
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const params = await routeParams(context.params);
    const modelIdentifier = params.model.join('/');
    const schema = getModelSchema(modelIdentifier);

    if (!schema) {
      throw new AppError('model_not_found', 'Model schema was not found.', 404);
    }

    return jsonOk(schema, noStore());
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
