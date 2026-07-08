import 'server-only';

import { lookupAllowedNetworkAddress } from '@/lib/security/network-safety';
import type { JsonObject, JsonValue } from '@/lib/chains/types';
import { getMediaDrivenModelVariant } from '@/lib/models/media-driven-variants';
import { AppError } from '@/lib/utils/errors';

import type {
  Provider,
  ProviderCancelContext,
  ProviderEstimateInput,
  ProviderEstimateResult,
  ProviderGenerationStatus,
  ProviderPollContext,
  ProviderSubmitInput,
  ProviderSubmitResult,
} from './types';

export type RunwayProviderConfig = {
  apiKey: string;
  fetchImpl?: typeof fetch;
};

const RUNWAY_HOST = 'api.dev.runwayml.com';
const RUNWAY_VERSION = '2024-11-06';
const SUBMIT_TIMEOUT_MS = 60_000;
const POLL_TIMEOUT_MS = 10_000;

const RUNWAY_IMAGE_MODELS = new Set(['gen4_image', 'gen4_image_turbo']);
const RUNWAY_IMAGE_TO_VIDEO_MODELS = new Set(['gen4.5', 'gen4_turbo']);
const RUNWAY_VIDEO_TO_VIDEO_MODELS = new Set(['aleph2', 'gen4_aleph']);
const RUNWAY_CHARACTER_MODELS = new Set(['act_two']);

export function createRunwayProvider(config: RunwayProviderConfig): Provider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const baseUrl = `https://${RUNWAY_HOST}`;

  return {
    name: 'runway',

    async estimate(
      input: ProviderEstimateInput,
    ): Promise<ProviderEstimateResult> {
      return {
        model_identifier: input.modelIdentifier,
        model_type: input.stepKind,
        assets_count: input.options.count ?? 1,
        cost_per_generation: 0,
        cost_total_consumed: 0,
        credit_balance: null,
        credit_balance_can_afford: null,
        credit_balance_max_affordable: null,
      };
    },

    async submit(input: ProviderSubmitInput): Promise<ProviderSubmitResult> {
      const model = stripPrefix(input.modelIdentifier, 'runway/');
      assertModelId(model);

      const endpoint = endpointForModel(model, input.stepKind);
      const body = buildSubmitBody({
        model,
        params: input.params as Record<string, unknown>,
        sourceModelIdentifier: input.sourceModelIdentifier,
        stepKey: input.stepKey,
        stepKind: input.stepKind,
      });
      const response = await fetchWithGuards(
        fetchImpl,
        `${baseUrl}${endpoint}`,
        {
          method: 'POST',
          headers: runwayHeaders(config.apiKey),
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
        },
      );
      const payload = (await response.json()) as { id?: string };

      if (!payload.id) {
        throw new AppError(
          'provider_unexpected_response',
          'Runway submit response is missing `id`.',
          502,
        );
      }

      return {
        kind: 'async',
        generationId: payload.id,
        providerOrder: ['runway'],
        providerMetadata: {
          provider: 'runway',
          model,
          endpoint,
          task_id: payload.id,
        },
      };
    },

    async poll(
      context: ProviderPollContext,
    ): Promise<ProviderGenerationStatus> {
      const taskId = readTaskId(context);
      const response = await fetchWithGuards(
        fetchImpl,
        `${baseUrl}/v1/tasks/${encodeURIComponent(taskId)}`,
        {
          method: 'GET',
          headers: runwayHeaders(config.apiKey),
          signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
        },
      );
      const payload = (await response.json()) as RunwayTaskResponse;

      return mapTaskResponseToStatus({
        generationId: context.generationId,
        metadata: context.providerMetadata ?? {},
        payload,
      });
    },

    async cancel(context: ProviderCancelContext): Promise<void> {
      const taskId = readTaskId(context);

      try {
        await fetchWithGuards(
          fetchImpl,
          `${baseUrl}/v1/tasks/${encodeURIComponent(taskId)}`,
          {
            method: 'DELETE',
            headers: runwayHeaders(config.apiKey),
            signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
          },
        );
      } catch (error) {
        if (
          !(error instanceof AppError) ||
          error.code !== 'provider_not_found'
        ) {
          throw error;
        }
      }
    },
  };
}

function endpointForModel(model: string, stepKind: 'image' | 'video') {
  if (stepKind === 'image' && RUNWAY_IMAGE_MODELS.has(model)) {
    return '/v1/text_to_image';
  }

  if (stepKind === 'video' && isRunwayImageToVideoStep(model)) {
    return '/v1/image_to_video';
  }

  if (stepKind === 'video' && RUNWAY_VIDEO_TO_VIDEO_MODELS.has(model)) {
    return '/v1/video_to_video';
  }

  if (stepKind === 'video' && RUNWAY_CHARACTER_MODELS.has(model)) {
    return '/v1/character_performance';
  }

  throw new AppError(
    'invalid_model_identifier',
    `Runway model "${model}" is not valid for a ${stepKind} step.`,
    400,
  );
}

