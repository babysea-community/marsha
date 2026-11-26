import { Buffer } from 'node:buffer';
import { request as httpsRequest } from 'node:https';

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

export type OpenAiProviderConfig = {
  apiKey: string;
  fetchImpl?: typeof fetch;
};

const OPENAI_HOST = 'api.openai.com';
const OPENAI_IMAGE_MODEL = 'gpt-image-2';
const SUBMIT_TIMEOUT_MS = 180_000;
const MAX_INPUT_IMAGE_BYTES = 50 * 1024 * 1024;

export function createOpenAiProvider(config: OpenAiProviderConfig): Provider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const baseUrl = `https://${OPENAI_HOST}`;

  return {
    name: 'openai',

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
      const model = stripPrefix(input.modelIdentifier, 'openai/');

      if (input.stepKind !== 'image' || model !== OPENAI_IMAGE_MODEL) {
        throw new AppError(
          'invalid_model_identifier',
          `GPT Image model "${model}" is not valid for a ${input.stepKind} step.`,
          400,
        );
      }

      const params = input.params as Record<string, unknown>;
      const imageInputs = collectImageInputValues(params);
      const outputFormat = readOutputFormat(params);
      const response =
        imageInputs.length > 0
          ? await fetchWithGuards(fetchImpl, `${baseUrl}/v1/images/edits`, {
              method: 'POST',
              headers: openAiMultipartHeaders(config.apiKey),
              body: await buildImageEditForm({
                fetchImpl,
                imageInputs,
                model,
                params,
              }),
              signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
            })
          : await fetchWithGuards(
              fetchImpl,
              `${baseUrl}/v1/images/generations`,
              {
                method: 'POST',
                headers: openAiJsonHeaders(config.apiKey),
                body: JSON.stringify(
                  buildImageGenerationBody({
                    model,
                    params,
                  }),
                ),
                signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
              },
            );
      const payload = (await response.json()) as OpenAiImageResponse;
      const outputFiles = collectDataUrls(payload, outputFormat);

      if (outputFiles.length === 0) {
        throw new AppError(
          'provider_unexpected_response',
          'OpenAI image response contained no b64_json outputs.',
          502,
        );
      }

      const completedAt = new Date().toISOString();

      return {
        kind: 'completed',
        generationId: `openai_${input.idempotencyKey}`,
        providerOrder: ['openai'],
        providerUsed: 'openai',
        outputFiles,
        providerMetadata: {
          completed_at: completedAt,
          kind: imageInputs.length > 0 ? 'sync_image_edit' : 'sync_image',
          model,
          output_files: outputFiles,
          provider: 'openai',
          revised_prompt: firstRevisedPrompt(payload) ?? null,
        },
      };
    },

    async poll(
      context: ProviderPollContext,
    ): Promise<ProviderGenerationStatus> {
      const metadata = context.providerMetadata ?? {};
      const outputs = Array.isArray(metadata.output_files)
        ? (metadata.output_files as unknown[]).filter(
            (item): item is string => typeof item === 'string',
          )
        : [];

      return {
        generation_id: context.generationId,
        generation_status: 'succeeded',
        generation_provider_used: 'openai',
        generation_output_file: outputs,
        generation_completed_at:
          (metadata.completed_at as string | undefined) ?? null,
        provider_metadata: metadata,
      };
    },

    async cancel(_context: ProviderCancelContext): Promise<void> {
      return;
    },
  };
}

function buildImageGenerationBody(args: {
  model: string;
  params: Record<string, unknown>;
}) {
  const body: JsonObject = { model: args.model };

  for (const [rawKey, value] of Object.entries(args.params)) {
    if (value === undefined) continue;
    if (isProviderControlledBodyKey(rawKey)) continue;

    if (rawKey === 'generation_prompt') {
      body.prompt = jsonValue(value);
      continue;
    }

    if (rawKey === 'generation_output_number') {
      body.n = jsonValue(value);
      continue;
    }

    if (rawKey === 'generation_output_format') {
      body.output_format = normalizeOutputFormat(value);
      continue;
    }

    if (rawKey === 'generation_size') {
      body.size = jsonValue(value);
      continue;
    }

    if (rawKey === 'generation_quality') {
      body.quality = jsonValue(value);
      continue;
    }

    if (rawKey === 'generation_background') {
      body.background = jsonValue(value);
      continue;
    }

    if (rawKey === 'generation_moderation') {
      body.moderation = value === true ? 'auto' : 'low';
      continue;
    }

    if (rawKey === 'generation_output_compression') {
      body.output_compression = jsonValue(value);
      continue;
    }

    if (rawKey === 'generation_partial_images') {
      body.partial_images = jsonValue(value);
      continue;
    }

    if (rawKey === 'generation_stream') {
      body.stream = jsonValue(value);
      continue;
    }

    if (
      rawKey === 'generation_input_file' ||
      rawKey === 'generation_input_image_file' ||
      rawKey === 'generation_mask_file' ||
      rawKey === 'generation_provider_order'
    ) {
      continue;
    }
  }

  if (body.output_format === undefined) {
    body.output_format = 'png';
  }

  if (typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
    throw new AppError(
      'invalid_provider_params',
      'GPT Image 2 requires a prompt.',
      400,
    );
  }

  return body;
}

