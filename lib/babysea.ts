import 'server-only';

import { BabySea } from 'babysea';

import { APP_SDK_REQUEST_TIMEOUT_MS } from './chains/shared-constants';
import { getEnv } from './utils/env';
import { AppError } from './utils/errors';

/**
 * Build a BabySea SDK client. Throws `babysea_not_configured` (400) if the
 * deployment did not set `BABYSEA_API_KEY`/`BABYSEA_API_BASE_URL`. BYOK-only
 * deployments (BFL + BytePlus direct) can leave these unset and avoid ever
 * calling this helper.
 */
export function createBabySeaClient() {
  const env = getEnv();

  if (!env.BABYSEA_API_KEY || !env.BABYSEA_API_BASE_URL) {
    throw new AppError(
      'babysea_not_configured',
      'This the app deployment did not configure the BabySea SDK. Set BABYSEA_API_KEY and BABYSEA_API_BASE_URL, or use a model identifier prefixed with `bfl/` or `byteplus/`.',
      400,
    );
  }

  return new BabySea({
    apiKey: env.BABYSEA_API_KEY,
    baseUrl: env.BABYSEA_API_BASE_URL.trim(),
    maxRetries: 2,
    timeout: APP_SDK_REQUEST_TIMEOUT_MS,
  });
}

/**
 * Return `true` when the deployment has BabySea SDK credentials configured.
 */
export function isBabySeaConfigured() {
  const env = getEnv();
  return Boolean(env.BABYSEA_API_KEY && env.BABYSEA_API_BASE_URL);
}