function buildSubmitBody(args: {
  model: string;
  params: Record<string, unknown>;
  sourceModelIdentifier?: string;
  stepKey?: string;
  stepKind: 'image' | 'video';
}): JsonObject {
  const body: JsonObject = { model: args.model };
  const handoffFiles = collectStringValues(args.params.generation_input_file);
  const imageFiles = collectStringValues(
    args.params.generation_input_image_file,
  );
  const inputFiles = [...handoffFiles, ...imageFiles];
  const videoFiles = collectStringValues(
    args.params.generation_input_video_file,
  );

  for (const [rawKey, value] of Object.entries(args.params)) {
    if (value === undefined) continue;
    if (isProviderControlledBodyKey(rawKey)) continue;

    if (
      rawKey === 'generation_prompt' &&
      !RUNWAY_CHARACTER_MODELS.has(args.model)
    ) {
      body.promptText = jsonValue(value);
      continue;
    }

    if (rawKey === 'generation_aspect_ratio') {
      body.ratio = jsonValue(value);
      continue;
    }

    if (
      rawKey === 'generation_duration' &&
      isRunwayImageToVideoStep(args.model)
    ) {
      body.duration = jsonValue(value);
      continue;
    }

    if (rawKey === 'generation_moderation') {
      body.contentModeration = {
        publicFigureThreshold: value === true ? 'auto' : 'low',
      };
      continue;
    }

    if (rawKey === 'generation_seed') {
      body.seed = jsonValue(value);
      continue;
    }

    if (rawKey === 'generation_reference_tag') {
      body.referenceTags = [jsonValue(value)];
      continue;
    }

    if (rawKey === 'generation_body_control') {
      body.bodyControl = jsonValue(value);
      continue;
    }

    if (rawKey === 'generation_expression_intensity') {
      body.expressionIntensity = jsonValue(value);
      continue;
    }

    if (
      rawKey === 'generation_input_file' ||
      rawKey === 'generation_input_image_file' ||
      rawKey === 'generation_input_video_file' ||
      rawKey === 'generation_last_frame' ||
      rawKey === 'generation_output_format' ||
      rawKey === 'generation_output_number' ||
      rawKey === 'generation_provider_order'
    ) {
      continue;
    }
  }

  if (body.ratio === undefined && !isRunwayVideoToVideoStep(args.model)) {
    body.ratio = '1280:720';
  }

  if (args.stepKind === 'image') {
    if (inputFiles.length > 0 && body.referenceImages === undefined) {
      body.referenceImages = inputFiles.map((uri) => ({ uri }));
    }

    return body;
  }

  if (RUNWAY_CHARACTER_MODELS.has(args.model)) {
    const variant = args.sourceModelIdentifier
      ? getMediaDrivenModelVariant(args.sourceModelIdentifier)
      : null;
    const characterFiles =
      variant?.inputKind === 'video' ? handoffFiles : inputFiles;

    if (characterFiles.length > 0 && body.character === undefined) {
      body.character = {
        type: variant?.inputKind === 'video' ? 'video' : 'image',
        uri: characterFiles[0] ?? '',
      };
    }

    if (videoFiles.length > 0 && body.reference === undefined) {
      body.reference = {
        type: 'video',
        uri: videoFiles[0] ?? '',
      };
    }

    return body;
  }

  if (
    isRunwayVideoToVideoStep(args.model) &&
    (videoFiles.length > 0 || inputFiles.length > 0) &&
    body.videoUri === undefined
  ) {
    body.videoUri = videoFiles[0] ?? inputFiles[0] ?? null;
  }

  if (
    isRunwayImageToVideoStep(args.model) &&
    inputFiles.length > 0 &&
    body.promptImage === undefined
  ) {
    body.promptImage = inputFiles[0] ?? null;
  }

  return body;
}

function isRunwayImageToVideoStep(model: string) {
  return RUNWAY_IMAGE_TO_VIDEO_MODELS.has(model);
}

function isRunwayVideoToVideoStep(model: string) {
  return RUNWAY_VIDEO_TO_VIDEO_MODELS.has(model);
}

