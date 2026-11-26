import 'server-only';

import { AppError } from '@/lib/utils/errors';
import {
  lookupModel,
  lookupRawProviderModel,
} from '@/lib/models/model-library';
import type { ModelProvider } from '@/lib/models/model-catalog';
import { getEnv } from '@/lib/utils/env';

import { createBabySeaProvider } from './babysea';
import { createAlibabaCloudProvider } from './alibabacloud';
import { createBflProvider } from './bfl';
import { createBytePlusProvider } from './byteplus';
import { createGoogleProvider } from './google';
import { createOpenAiProvider } from './openai';
import { createRunwayProvider } from './runway';
import {
  BYOK_PROVIDER_NAMES,
  type ByokProviderName,
  type ByokRunConfig,
  type Provider,
  type ProviderName,
} from './types';

import type { BabySea } from 'babysea';

export type {
  ByokProviderName,
  ByokRunConfig,
  Provider,
  ProviderName,
} from './types';

/**
 * Optional per-call overrides for `getProvider`. The runner passes its
 * dependency-injected BabySea client through this so unit tests can swap the
 * upstream client without re-implementing `createBabySeaClient()`.
 */
export type ProviderOverrides = {
  babysea?: BabySea;
};

export function resolveServerByokConfig(): ByokRunConfig | null {
  const env = getEnv();
  const providers = configuredByokProviders(env);

  if (env.APP_PROVIDER_MODE !== 'byok') {
    return null;
  }

  if (providers.length === 0) {
    throw new AppError(
      'byok_not_configured',
      'APP_PROVIDER_MODE=byok requires DASHSCOPE_API_KEY, BFL_API_KEY, ARK_API_KEY, GEMINI_API_KEY or GOOGLE_API_KEY, OPENAI_API_KEY, or RUNWAYML_API_SECRET on the server.',
      500,
    );
  }

  return { mode: 'server_env', providers };
}

export function readByokRunConfig(value: unknown): ByokRunConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;

  if (candidate.mode !== 'server_env' || !Array.isArray(candidate.providers)) {
    return null;
  }

  const providers = candidate.providers.filter(
    (provider): provider is ByokProviderName =>
      typeof provider === 'string' &&
      BYOK_PROVIDER_NAMES.includes(provider as ByokProviderName),
  );

  return providers.length > 0 ? { mode: 'server_env', providers } : null;
}

function configuredByokProviders(env: ReturnType<typeof getEnv>) {
  const providers: ByokProviderName[] = [];

  if (env.DASHSCOPE_API_KEY) {
    providers.push('alibabacloud');
  }

  if (env.BFL_API_KEY) {
    providers.push('bfl');
  }

  if (env.ARK_API_KEY) {
    providers.push('byteplus');
  }

  if (env.GOOGLE_API_KEY || env.GEMINI_API_KEY) {
    providers.push('google');
  }

  if (env.OPENAI_API_KEY) {
    providers.push('openai');
  }

  if (env.RUNWAYML_API_SECRET) {
    providers.push('runway');
  }

  return providers;
}

export type ProviderResolution = {
  provider: ProviderName;
  modelIdentifier: string;
};

export type ProviderResolutionOptions = {
  byokMode?: boolean;
};

/**
 * Decide which provider handles a given model identifier.
 *
 *   - In BYOK mode, any Semantic Lady model id is rewritten to its published
 *     provider model id and routed to the matching adapter.
 *   - In BabySea mode, registered BabySea model identifiers stay on the
 *     BabySea SDK path and keep the public `generation_*` request shape.
 *   - In BYOK mode, raw `black-forest-labs/<endpoint>`, `byteplus/<model>`,
 *     `alibaba-cloud/<model>`, `google/<model>`, `openai/<model>`, and `runway/<model>` identifiers route directly
 *     only when the provider model id is published by Semantic Lady. The older
 *     `bfl/*` and `alibabacloud/*` prefixes remain accepted as aliases.
 *   - anything outside the Semantic Lady catalog is rejected.
 *
 * The library lookup runs first so registered BabySea names do not fall
 * through to raw prefix passthrough while running in BabySea mode.
 */