async function buildImageEditForm(args: {
  fetchImpl: typeof fetch;
  imageInputs: string[];
  model: string;
  params: Record<string, unknown>;
}) {
  const body = buildImageGenerationBody({
    model: args.model,
    params: args.params,
  });
  const form = new FormData();

  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    form.append(key, String(value));
  }

  for (const [index, input] of args.imageInputs.entries()) {
    const file = await readImageInputFile(input, args.fetchImpl, index);
    form.append('image[]', file.blob, file.filename);
  }

  const mask = readOptionalStringValue(args.params, 'generation_mask_file');
  if (mask) {
    const file = await readImageInputFile(mask, args.fetchImpl, 0, 'mask');
    form.append('mask', file.blob, file.filename);
  }

  return form;
}

function collectImageInputValues(params: Record<string, unknown>) {
  return [
    ...collectOptionalStringValues(params, 'generation_input_file'),
    ...collectOptionalStringValues(params, 'generation_input_image_file'),
  ];
}

function collectOptionalStringValues(
  params: Record<string, unknown>,
  key: string,
) {
  if (!Object.prototype.hasOwnProperty.call(params, key)) {
    return [];
  }

  const value = params[key];

  if (typeof value === 'string' && value.trim().length > 0) {
    return [value.trim()];
  }

  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.trim().length > 0)
  ) {
    return value.map((item) => item.trim());
  }

  throw new AppError(
    'invalid_provider_params',
    `OpenAI image edit ${key} must be a non-empty string or array of non-empty strings.`,
    400,
  );
}

function readOptionalStringValue(params: Record<string, unknown>, key: string) {
  if (!Object.prototype.hasOwnProperty.call(params, key)) {
    return null;
  }

  const value = params[key];

  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  throw new AppError(
    'invalid_provider_params',
    `OpenAI image edit ${key} must be a non-empty string.`,
    400,
  );
}

function readOutputFormat(params: Record<string, unknown>) {
  return normalizeOutputFormat(
    params.generation_output_format ?? params.output_format ?? 'png',
  );
}

type OpenAiImageResponse = {
  data?: Array<{
    b64_json?: string | null;
    revised_prompt?: string | null;
  }>;
};

function collectDataUrls(payload: OpenAiImageResponse, outputFormat: unknown) {
  const mediaType = mediaTypeForOutputFormat(outputFormat);

  return (payload.data ?? [])
    .map((item) => item.b64_json?.trim())
    .filter((item): item is string => Boolean(item))
    .map((base64) => `data:${mediaType};base64,${base64}`);
}

function firstRevisedPrompt(payload: OpenAiImageResponse) {
  return (payload.data ?? []).find(
    (item) => typeof item.revised_prompt === 'string',
  )?.revised_prompt;
}

function openAiJsonHeaders(apiKey: string) {
  return {
    accept: 'application/json',
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  };
}

