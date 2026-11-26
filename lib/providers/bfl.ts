import 'server-only';

import { lookupAllowedNetworkAddress } from '@/lib/security/network-safety';
import type { JsonObject } from '@/lib/chains/types';
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

/**
 * Black Forest Labs (BFL) - direct BYOK adapter.
 *
 * Design notes
 * -------------
 * BFL exposes an asynchronous task model:
 *
 *   1.  `POST https://api.<region>.bfl.ai/v1/<endpoint>` with `x-key: <key>`
 *       returns `{ id, polling_url }`. The polling URL MUST be used verbatim
 *       (it embeds the queue routing), so we never reconstruct it from the id.
 *   2.  `GET <polling_url>` returns `{ status, result?: { sample, ... } }`.
 *   3.  No cancel endpoint exists, so `cancel()` is a no-op and the app
 *       marks the step canceled locally without notifying BFL.
 *
 * Caveats
 * -------
 *   - `result.sample` URLs expire ~10 minutes after completion. the app
 *     surfaces this through `provider_metadata.output_expires_at` so callers
 *     downloading via webhook are aware. Re-hosting is intentionally
 *     out-of-scope for this iteration.
 *   - BFL has no cost-estimation API. Estimates report
 *     `cost_total_consumed: 0` because BFL bills the caller's own BFL
 *     account, not the app credits.
 *   - Input image fields. Most BFL endpoints expect base64-encoded image
 *     bytes (`input_image`, `image_prompt`). FLUX 2 also accepts hosted URLs
 *     (`image_url`). the app downloads upstream URLs (via the SSRF-safe
 *     resolver) and base64-encodes them so chain steps that feed each other
 *     just work; callers may also pass pre-base64-encoded fields directly.
 */
export type BflRegion = 'global' | 'eu' | 'us';