export function resolveProvider(
  modelIdentifier: string,
  options: ProviderResolutionOptions = {},
): ProviderResolution {
  if (!modelIdentifier || typeof modelIdentifier !== 'string') {
    throw new AppError(
      'invalid_model_identifier',
      'Model identifier must be a non-empty string.',
      400,
    );
  }

  const routed = lookupModel(modelIdentifier);
  if (routed) {
    if (!options.byokMode) {
      if (routed.babyseaCompatible === false) {
        throw new AppError(
          'byok_credentials_missing',
          `Model "${modelIdentifier}" is supported by the app only in server-side BYOK mode. Set APP_PROVIDER_MODE=byok and configure the matching provider API key on the app server.`,
          400,
        );
      }

      return { provider: 'babysea', modelIdentifier };
    }

    const provider = providerNameForModelProvider(routed.provider);

    return {
      provider,
      modelIdentifier: `${provider}/${routed.rawId}`,
    };
  }

  if (
    modelIdentifier.startsWith('alibabacloud/') ||
    modelIdentifier.startsWith('alibaba-cloud/') ||
    modelIdentifier.startsWith('bfl/') ||
    modelIdentifier.startsWith('black-forest-labs/') ||
    modelIdentifier.startsWith('byteplus/') ||
    modelIdentifier.startsWith('google/') ||
    modelIdentifier.startsWith('openai/') ||
    modelIdentifier.startsWith('runway/')
  ) {
    const rawModel = lookupRawProviderModel(modelIdentifier);

    if (!rawModel) {
      throw new AppError(
        'unsupported_model_identifier',
        `Provider model "${modelIdentifier}" is not in the Semantic Lady model catalog. Use GET /api/v1/models for supported models.`,
        400,
      );
    }

    if (!options.byokMode) {
      throw new AppError(
        'byok_credentials_missing',
        `Provider model "${modelIdentifier}" requires server-side BYOK mode. Set APP_PROVIDER_MODE=byok and configure the matching provider API key on the app server.`,
        400,
      );
    }

    const provider = providerNameForModelProvider(rawModel.provider);

    return {
      provider,
      modelIdentifier: `${provider}/${rawModel.rawId}`,
    };
  }

  throw new AppError(
    'unsupported_model_identifier',
    `Model "${modelIdentifier}" is not in the Semantic Lady model catalog. Use GET /api/v1/models for supported models.`,
    400,
  );
}

function providerNameForModelProvider(
  provider: ModelProvider,
): ByokProviderName {
  switch (provider) {
    case 'alibaba-cloud':
      return 'alibabacloud';
    case 'black-forest-labs':
      return 'bfl';
    case 'byteplus':
      return 'byteplus';
    case 'google':
      return 'google';
    case 'openai':
      return 'openai';
    case 'runway':
      return 'runway';
    default: {
      const exhaustive: never = provider;
      return exhaustive;
    }
  }
}

/**
 * Build (or fetch from cache) a Provider instance for a resolution.
 *
 * Direct providers use server-side env keys (`BFL_API_KEY`, `ARK_API_KEY`,
 * `DASHSCOPE_API_KEY`, `GEMINI_API_KEY` or `GOOGLE_API_KEY`,
 * `OPENAI_API_KEY`, `RUNWAYML_API_SECRET`).
 * The public API request only authenticates to the app itself.
 */
