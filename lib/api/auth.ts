import 'server-only';

import { AppError } from '../utils/errors';
import { getAppApiKeys } from '../utils/env';
import { keyPrefix, safeEqualText } from '../security/crypto';
import type { ApiKeyPrincipal } from '../chains/types';

const FULL_ACCESS_SCOPES = ['chains:run', 'chains:read', 'runs:cancel'];

export type StoredApiKey = {
  id: string;
  keyPrefix: string;
  name: string;
  scopes: string[];
};

export type ApiKeyLookupStore = {
  verifyApiKey: (apiKey: string) => Promise<StoredApiKey | null>;
};

export async function authenticateApiKey(
  authorization: string | null,
  store: ApiKeyLookupStore,
  requiredScope: string,
): Promise<ApiKeyPrincipal> {
  const token = parseBearerToken(authorization);

  if (!token) {
    throw new AppError('missing_api_key', 'Missing bearer token.', 401);
  }

  const envPrincipal = authenticateEnvApiKey(token);

  if (envPrincipal) {
    assertScope(envPrincipal, requiredScope);
    return envPrincipal;
  }

  const storedKey = await store.verifyApiKey(token);

  if (!storedKey) {
    throw new AppError('invalid_api_key', 'Invalid API key.', 401);
  }

  const principal: ApiKeyPrincipal = {
    apiKeyId: storedKey.id,
    keyPrefix: storedKey.keyPrefix,
    name: storedKey.name,
    scopes: storedKey.scopes,
  };

  assertScope(principal, requiredScope);

  return principal;
}

function authenticateEnvApiKey(token: string) {
  for (const apiKey of getAppApiKeys()) {
    if (safeEqualText(token, apiKey)) {
      return {
        apiKeyId: null,
        keyPrefix: keyPrefix(token),
        name: 'env-api-key',
        scopes: FULL_ACCESS_SCOPES,
      } satisfies ApiKeyPrincipal;
    }
  }

  return null;
}

function assertScope(principal: ApiKeyPrincipal, requiredScope: string) {
  if (!principal.scopes.includes(requiredScope)) {
    throw new AppError(
      'insufficient_scope',
      `API key is missing required scope: ${requiredScope}.`,
      403,
    );
  }
}

function parseBearerToken(authorization: string | null) {
  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }

  const token = authorization.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}