export type BflProviderConfig = {
  apiKey: string;
  region?: BflRegion;
  /**
   * Optional absolute base URL (e.g. `https://api.bfl.ai/v1`). When set this
   * overrides the per-region host calculation. The host must end with
   * `.bfl.ai` and use HTTPS. Used for operator-supplied `BFL_API_BASE_URL`.
   */
  baseUrl?: string;
  /** Override for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

const BFL_HOSTS: Record<BflRegion, string> = {
  global: 'api.bfl.ai',
  eu: 'api.eu.bfl.ai',
  us: 'api.us.bfl.ai',
};

const BFL_ALLOWED_HOST_SUFFIXES = ['.bfl.ai'];
const SUBMIT_TIMEOUT_MS = 30_000;
const POLL_TIMEOUT_MS = 10_000;
const MAX_INPUT_IMAGE_BYTES = 20 * 1024 * 1024;
const OUTPUT_EXPIRY_SECONDS = 10 * 60;

const STATUS_TERMINAL_SUCCESS = 'Ready';
const STATUS_TERMINAL_FAILURES = new Set([
  'Error',
  'Failed',
  'Task not found',
  'Request Moderated',
  'Content Moderated',
]);

export function createBflProvider(config: BflProviderConfig): Provider {
  const region: BflRegion = config.region ?? 'global';
  const host = BFL_HOSTS[region];
  const fetchImpl = config.fetchImpl ?? fetch;

  // Operator-supplied base URL overrides the regional host. the app still enforces
  // HTTPS + the `.bfl.ai` host allowlist (validated again in fetchWithGuards).
  let baseUrl = `https://${host}/v1`;
  if (config.baseUrl) {
    const parsed = new URL(config.baseUrl);
    if (parsed.protocol !== 'https:') {
      throw new AppError(
        'invalid_bfl_base_url',
        'BFL_API_BASE_URL must use HTTPS.',
        500,
      );
    }
    if (!isAllowedBflHost(parsed.hostname)) {
      throw new AppError(
        'invalid_bfl_base_url',
        'BFL_API_BASE_URL host is not in the allowlist.',
        500,
      );
    }
    baseUrl = config.baseUrl.replace(/\/+$/, '');
  }

  return {
    name: 'bfl',

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
      const endpoint = stripPrefix(input.modelIdentifier, 'bfl/');
      assertEndpoint(endpoint);

      const body = await mapSubmitBody(
        input.params as Record<string, unknown>,
        {
          fetchImpl,
          endpoint,
        },
      );
      const url = `${baseUrl}/${endpoint}`;

      const response = await fetchWithGuards(fetchImpl, url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-key': config.apiKey,
          'x-idempotency-key': input.idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
      });

      const parsed = (await response.json()) as {
        id?: string;
        polling_url?: string;
      };

      if (!parsed.id || !parsed.polling_url) {
        throw new AppError(
          'provider_unexpected_response',
          'BFL submit response is missing `id` or `polling_url`.',
          502,
        );
      }

      assertSamePollingHost(parsed.polling_url);

      return {
        kind: 'async',
        generationId: parsed.id,
        providerOrder: ['bfl'],
        providerMetadata: {
          provider: 'bfl',
          region,
          endpoint,
          polling_url: parsed.polling_url,
        },
      };
    },

    async poll(
      context: ProviderPollContext,
    ): Promise<ProviderGenerationStatus> {
      const pollingUrl = readPollingUrl(context.providerMetadata);
      assertSamePollingHost(pollingUrl);

      const response = await fetchWithGuards(fetchImpl, pollingUrl, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'x-key': config.apiKey,
        },
        signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
      });

      const payload = (await response.json()) as {
        status?: string;
        result?: { sample?: string; [key: string]: unknown } | null;
        details?: unknown;
        progress?: number | null;
      };

      const status = payload.status ?? '';

      if (status === STATUS_TERMINAL_SUCCESS) {
        const sample = payload.result?.sample;

        if (!sample || typeof sample !== 'string') {
          return {
            generation_id: context.generationId,
            generation_status: 'failed',
            generation_error: 'BFL reported Ready without a sample URL.',
            generation_error_code: 'provider_unexpected_response',
            provider_metadata: stampLastPolledAt(context.providerMetadata),
          };
        }

        const expiresAt = new Date(
          Date.now() + OUTPUT_EXPIRY_SECONDS * 1_000,
        ).toISOString();

        return {
          generation_id: context.generationId,
          generation_status: 'succeeded',
          generation_provider_used: 'bfl',
          generation_output_file: [sample],
          generation_completed_at: new Date().toISOString(),
          provider_metadata: {
            ...stampLastPolledAt(context.providerMetadata),
            output_expires_at: expiresAt,
          },
        };
      }

      if (STATUS_TERMINAL_FAILURES.has(status)) {
        const errorCode =
          status === 'Task not found'
            ? 'provider_task_not_found'
            : status.includes('Moderated')
              ? 'provider_content_moderated'
              : 'provider_failed';

        return {
          generation_id: context.generationId,
          generation_status: 'failed',
          generation_provider_used: 'bfl',
          generation_error: `BFL status: ${status}`,
          generation_error_code: errorCode,
          provider_metadata: stampLastPolledAt(context.providerMetadata),
        };
      }

      return {
        generation_id: context.generationId,
        generation_status: 'processing',
        generation_provider_used: 'bfl',
        provider_metadata: {
          ...stampLastPolledAt(context.providerMetadata),
          last_status: status || null,
          progress:
            typeof payload.progress === 'number' ? payload.progress : null,
        },
      };
    },

    async cancel(_context: ProviderCancelContext): Promise<void> {
      // BFL exposes no cancel endpoint, so the runner handles local cancellation.
      return;
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchWithGuards(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
) {
  const parsed = new URL(url);

  if (parsed.protocol !== 'https:') {
    throw new AppError(
      'provider_request_blocked',
      'BFL endpoints must be HTTPS.',
      400,
    );
  }

  if (!isAllowedBflHost(parsed.hostname)) {
    throw new AppError(
      'provider_request_blocked',
      'BFL endpoint host is not in the allowlist.',
      400,
    );
  }

  const resolved = await lookupAllowedNetworkAddress(parsed.hostname);
  if (!resolved) {
    throw new AppError(
      'provider_request_blocked',
      'BFL endpoint host resolves to a blocked address.',
      400,
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    throw new AppError(
      'provider_network_error',
      `BFL request failed: ${error instanceof Error ? error.message : 'network error'}`,
      502,
    );
  }

  if (!response.ok) {
    const text = await safeReadText(response);
    throw new AppError(
      mapBflErrorCode(response.status),
      `BFL responded ${response.status}${text ? `: ${truncate(text, 500)}` : ''}`,
      response.status === 429 ? 429 : 502,
    );
  }

  return response;
}

function isAllowedBflHost(hostname: string) {
  const lower = hostname.toLowerCase();
  if (Object.values(BFL_HOSTS).includes(lower)) {
    return true;
  }
  return BFL_ALLOWED_HOST_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

function assertSamePollingHost(pollingUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(pollingUrl);
  } catch {
    throw new AppError(
      'provider_request_blocked',
      'BFL polling URL is malformed.',
      502,
    );
  }
  if (parsed.protocol !== 'https:' || !isAllowedBflHost(parsed.hostname)) {
    throw new AppError(
      'provider_request_blocked',
      'BFL polling URL host is not in the allowlist.',
      502,
    );
  }
}

function readPollingUrl(metadata: JsonObject | null): string {
  const url = metadata?.polling_url;
  if (typeof url !== 'string' || !url) {
    throw new AppError(
      'provider_state_missing',
      'BFL polling_url missing from stored provider_metadata.',
      500,
    );
  }
  return url;
}

function stampLastPolledAt(metadata: JsonObject | null): JsonObject {
  return {
    ...(metadata ?? {}),
    last_polled_at: new Date().toISOString(),
  };
}

function mapBflErrorCode(status: number) {
  if (status === 401 || status === 403) return 'provider_unauthorized';
  if (status === 404) return 'provider_not_found';
  if (status === 429) return 'provider_rate_limited';
  if (status >= 500) return 'provider_unavailable';
  return 'provider_invalid_request';
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

function assertEndpoint(endpoint: string) {
  if (!/^[A-Za-z0-9._-]+$/.test(endpoint) || endpoint.length === 0) {
    throw new AppError(
      'invalid_model_identifier',
      'BFL endpoint slug contains invalid characters.',
      400,
    );
  }
}

async function safeReadText(response: Response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Translate the unified `generation_*` request shape into a BFL request body.
 *
 * BFL endpoints differ in how they accept input images:
 *
 *   - FLUX 1.x (`/v1/flux-1.1-pro`, etc.) → `image_prompt` (single, URL or
 *     base64) for Redux.
 *   - FLUX 2 pro/flex/max (`/v1/flux-2-*` except klein) → `input_image`,
 *     `input_image_2`, ... `input_image_8` (URLs accepted).
 *   - FLUX 2 Klein (`/v1/flux-2-klein-*`) → `input_image`,
 *     `input_image_2`, ... `input_image_4` (URLs accepted).
 *   - Unknown endpoint → base64-encoded `input_image`.
 *
 * the app prefers URL pass-through when the endpoint documents URL support;
 * otherwise the adapter downloads and base64-encodes the image for BFL.
 *
 * Other mappings:
 *   - `generation_prompt`        → `prompt`
 *   - `generation_aspect_ratio`  → `aspect_ratio`
 *   - `generation_output_format` → `output_format`
 */
// FLUX 1.x [pro] endpoints (flux-1.1-pro and friends) constrain width/height to
// a multiple of 32 within 256-1440 and reject any other value with a 422
// `multiple_of` error. Snap an off-grid dimension (for example an agent-planned
// 720) to the nearest valid step and clamp it into range so the request is
// accepted. FLUX 2 only requires >= 64 with no step, so its dimensions are left
// untouched. Non-numeric input passes through.
function snapBflFlux1Dimension(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const snapped = Math.round(numeric / 32) * 32;
  return Math.min(1440, Math.max(256, snapped));
}

async function mapSubmitBody(
  params: Record<string, unknown>,
  opts: { fetchImpl: typeof fetch; endpoint: string },
): Promise<JsonObject> {
  const body: JsonObject = {};
  const endpointFamily = classifyBflEndpoint(opts.endpoint);
  const usesDimensionSize = endpointFamily !== 'flux1-ultra';
  // Only FLUX 1.x [pro] enforces the multiple-of-32, 256-1440 dimension grid.
  const snapsDimensions = endpointFamily === 'flux1';

  for (const [rawKey, value] of Object.entries(params)) {
    if (value === undefined) continue;

    if (rawKey === 'generation_prompt') {
      body.prompt = value as never;
      continue;
    }
    if (rawKey === 'generation_aspect_ratio') {
      if (!usesDimensionSize) {
        body.aspect_ratio = value as never;
      }
      continue;
    }
    if (rawKey === 'generation_output_format') {
      body.output_format = normalizeProviderOutputFormat(value) as never;
      continue;
    }
    if (rawKey === 'generation_width') {
      body.width = (
        snapsDimensions ? (snapBflFlux1Dimension(value) ?? value) : value
      ) as never;
      continue;
    }
    if (rawKey === 'generation_height') {
      body.height = (
        snapsDimensions ? (snapBflFlux1Dimension(value) ?? value) : value
      ) as never;
      continue;
    }
    if (rawKey === 'generation_prompt_extend') {
      body.prompt_upsampling = value as never;
      continue;
    }
    if (rawKey === 'generation_seed') {
      body.seed = value as never;
      continue;
    }
    if (rawKey === 'generation_guidance') {
      body.guidance = value as never;
      continue;
    }
    if (rawKey === 'generation_steps') {
      body.steps = value as never;
      continue;
    }
    if (rawKey === 'generation_raw') {
      body.raw = value as never;
      continue;
    }
    if (rawKey === 'generation_image_prompt_strength') {
      body.image_prompt_strength = value as never;
      continue;
    }
    if (rawKey === 'generation_moderation') {
      body.safety_tolerance = value === true ? 0 : 5;
      continue;
    }
    if (
      rawKey === 'generation_input_file' ||
      rawKey === 'generation_input_image_file'
    ) {
      // handled after the loop
      continue;
    }
    if (
      rawKey === 'generation_output_number' ||
      rawKey === 'generation_size' ||
      rawKey === 'generation_provider_order'
    ) {
      // Concept does not apply to single-provider BYOK.
      continue;
    }
  }

  if (usesDimensionSize) {
    delete body.aspect_ratio;
    delete body.resolution;
    delete body.size;
  }

  const inputUrls = [
    ...collectStringValues(params.generation_input_file),
    ...collectStringValues(params.generation_input_image_file),
  ];

  if (inputUrls.length > 0) {
    const firstUrl = inputUrls[0]!;

    switch (endpointFamily) {
      case 'flux2-klein':
        if (!hasExplicitBflAggregateImage(body)) {
          assignBflInputImageFields(body, inputUrls, 4);
        }
        break;
      case 'flux2':
        if (!hasExplicitBflAggregateImage(body)) {
          assignBflInputImageFields(body, inputUrls, 8);
        }
        break;
      case 'flux1':
      case 'flux1-ultra':
        // FLUX 1.x [pro] and ultra take a single optional image_prompt
        // (URL accepted).
        if (typeof body.image_prompt !== 'string') {
          body.image_prompt = toBflImageInputValue(firstUrl) as never;
        }
        break;
      case 'unknown':
      default:
        // BFL-compatible default: base64-encode the first image.
        if (typeof body.input_image !== 'string') {
          body.input_image = await fetchAsBase64(firstUrl, opts.fetchImpl);
        }
        break;
    }
  }

  if (typeof body.prompt !== 'string' || body.prompt.length === 0) {
    throw new AppError(
      'invalid_provider_params',
      'BFL request requires a non-empty `generation_prompt`.',
      400,
    );
  }

  return body;
}

function hasExplicitBflAggregateImage(body: JsonObject) {
  return (
    typeof body.input_images !== 'undefined' ||
    typeof body.images !== 'undefined' ||
    typeof body.image_url === 'string'
  );
}

function collectStringValues(value: unknown) {
  if (typeof value === 'string' && value.length > 0) {
    return [value];
  }

  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === 'string' && item.length > 0,
      )
    : [];
}