type RunwayTaskResponse = {
  id?: string;
  status?: string;
  output?: string[] | string | null;
  failure?: string | { message?: string } | null;
  failureCode?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

function mapTaskResponseToStatus(args: {
  generationId: string;
  metadata: JsonObject;
  payload: RunwayTaskResponse;
}): ProviderGenerationStatus {
  const status = args.payload.status ?? '';
  const normalizedStatus = status.toUpperCase();
  const providerMetadata: JsonObject = {
    ...args.metadata,
    last_polled_at: new Date().toISOString(),
    last_status: status || null,
  };

  if (normalizedStatus === 'SUCCEEDED') {
    const outputs = collectOutputs(args.payload.output);

    if (outputs.length === 0) {
      return {
        generation_id: args.generationId,
        generation_status: 'failed',
        generation_provider_used: 'runway',
        generation_error: 'Runway reported SUCCEEDED without output URLs.',
        generation_error_code: 'provider_unexpected_response',
        provider_metadata: providerMetadata,
      };
    }

    return {
      generation_id: args.generationId,
      generation_status: 'succeeded',
      generation_provider_used: 'runway',
      generation_output_file: outputs,
      generation_completed_at:
        args.payload.updatedAt ?? new Date().toISOString(),
      provider_metadata: providerMetadata,
    };
  }

  if (normalizedStatus === 'FAILED') {
    return {
      generation_id: args.generationId,
      generation_status: 'failed',
      generation_provider_used: 'runway',
      generation_error: readFailureMessage(args.payload.failure),
      generation_error_code: args.payload.failureCode ?? 'provider_failed',
      provider_metadata: providerMetadata,
    };
  }

  if (normalizedStatus === 'CANCELED' || normalizedStatus === 'CANCELLED') {
    return {
      generation_id: args.generationId,
      generation_status: 'canceled',
      generation_provider_used: 'runway',
      provider_metadata: providerMetadata,
    };
  }

  return {
    generation_id: args.generationId,
    generation_status: 'processing',
    generation_provider_used: 'runway',
    provider_metadata: providerMetadata,
  };
}

function runwayHeaders(apiKey: string) {
  return {
    accept: 'application/json',
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
    'x-runway-version': RUNWAY_VERSION,
  };
}

async function fetchWithGuards(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
) {
  const parsed = new URL(url);

  if (parsed.protocol !== 'https:') {
    throw new AppError(
      'provider_request_blocked',
      'Runway endpoints must use HTTPS.',
      400,
    );
  }

  if (parsed.hostname.toLowerCase() !== RUNWAY_HOST) {
    throw new AppError(
      'provider_request_blocked',
      'Runway endpoint host is not in the allowlist.',
      400,
    );
  }

  const resolved = await lookupAllowedNetworkAddress(parsed.hostname);
  if (!resolved) {
    throw new AppError(
      'provider_request_blocked',
      'Runway endpoint host resolves to a blocked address.',
      400,
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    throw new AppError(
      'provider_network_error',
      `Runway request failed: ${error instanceof Error ? error.message : 'network error'}`,
      502,
    );
  }

  if (!response.ok) {
    const text = await safeReadText(response);
    throw new AppError(
      mapRunwayErrorCode(response.status),
      `Runway responded ${response.status}${text ? `: ${truncate(text, 500)}` : ''}`,
      response.status === 429 ? 429 : 502,
    );
  }

  return response;
}

function readTaskId(context: ProviderPollContext | ProviderCancelContext) {
  return typeof context.providerMetadata?.task_id === 'string'
    ? context.providerMetadata.task_id
    : context.generationId;
}

function collectStringValues(value: unknown) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return [value.trim()];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function collectOutputs(value: RunwayTaskResponse['output']) {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? [value.trim()] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readFailureMessage(value: RunwayTaskResponse['failure']) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  if (value && typeof value === 'object' && typeof value.message === 'string') {
    return value.message;
  }

  return 'Runway generation failed.';
}

function isProviderControlledBodyKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');

  return (
    normalized === 'callbackurl' ||
    normalized === 'generationcallbackurl' ||
    normalized === 'generationmodel' ||
    normalized === 'model'
  );
}

function stripPrefix(modelIdentifier: string, prefix: string) {
  if (!modelIdentifier.startsWith(prefix)) {
    throw new AppError(
      'invalid_model_identifier',
      `Expected model identifier to start with "${prefix}".`,
      400,
    );
  }

  return modelIdentifier.slice(prefix.length);
}

function assertModelId(value: string) {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value.length === 0) {
    throw new AppError(
      'invalid_model_identifier',
      'Runway model identifier contains invalid characters.',
      400,
    );
  }
}

function mapRunwayErrorCode(status: number) {
  if (status === 401 || status === 403) return 'provider_unauthorized';
  if (status === 404) return 'provider_not_found';
  if (status === 409) return 'provider_invalid_request';
  if (status === 429) return 'provider_rate_limited';
  if (status >= 500) return 'provider_unavailable';
  return 'provider_invalid_request';
}

function jsonValue(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(jsonValue);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        jsonValue(entry),
      ]),
    );
  }

  return null;
}

async function safeReadText(response: Response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
