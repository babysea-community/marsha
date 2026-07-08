import 'server-only';

import { lookupAllowedNetworkAddress } from '@/lib/security/network-safety';
import type { JsonObject, JsonValue } from '@/lib/chains/types';
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

export type GoogleProviderConfig = {
  apiKey: string;
  fetchImpl?: typeof fetch;
};

const GOOGLE_HOST = 'generativelanguage.googleapis.com';
const GOOGLE_DOWNLOAD_HOSTS = new Set([GOOGLE_HOST, 'storage.googleapis.com']);
const SUBMIT_TIMEOUT_MS = 180_000;
const POLL_TIMEOUT_MS = 30_000;

const GEMINI_IMAGE_MODELS = new Set([
  'gemini-3.1-flash-image',
  'gemini-3-pro-image',
  'gemini-2.5-flash-image',
]);
const IMAGEN_IMAGE_MODELS = new Set([
  'imagen-4.0-generate-001',
  'imagen-4.0-ultra-generate-001',
  'imagen-4.0-fast-generate-001',
]);
const VEO_VIDEO_MODELS = new Set([
  'veo-3.1-generate-preview',
  'veo-3.1-fast-generate-preview',
  'veo-3.1-lite-generate-preview',
]);

export function createGoogleProvider(config: GoogleProviderConfig): Provider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const baseUrl = `https://${GOOGLE_HOST}/v1beta`;

  return {
    name: 'google',

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
      const model = stripPrefix(input.modelIdentifier, 'google/');
      assertModelId(model);

      if (input.stepKind === 'image' && GEMINI_IMAGE_MODELS.has(model)) {
        return submitSyncImage({
          fetchImpl,
          apiKey: config.apiKey,
          idempotencyKey: input.idempotencyKey,
          model,
          params: input.params as Record<string, unknown>,
          url: `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
          kind: 'gemini_image',
        });
      }

      if (input.stepKind === 'image' && IMAGEN_IMAGE_MODELS.has(model)) {
        return submitSyncImage({
          fetchImpl,
          apiKey: config.apiKey,
          idempotencyKey: input.idempotencyKey,
          model,
          params: input.params as Record<string, unknown>,
          url: `${baseUrl}/models/${encodeURIComponent(model)}:predict`,
          kind: 'imagen',
        });
      }

      if (input.stepKind === 'video' && VEO_VIDEO_MODELS.has(model)) {
        const body = await buildVeoVideoBody(
          model,
          input.params as Record<string, unknown>,
          fetchImpl,
        );
        const response = await fetchWithGuards(
          fetchImpl,
          `${baseUrl}/models/${encodeURIComponent(model)}:predictLongRunning`,
          {
            method: 'POST',
            headers: googleHeaders(config.apiKey),
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
          },
        );
        const payload = (await response.json()) as GoogleOperationResponse;
        const operationName = payload.name;

        if (!operationName) {
          throw new AppError(
            'provider_unexpected_response',
            'Google video response is missing operation name.',
            502,
          );
        }

        return {
          kind: 'async',
          generationId: operationName,
          providerOrder: ['google'],
          providerMetadata: {
            kind: 'video_operation',
            model,
            operation_name: operationName,
            provider: 'google',
          },
        };
      }

      throw new AppError(
        'invalid_model_identifier',
        `Google model "${model}" is not valid for a ${input.stepKind} step.`,
        400,
      );
    },

    async poll(
      context: ProviderPollContext,
    ): Promise<ProviderGenerationStatus> {
      const operationName = readOperationName(context);
      const response = await fetchWithGuards(
        fetchImpl,
        `${baseUrl}/${operationName.replace(/^\/?v1beta\//, '')}`,
        {
          method: 'GET',
          headers: googleHeaders(config.apiKey),
          signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
        },
      );
      const payload = (await response.json()) as GoogleOperationResponse;

      return mapOperationResponseToStatus({
        apiKey: config.apiKey,
        fetchImpl,
        generationId: context.generationId,
        metadata: context.providerMetadata ?? {},
        payload,
      });
    },

    async cancel(_context: ProviderCancelContext): Promise<void> {
      return;
    },
  };
}

async function submitSyncImage(args: {
  apiKey: string;
  fetchImpl: typeof fetch;
  idempotencyKey: string;
  kind: 'gemini_image' | 'imagen';
  model: string;
  params: Record<string, unknown>;
  url: string;
}): Promise<ProviderSubmitResult> {
  const body =
    args.kind === 'gemini_image'
      ? buildGeminiImageBody(args.params)
      : buildImagenImageBody(args.params);
  const response = await fetchWithGuards(args.fetchImpl, args.url, {
    method: 'POST',
    headers: googleHeaders(args.apiKey),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
  });
  const payload = (await response.json()) as GoogleImageResponse;
  const outputFiles = collectImageDataUrls(payload);

  if (outputFiles.length === 0) {
    throw new AppError(
      'provider_unexpected_response',
      'Google image response contained no image outputs.',
      502,
    );
  }

  const completedAt = new Date().toISOString();

  return {
    kind: 'completed',
    generationId: `google_${args.idempotencyKey}`,
    providerOrder: ['google'],
    providerUsed: 'google',
    outputFiles,
    providerMetadata: {
      completed_at: completedAt,
      kind: args.kind,
      model: args.model,
      output_files: outputFiles,
      provider: 'google',
    },
  };
}

function buildGeminiImageBody(params: Record<string, unknown>): JsonObject {
  const body: JsonObject = {};
  const generationConfig: JsonObject = {};
  const prompt = readPrompt(params);
  const parts: JsonObject[] = [{ text: prompt }];

  for (const value of [
    ...collectStringValues(params.generation_input_file),
    ...collectStringValues(params.generation_input_image_file),
  ]) {
    parts.push(toGoogleMediaPart(value));
  }

  body.contents = [{ role: 'user', parts }];

  const imageConfig = readObject(generationConfig.imageConfig);

  if (params.generation_aspect_ratio !== undefined) {
    imageConfig.aspectRatio = jsonValue(params.generation_aspect_ratio);
  }

  if (params.generation_resolution !== undefined) {
    imageConfig.imageSize = jsonValue(params.generation_resolution);
  }

  if (Object.keys(imageConfig).length > 0) {
    generationConfig.imageConfig = imageConfig;
  }

  if (!hasResponseModalities(generationConfig)) {
    generationConfig.responseModalities = ['IMAGE'];
  }

  body.generationConfig = generationConfig;

  return body;
}

function buildImagenImageBody(params: Record<string, unknown>): JsonObject {
  const body: JsonObject = {};
  const parameters: JsonObject = {};
  const prompt = readPrompt(params);
  body.instances = [{ prompt }];

  if (params.generation_output_number !== undefined) {
    parameters.sampleCount = jsonValue(params.generation_output_number);
  }

  if (params.generation_aspect_ratio !== undefined) {
    parameters.aspectRatio = jsonValue(params.generation_aspect_ratio);
  }

  if (params.generation_resolution !== undefined) {
    parameters.imageSize = jsonValue(params.generation_resolution);
  }

  if (Object.keys(parameters).length > 0) {
    body.parameters = parameters;
  }

  return body;
}

async function buildVeoVideoBody(
  model: string,
  params: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<JsonObject> {
  const body: JsonObject = {};
  const prompt = readOptionalPrompt(params);
  const instance: JsonObject = {};
  const inputFiles = [
    ...collectStringValues(params.generation_input_file),
    ...collectStringValues(params.generation_input_image_file),
  ];

  if (prompt) {
    instance.prompt = prompt;
  }

  if (inputFiles[0]) {
    instance.image = await toVeoMediaValue(inputFiles[0], fetchImpl);
  }

  const lastFrame =
    typeof params.generation_last_frame === 'string' &&
    params.generation_last_frame.trim().length > 0
      ? await toVeoMediaValue(params.generation_last_frame.trim(), fetchImpl)
      : null;
  if (lastFrame) {
    instance.lastFrame = lastFrame;
  }

  if (inputFiles.length > 1) {
    instance.referenceImages = await Promise.all(
      inputFiles.map(async (value) => ({
        image: await toVeoMediaValue(value, fetchImpl),
        referenceType: 'asset',
      })),
    );
  }

  if (Object.keys(instance).length === 0) {
    throw new AppError(
      'invalid_provider_params',
      'Google video generation requires a prompt or media input.',
      400,
    );
  }

  body.instances = [instance];

  const parameters = normalizeVeoParameters({});

  if (params.generation_aspect_ratio !== undefined) {
    parameters.aspectRatio = jsonValue(params.generation_aspect_ratio);
  }

  if (params.generation_duration !== undefined) {
    parameters.durationSeconds = veoDurationValue(
      params.generation_duration,
      'generation_duration',
    );
  }

  if (params.generation_resolution !== undefined) {
    parameters.resolution = normalizeVeoResolution(
      params.generation_resolution,
    );
  }

  if (params.generation_seed !== undefined) {
    const seed = numericValue(params.generation_seed, 'generation_seed');

    if (seed >= 0) {
      parameters.seed = seed;
    }
  }

  if (Object.keys(parameters).length > 0) {
    body.parameters = parameters;
  }

  return body;
}

type GoogleImageResponse = {
  candidates?: Array<{
    content?: {
      parts?: GooglePart[];
    };
  }>;
  generatedImages?: GoogleGeneratedImage[];
  generated_images?: GoogleGeneratedImage[];
  predictions?: Array<{
    bytesBase64Encoded?: string | null;
    mimeType?: string | null;
    image?: {
      bytesBase64Encoded?: string | null;
      imageBytes?: string | null;
      mimeType?: string | null;
    };
  }>;
};

type GoogleGeneratedImage = {
  image?: {
    imageBytes?: string | null;
    mimeType?: string | null;
  };
};

type GooglePart = {
  inlineData?: { data?: string | null; mimeType?: string | null };
  inline_data?: { data?: string | null; mime_type?: string | null };
};

type GoogleOperationResponse = {
  done?: boolean;
  error?: { code?: number; message?: string; status?: string };
  name?: string;
  response?: {
    generateVideoResponse?: {
      generatedSamples?: GoogleGeneratedVideo[];
      raiMediaFilteredCount?: number;
      raiMediaFilteredReasons?: string[];
    };
    generatedVideos?: GoogleGeneratedVideo[];
    generated_videos?: GoogleGeneratedVideo[];
  };
};

type GoogleGeneratedVideo = {
  video?: {
    uri?: string | null;
    videoBytes?: string | null;
    mimeType?: string | null;
  };
};

function collectImageDataUrls(payload: GoogleImageResponse) {
  const images: Array<{ data: string; mimeType: string }> = [];

  for (const candidate of payload.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const inlineData = normalizeInlineData(part);
      if (inlineData) {
        const data = inlineData.data?.trim();

        if (!data) continue;

        images.push({
          data,
          mimeType: inlineData.mimeType ?? 'image/png',
        });
      }
    }
  }

  for (const image of [
    ...(payload.generatedImages ?? []),
    ...(payload.generated_images ?? []),
  ]) {
    const data = image.image?.imageBytes?.trim();
    if (data) {
      images.push({ data, mimeType: image.image?.mimeType ?? 'image/png' });
    }
  }

  for (const prediction of payload.predictions ?? []) {
    const data =
      prediction.bytesBase64Encoded?.trim() ??
      prediction.image?.bytesBase64Encoded?.trim() ??
      prediction.image?.imageBytes?.trim();
    if (data) {
      images.push({
        data,
        mimeType:
          prediction.mimeType ?? prediction.image?.mimeType ?? 'image/png',
      });
    }
  }

  return images.map((image) => `data:${image.mimeType};base64,${image.data}`);
}

function normalizeInlineData(part: GooglePart) {
  if (part.inlineData) {
    return {
      data: part.inlineData.data,
      mimeType: part.inlineData.mimeType,
    };
  }

  if (part.inline_data) {
    return {
      data: part.inline_data.data,
      mimeType: part.inline_data.mime_type,
    };
  }

  return null;
}

async function mapOperationResponseToStatus(args: {
  apiKey: string;
  fetchImpl: typeof fetch;
  generationId: string;
  metadata: JsonObject;
  payload: GoogleOperationResponse;
}): Promise<ProviderGenerationStatus> {
  const providerMetadata: JsonObject = {
    ...args.metadata,
    last_polled_at: new Date().toISOString(),
  };

  if (args.payload.error) {
    return {
      generation_id: args.generationId,
      generation_status: 'failed',
      generation_provider_used: 'google',
      generation_error:
        args.payload.error.message ?? 'Google generation failed.',
      generation_error_code: args.payload.error.status ?? 'provider_failed',
      provider_metadata: providerMetadata,
    };
  }

  if (!args.payload.done) {
    return {
      generation_id: args.generationId,
      generation_status: 'processing',
      generation_provider_used: 'google',
      provider_metadata: providerMetadata,
    };
  }

  const outputs = await collectVideoOutputs({
    apiKey: args.apiKey,
    fetchImpl: args.fetchImpl,
    payload: args.payload,
  });

  if (outputs.length === 0) {
    const filter = googleRaiFilter(args.payload);

    return {
      generation_id: args.generationId,
      generation_status: 'failed',
      generation_provider_used: 'google',
      generation_error:
        filter?.message ??
        'Google video operation completed without output videos.',
      generation_error_code: filter
        ? 'provider_content_filtered'
        : 'provider_unexpected_response',
      provider_metadata: filter
        ? { ...providerMetadata, rai_media_filtered_reasons: filter.reasons }
        : providerMetadata,
    };
  }

  return {
    generation_id: args.generationId,
    generation_status: 'succeeded',
    generation_provider_used: 'google',
    generation_output_file: outputs,
    generation_completed_at: new Date().toISOString(),
    provider_metadata: providerMetadata,
  };
}

// Veo can complete an operation with zero output videos when its Responsible AI
// filter blocks the result (for example a real-person likeness or a safety
// policy). The reason lives in generateVideoResponse.raiMediaFilteredReasons /
// raiMediaFilteredCount; surface it so the failure is actionable instead of a
// generic "no output videos" message.
function googleRaiFilter(
  payload: GoogleOperationResponse,
): { message: string; reasons: string[] } | null {
  const response = payload.response?.generateVideoResponse;

  const reasons = (response?.raiMediaFilteredReasons ?? [])
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);

  if (reasons.length > 0) {
    return {
      message: `Google Veo filtered the generated video: ${reasons.join(' ')}`,
      reasons,
    };
  }

  if (
    typeof response?.raiMediaFilteredCount === 'number' &&
    response.raiMediaFilteredCount > 0
  ) {
    return {
      message: `Google Veo filtered ${response.raiMediaFilteredCount} generated video(s) for a content policy; no reason text was provided.`,
      reasons: [],
    };
  }

  return null;
}

async function collectVideoOutputs(args: {
  apiKey: string;
  fetchImpl: typeof fetch;
  payload: GoogleOperationResponse;
}) {
  const videos = [
    ...(args.payload.response?.generateVideoResponse?.generatedSamples ?? []),
    ...(args.payload.response?.generatedVideos ?? []),
    ...(args.payload.response?.generated_videos ?? []),
  ];
  const outputs: string[] = [];

  for (const item of videos) {
    const bytes = item.video?.videoBytes?.trim();
    const mimeType = item.video?.mimeType ?? 'video/mp4';

    if (bytes) {
      outputs.push(`data:${mimeType};base64,${bytes}`);
      continue;
    }

    const uri = item.video?.uri?.trim();
    if (!uri) continue;

    outputs.push(
      await downloadGoogleMediaAsDataUrl({
        apiKey: args.apiKey,
        fetchImpl: args.fetchImpl,
        url: uri,
      }),
    );
  }

  return outputs;
}

async function downloadGoogleMediaAsDataUrl(args: {
  apiKey: string;
  fetchImpl: typeof fetch;
  url: string;
}) {
  const response = await fetchWithGuards(args.fetchImpl, args.url, {
    method: 'GET',
    headers: googleDownloadHeaders(args.url, args.apiKey),
    signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
  });
  const mimeType = response.headers.get('content-type') ?? 'video/mp4';
  const bytes = Buffer.from(await response.arrayBuffer()).toString('base64');

  return `data:${mimeType};base64,${bytes}`;
}

function readPrompt(params: Record<string, unknown>) {
  const prompt = readOptionalPrompt(params);

  if (!prompt) {
    throw new AppError(
      'invalid_provider_params',
      'Google generation requires a prompt.',
      400,
    );
  }

  return prompt;
}

function readOptionalPrompt(params: Record<string, unknown>) {
  const value = params.generation_prompt;

  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function readObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (jsonValue(value) as JsonObject)
    : {};
}

function hasResponseModalities(value: JsonObject) {
  return (
    Object.prototype.hasOwnProperty.call(value, 'responseModalities') ||
    Object.prototype.hasOwnProperty.call(value, 'response_modalities')
  );
}

function toGoogleMediaPart(value: string): JsonObject {
  const media = toGoogleMediaValue(value);
  return 'inlineData' in media || 'fileData' in media ? media : {};
}

function toGoogleMediaValue(value: string): JsonObject {
  const dataUri = parseDataUri(value);

  if (dataUri) {
    return {
      inlineData: {
        mimeType: dataUri.mimeType,
        data: dataUri.data,
      },
    };
  }

  return {
    fileData: {
      fileUri: value,
      mimeType: inferMimeType(value),
    },
  };
}

const MAX_VEO_INPUT_MEDIA_BYTES = 50 * 1024 * 1024;

/**
 * Veo `predictLongRunning` instances use the Vertex-style media shape
 * (`bytesBase64Encoded` + `mimeType`) and reject the `generateContent`
 * `inlineData`/`fileData` parts. Data URIs convert directly; HTTPS chain
 * handoffs (BFL/Runway/Alibaba delivery URLs) are downloaded through the
 * SSRF guard and inlined as bytes.
 */
async function toVeoMediaValue(
  value: string,
  fetchImpl: typeof fetch,
): Promise<JsonObject> {
  const dataUri = parseDataUri(value);

  if (dataUri) {
    return {
      bytesBase64Encoded: dataUri.data,
      mimeType: dataUri.mimeType,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AppError(
      'invalid_provider_params',
      'Google Veo media inputs must be data URLs or HTTPS URLs.',
      400,
    );
  }

  if (parsed.protocol !== 'https:') {
    throw new AppError(
      'provider_request_blocked',
      'Google Veo media inputs must use HTTPS.',
      400,
    );
  }

  const resolved = await lookupAllowedNetworkAddress(parsed.hostname);
  if (!resolved) {
    throw new AppError(
      'provider_request_blocked',
      'Google Veo media input host resolves to a blocked address.',
      400,
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(parsed.href, {
      method: 'GET',
      redirect: 'manual',
      headers: { accept: 'image/*,video/*' },
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    });
  } catch (error) {
    throw new AppError(
      'provider_network_error',
      `Google Veo media input download failed: ${error instanceof Error ? error.message : 'network error'}`,
      502,
    );
  }

  if (response.status >= 300 && response.status < 400) {
    throw new AppError(
      'provider_request_blocked',
      'Google Veo media input redirects are not allowed.',
      400,
    );
  }

  if (!response.ok) {
    throw new AppError(
      'provider_invalid_request',
      `Google Veo media input download responded ${response.status}.`,
      400,
    );
  }

  const contentLength = Number(response.headers.get('content-length'));

  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_VEO_INPUT_MEDIA_BYTES
  ) {
    throw new AppError(
      'invalid_provider_params',
      'Google Veo media inputs must be 50MB or smaller.',
      400,
    );
  }

  const bytes = Buffer.from(await response.arrayBuffer());

  if (bytes.byteLength === 0 || bytes.byteLength > MAX_VEO_INPUT_MEDIA_BYTES) {
    throw new AppError(
      'invalid_provider_params',
      'Google Veo media inputs must be non-empty and 50MB or smaller.',
      400,
    );
  }

  const contentType = response.headers.get('content-type');
  const mimeType = contentType?.split(';')[0]?.trim().toLowerCase();

  return {
    bytesBase64Encoded: bytes.toString('base64'),
    mimeType:
      mimeType &&
      (mimeType.startsWith('image/') || mimeType.startsWith('video/'))
        ? mimeType
        : inferMimeType(parsed.pathname),
  };
}

function normalizeVeoParameters(input: JsonObject) {
  const parameters = { ...input };

  if (parameters.durationSeconds !== undefined) {
    parameters.durationSeconds = veoDurationValue(
      parameters.durationSeconds,
      'parameters.durationSeconds',
    );
  }

  if (parameters.resolution !== undefined) {
    parameters.resolution = normalizeVeoResolution(parameters.resolution);
  }

  if (parameters.seed !== undefined) {
    const seed = numericValue(parameters.seed, 'parameters.seed');

    if (seed >= 0) {
      parameters.seed = seed;
    } else {
      delete parameters.seed;
    }
  }

  delete parameters.numberOfVideos;

  delete parameters.generateAudio;

  return parameters;
}

function veoDurationValue(value: unknown, field: string) {
  const duration = numericValue(value, field);

  if (![4, 6, 8].includes(duration)) {
    throw new AppError(
      'invalid_provider_params',
      `Google ${field} must be one of: 4, 6, 8.`,
      400,
    );
  }

  return duration;
}

function normalizeVeoResolution(value: unknown) {
  return value === '4k' ? '4K' : jsonValue(value);
}

function parseDataUri(value: string) {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(value.trim());

  return match ? { mimeType: match[1]!, data: match[2]! } : null;
}

function inferMimeType(value: string) {
  const lowerValue = value.toLowerCase();

  if (lowerValue.endsWith('.jpg') || lowerValue.endsWith('.jpeg')) {
    return 'image/jpeg';
  }

  if (lowerValue.endsWith('.webp')) {
    return 'image/webp';
  }

  if (lowerValue.endsWith('.mp4')) {
    return 'video/mp4';
  }

  return 'image/png';
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

function numericValue(value: unknown, field: string) {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    throw new AppError(
      'invalid_provider_params',
      `Google ${field} must be a number.`,
      400,
    );
  }

  return parsed;
}

function readOperationName(context: ProviderPollContext) {
  return typeof context.providerMetadata?.operation_name === 'string'
    ? context.providerMetadata.operation_name
    : context.generationId;
}

function googleHeaders(apiKey: string) {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-goog-api-key': apiKey,
  };
}

function googleDownloadHeaders(url: string, apiKey: string) {
  return new URL(url).hostname.toLowerCase() === GOOGLE_HOST
    ? googleHeaders(apiKey)
    : { accept: 'video/mp4' };
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
      'Google endpoints must use HTTPS.',
      400,
    );
  }

  if (!GOOGLE_DOWNLOAD_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new AppError(
      'provider_request_blocked',
      'Google endpoint host is not in the allowlist.',
      400,
    );
  }

  const resolved = await lookupAllowedNetworkAddress(parsed.hostname);
  if (!resolved) {
    throw new AppError(
      'provider_request_blocked',
      'Google endpoint host resolves to a blocked address.',
      400,
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    throw new AppError(
      'provider_network_error',
      `Google request failed: ${error instanceof Error ? error.message : 'network error'}`,
      502,
    );
  }

  if (!response.ok) {
    const text = await safeReadText(response);
    throw new AppError(
      mapGoogleErrorCode(response.status),
      `Google responded ${response.status}${text ? `: ${truncate(text, 500)}` : ''}`,
      response.status === 429 ? 429 : 502,
    );
  }

  return response;
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
      'Google model identifier contains invalid characters.',
      400,
    );
  }
}

function mapGoogleErrorCode(status: number) {
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