function assignBflInputImageFields(
  body: JsonObject,
  inputUrls: string[],
  maxImages: number,
) {
  for (const [index, url] of inputUrls.slice(0, maxImages).entries()) {
    const field = index === 0 ? 'input_image' : `input_image_${index + 1}`;

    if (typeof body[field] === 'undefined') {
      body[field] = toBflImageInputValue(url) as never;
    }
  }
}

function toBflImageInputValue(value: string) {
  return parseDataUriBase64(value) ?? value;
}

function parseDataUriBase64(value: string) {
  const match =
    /^data:image\/[A-Za-z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(
      value.trim(),
    );

  return match?.[1]?.replace(/\s/g, '') ?? null;
}

function normalizeProviderOutputFormat(value: unknown) {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === 'jpg' ? 'jpeg' : normalized;
}

/**
 * Classify a BFL endpoint into a family that shares request image handling.
 * Conservative: returns `unknown` for anything we do not recognize so the
 * caller uses BFL's base64 `input_image` request shape.
 */
function classifyBflEndpoint(
  endpoint: string,
): 'flux2-klein' | 'flux2' | 'flux1' | 'flux1-ultra' | 'unknown' {
  const normalized = endpoint.toLowerCase();
  if (normalized.startsWith('flux-2-klein')) return 'flux2-klein';
  if (normalized.startsWith('flux-2-')) return 'flux2';
  // FLUX 1.1 [pro] ultra (the app id `flux-1.1-pro-ultra`, legacy
  // `flux-pro-1.1-ultra`) takes an aspect_ratio instead of width/height, so it
  // must be matched before the FLUX 1.x dimension family below.
  if (normalized.endsWith('-ultra')) return 'flux1-ultra';
  if (normalized.startsWith('flux-1.1-') || normalized.startsWith('flux-1-'))
    return 'flux1';
  return 'unknown';
}

async function fetchAsBase64(
  url: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const dataUriBase64 = parseDataUriBase64(url);
  if (dataUriBase64) {
    return dataUriBase64;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError(
      'invalid_provider_params',
      'Input file URL is malformed.',
      400,
    );
  }
  if (parsed.protocol !== 'https:') {
    throw new AppError(
      'invalid_provider_params',
      'Input file URL must use HTTPS.',
      400,
    );
  }
  const resolved = await lookupAllowedNetworkAddress(parsed.hostname);
  if (!resolved) {
    throw new AppError(
      'invalid_provider_params',
      'Input file URL host resolves to a blocked address.',
      400,
    );
  }

  const response = await fetchImpl(url, {
    method: 'GET',
    signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new AppError(
      'invalid_provider_params',
      `Failed to download input file (status ${response.status}).`,
      400,
    );
  }

  const contentLength = Number(response.headers.get('content-length') ?? '0');
  if (contentLength > MAX_INPUT_IMAGE_BYTES) {
    throw new AppError(
      'invalid_provider_params',
      `Input file exceeds ${MAX_INPUT_IMAGE_BYTES} bytes.`,
      400,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_INPUT_IMAGE_BYTES) {
    throw new AppError(
      'invalid_provider_params',
      `Input file exceeds ${MAX_INPUT_IMAGE_BYTES} bytes.`,
      400,
    );
  }

  return buffer.toString('base64');
}