function openAiMultipartHeaders(apiKey: string) {
  return {
    accept: 'application/json',
    authorization: `Bearer ${apiKey}`,
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
      'OpenAI endpoints must use HTTPS.',
      400,
    );
  }

  if (parsed.hostname.toLowerCase() !== OPENAI_HOST) {
    throw new AppError(
      'provider_request_blocked',
      'OpenAI endpoint host is not in the allowlist.',
      400,
    );
  }

  const resolved = await lookupAllowedNetworkAddress(parsed.hostname);
  if (!resolved) {
    throw new AppError(
      'provider_request_blocked',
      'OpenAI endpoint host resolves to a blocked address.',
      400,
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    throw new AppError(
      'provider_network_error',
      `OpenAI request failed: ${error instanceof Error ? error.message : 'network error'}`,
      502,
    );
  }

  if (!response.ok) {
    const text = await safeReadText(response);
    throw new AppError(
      mapOpenAiErrorCode(response.status, text),
      `OpenAI responded ${response.status}${text ? `: ${truncate(text, 500)}` : ''}`,
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

function isProviderControlledBodyKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');

  return (
    normalized === 'callbackurl' ||
    normalized === 'generationcallbackurl' ||
    normalized === 'generationmodel' ||
    normalized === 'model'
  );
}

function normalizeOutputFormat(value: unknown) {
  if (typeof value !== 'string') {
    return jsonValue(value);
  }

  const normalized = value.trim().toLowerCase();
  return normalized === 'jpg' ? 'jpeg' : normalized;
}

function mediaTypeForOutputFormat(value: unknown) {
  const normalized = typeof value === 'string' ? value.toLowerCase() : 'png';

  switch (normalized) {
    case 'jpeg':
    case 'jpg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/png';
  }
}

async function readImageInputFile(
  value: string,
  fetchImpl: typeof fetch,
  index: number,
  name = 'image',
) {
  const dataUri = parseDataUri(value);

  if (dataUri) {
    const bytes = Buffer.from(dataUri.data, 'base64');
    assertInputImageSize(bytes.byteLength);
    assertNonEmptyInputImage(bytes.byteLength);

    return {
      blob: new Blob([toArrayBuffer(bytes)], { type: dataUri.mimeType }),
      filename: `${name}-${index + 1}.${extensionForMimeType(dataUri.mimeType)}`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AppError(
      'invalid_provider_params',
      'OpenAI image edit inputs must use HTTPS URLs or data URLs.',
      400,
    );
  }

  if (parsed.protocol !== 'https:') {
    throw new AppError(
      'provider_request_blocked',
      'OpenAI image edit inputs must use HTTPS URLs or data URLs.',
      400,
    );
  }

  const resolved = await lookupAllowedNetworkAddress(parsed.hostname);
  if (!resolved) {
    throw new AppError(
      'provider_request_blocked',
      'OpenAI image edit input host resolves to a blocked address.',
      400,
    );
  }

  const downloaded =
    fetchImpl === fetch
      ? await downloadHttpsImageWithPinnedAddress(parsed, resolved)
      : await downloadHttpsImageWithFetchImpl(value, fetchImpl);
  const { bytes, mimeType } = downloaded;
  assertNonEmptyInputImage(bytes.byteLength);

  return {
    blob: new Blob([toArrayBuffer(bytes)], { type: mimeType }),
    filename: `${name}-${index + 1}.${extensionForMimeType(mimeType)}`,
  };
}

function toArrayBuffer(bytes: Buffer) {
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return arrayBuffer;
}

function parseDataUri(value: string) {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(value.trim());

  if (!match) {
    return null;
  }

  const mimeType = match[1]!;
  if (!mimeType.toLowerCase().startsWith('image/')) {
    throw new AppError(
      'invalid_provider_params',
      'OpenAI image edit inputs must be image data URLs.',
      400,
    );
  }

  const data = normalizeBase64ImageData(match[2]!);
  assertInputImageSize(estimatedBase64DecodedBytes(data));

  return { mimeType, data };
}

function normalizeBase64ImageData(value: string) {
  const normalized = value.replace(/\s/g, '');

  if (
    normalized.length === 0 ||
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) ||
    /=[A-Za-z0-9+/]/.test(normalized)
  ) {
    throw new AppError(
      'invalid_provider_params',
      'OpenAI image edit inputs must contain valid base64 image data.',
      400,
    );
  }

  return normalized;
}

function estimatedBase64DecodedBytes(value: string) {
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const decodedBytes = (value.length / 4) * 3 - padding;

  if (decodedBytes <= 0) {
    throw new AppError(
      'invalid_provider_params',
      'OpenAI image edit inputs must not be empty.',
      400,
    );
  }

  return decodedBytes;
}

async function readBoundedResponseBytes(response: Response) {
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (contentLength > MAX_INPUT_IMAGE_BYTES) {
    throwInputTooLargeError();
  }

  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    assertInputImageSize(bytes.byteLength);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      if (!value) {
        continue;
      }

      totalBytes += value.byteLength;

      if (totalBytes > MAX_INPUT_IMAGE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throwInputTooLargeError();
      }

      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes);
}

async function downloadHttpsImageWithFetchImpl(
  value: string,
  fetchImpl: typeof fetch,
) {
  let response: Response;
  try {
    response = await fetchImpl(value, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
    });
  } catch (error) {
    throw new AppError(
      'provider_network_error',
      `OpenAI image edit input download failed: ${error instanceof Error ? error.message : 'network error'}`,
      502,
    );
  }

  if (response.status >= 300 && response.status < 400) {
    throw new AppError(
      'provider_request_blocked',
      'OpenAI image edit input redirects are not allowed.',
      400,
    );
  }

  if (!response.ok) {
    throw new AppError(
      'provider_invalid_request',
      `OpenAI image edit input download responded ${response.status}.`,
      400,
    );
  }

  return {
    bytes: await readBoundedResponseBytes(response),
    mimeType: readImageMimeType(response, value),
  };
}