export function getProvider(
  resolution: ProviderResolution,
  byokConfig: ByokRunConfig | null,
  overrides?: ProviderOverrides,
): Provider {
  const byokMode = byokConfig !== null;

  switch (resolution.provider) {
    case 'babysea':
      if (byokMode) {
        throw new AppError(
          'byok_credentials_missing',
          `Model "${resolution.modelIdentifier}" routes to the BabySea SDK provider, which is not BYOK-compatible with this server-side BYOK run. Use an Alibaba Cloud, BFL, BytePlus, Google, OpenAI, or Runway-backed model or set APP_PROVIDER_MODE=babysea.`,
          400,
        );
      }
      return createBabySeaProvider(overrides?.babysea);
    case 'alibabacloud': {
      if (!byokConfig || !byokConfig.providers.includes('alibabacloud')) {
        throw new AppError(
          'byok_credentials_missing',
          `Model "${resolution.modelIdentifier}" requires DASHSCOPE_API_KEY on the the app server.`,
          400,
        );
      }
      const env = getEnv();
      const apiKey = env.DASHSCOPE_API_KEY;
      if (!apiKey) {
        throw new AppError(
          'byok_credentials_missing',
          `Model "${resolution.modelIdentifier}" requires DASHSCOPE_API_KEY on the the app server.`,
          400,
        );
      }
      return createAlibabaCloudProvider({
        apiKey,
      });
    }
    case 'bfl': {
      if (!byokConfig || !byokConfig.providers.includes('bfl')) {
        throw new AppError(
          'byok_credentials_missing',
          `Model "${resolution.modelIdentifier}" requires BFL_API_KEY on the the app server.`,
          400,
        );
      }
      const env = getEnv();
      const apiKey = env.BFL_API_KEY;
      if (!apiKey) {
        throw new AppError(
          'byok_credentials_missing',
          `Model "${resolution.modelIdentifier}" requires BFL_API_KEY on the the app server.`,
          400,
        );
      }
      return createBflProvider({
        apiKey,
        region: env.BFL_REGION,
        baseUrl: env.BFL_API_BASE_URL,
      });
    }
    case 'byteplus': {
      if (!byokConfig || !byokConfig.providers.includes('byteplus')) {
        throw new AppError(
          'byok_credentials_missing',
          `Model "${resolution.modelIdentifier}" requires ARK_API_KEY on the the app server.`,
          400,
        );
      }
      const env = getEnv();
      const apiKey = env.ARK_API_KEY;
      if (!apiKey) {
        throw new AppError(
          'byok_credentials_missing',
          `Model "${resolution.modelIdentifier}" requires ARK_API_KEY on the the app server.`,
          400,
        );
      }
      return createBytePlusProvider({
        apiKey,
      });
    }
    case 'google': {
      if (!byokConfig || !byokConfig.providers.includes('google')) {
        throw new AppError(
          'byok_credentials_missing',
          `Model "${resolution.modelIdentifier}" requires GEMINI_API_KEY or GOOGLE_API_KEY on the the app server.`,
          400,
        );
      }
      const env = getEnv();
      const apiKey = env.GOOGLE_API_KEY ?? env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new AppError(
          'byok_credentials_missing',
          `Model "${resolution.modelIdentifier}" requires GEMINI_API_KEY or GOOGLE_API_KEY on the the app server.`,
          400,
        );
      }
      return createGoogleProvider({
        apiKey,
      });
    }
    case 'openai': {
      if (!byokConfig || !byokConfig.providers.includes('openai')) {
        throw new AppError(
          'byok_credentials_missing',
          `Model "${resolution.modelIdentifier}" requires OPENAI_API_KEY on the the app server.`,
          400,
        );
      }
      const env = getEnv();
      const apiKey = env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new AppError(
          'byok_credentials_missing',
          `Model "${resolution.modelIdentifier}" requires OPENAI_API_KEY on the the app server.`,
          400,
        );
      }
      return createOpenAiProvider({
        apiKey,
      });
    }
    case 'runway': {
      if (!byokConfig || !byokConfig.providers.includes('runway')) {
        throw new AppError(
          'byok_credentials_missing',
          `Model "${resolution.modelIdentifier}" requires RUNWAYML_API_SECRET on the the app server.`,
          400,
        );
      }
      const env = getEnv();
      const apiKey = env.RUNWAYML_API_SECRET;
      if (!apiKey) {
        throw new AppError(
          'byok_credentials_missing',
          `Model "${resolution.modelIdentifier}" requires RUNWAYML_API_SECRET on the the app server.`,
          400,
        );
      }
      return createRunwayProvider({
        apiKey,
      });
    }
    default: {
      const exhaustive: never = resolution.provider;
      throw new AppError(
        'invalid_provider',
        `Unsupported provider: ${String(exhaustive)}`,
        500,
      );
    }
  }
}