async function downloadHttpsImageWithPinnedAddress(
  url: URL,
  resolved: { address: string; family: number },
) {
  return new Promise<{ bytes: Buffer; mimeType: string }>((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        headers: { accept: 'image/*' },
        lookup(_hostname, _options, callback) {
          callback(null, resolved.address, resolved.family as 4 | 6);
        },
        method: 'GET',
        timeout: SUBMIT_TIMEOUT_MS,
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;

        if (statusCode >= 300 && statusCode < 400) {
          response.resume();
          reject(
            new AppError(
              'provider_request_blocked',
              'OpenAI image edit input redirects are not allowed.',
              400,
            ),
          );
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(
            new AppError(
              'provider_invalid_request',
              `OpenAI image edit input download responded ${statusCode}.`,
              400,
            ),
          );
          return;
        }

        const contentLength = Number(response.headers['content-length'] ?? 0);
        if (contentLength > MAX_INPUT_IMAGE_BYTES) {
          response.destroy();
          rejectInputTooLarge(reject);
          return;
        }

        const contentType = firstHeaderValue(response.headers['content-type']);
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        response.on('data', (chunk: Buffer) => {
          totalBytes += chunk.byteLength;

          if (totalBytes > MAX_INPUT_IMAGE_BYTES) {
            response.destroy();
            rejectInputTooLarge(reject);
            return;
          }

          chunks.push(Buffer.from(chunk));
        });

        response.on('end', () => {
          try {
            resolve({
              bytes: Buffer.concat(chunks, totalBytes),
              mimeType: readHeaderImageMimeType(contentType, url.href),
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(
        new AppError(
          'provider_network_error',
          'OpenAI image edit input download timed out.',
          502,
        ),
      );
    });
    request.on('error', reject);
    request.end();
  });
}

function assertInputImageSize(byteLength: number) {
  if (byteLength > MAX_INPUT_IMAGE_BYTES) {
    throwInputTooLargeError();
  }
}

function assertNonEmptyInputImage(byteLength: number) {
  if (byteLength <= 0) {
    throw new AppError(
      'invalid_provider_params',
      'OpenAI image edit inputs must not be empty.',
      400,
    );
  }
}

function throwInputTooLargeError(): never {
  throw new AppError(
    'invalid_provider_params',
    `OpenAI image edit input exceeds ${MAX_INPUT_IMAGE_BYTES} bytes.`,
    400,
  );
}

function rejectInputTooLarge(reject: (reason?: unknown) => void) {
  reject(
    new AppError(
      'invalid_provider_params',
      `OpenAI image edit input exceeds ${MAX_INPUT_IMAGE_BYTES} bytes.`,
      400,
    ),
  );
}

function readImageMimeType(response: Response, fallbackUrl: string) {
  return readHeaderImageMimeType(
    response.headers.get('content-type'),
    fallbackUrl,
  );
}

function readHeaderImageMimeType(
  contentType: string | null | undefined,
  fallbackUrl: string,
) {
  if (!contentType) {
    return inferImageMimeType(fallbackUrl);
  }

  if (!contentType.toLowerCase().startsWith('image/')) {
    throw new AppError(
      'invalid_provider_params',
      'OpenAI image edit input response must be an image.',
      400,
    );
  }

  return contentType;
}

function firstHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function inferImageMimeType(value: string) {
  const lowerValue = value.toLowerCase();
  if (lowerValue.endsWith('.jpg') || lowerValue.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (lowerValue.endsWith('.webp')) {
    return 'image/webp';
  }
  return 'image/png';
}

function extensionForMimeType(mimeType: string) {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('jpeg') || normalized.includes('jpg')) {
    return 'jpg';
  }
  if (normalized.includes('webp')) {
    return 'webp';
  }
  return 'png';
}

function mapOpenAiErrorCode(status: number, body?: string) {
  if (status === 401 || status === 403) return 'provider_unauthorized';
  if (status === 404) return 'provider_not_found';
  if (status === 409) return 'provider_invalid_request';
  if (status === 429) {
    // OpenAI reports permanent quota/billing problems ("Limit 0",
    // insufficient_quota) with the same 429 status as transient rate limits.
    // Retrying those can never succeed, so fail the step instead of
    // requeueing it forever.
    return isPermanentQuotaError(body)
      ? 'provider_quota_exceeded'
      : 'provider_rate_limited';
  }
  if (status >= 500) return 'provider_unavailable';
  return 'provider_invalid_request';
}

function isPermanentQuotaError(body?: string) {
  if (!body) return false;
  const normalized = body.toLowerCase();
  return (
    normalized.includes('insufficient_quota') ||
    normalized.includes('billing') ||
    normalized.includes('limit 0,')
  );
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
