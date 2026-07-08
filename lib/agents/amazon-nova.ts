import 'server-only';

import { Buffer } from 'node:buffer';
import type { LookupAddress } from 'node:dns';
import type { IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';

import { parseDataUrlOutputFile } from '@/lib/chains/output-files';
import type { JsonObject, JsonValue } from '@/lib/chains/types';
import { lookupAllowedNetworkAddress } from '@/lib/security/network-safety';
import { getEnv } from '@/lib/utils/env';
import { AppError, toErrorMessage } from '@/lib/utils/errors';

import type {
  ChainAgent,
  ChainAgentPromptContext,
  ChainAgentResult,
  ChainAgentSuggestion,
} from './types';
import {
  buildChainAgentSystemPrompt,
  buildChainAgentUserPrompt,
  CHAIN_AGENT_INSTRUCTION_VERSION,
} from './instructions';
import {
  completeChainAgentSelectedParams,
  validateChainAgentResult,
  type ChainAgentValidationResult,
} from './validation';

const BEDROCK_DEFAULT_MODEL = 'us.amazon.nova-2-lite-v1:0';
const BEDROCK_DEFAULT_REGION = 'us-east-1';
// Reasoning tokens are billed as output tokens and count against maxTokens, so
// the budget must hold the private reasoning AND the final JSON answer. Nova 2
// allows up to ~65k output tokens; the docs' reasoning examples use 10k. 5k was
// exhausted by reasoning alone, leaving an empty (unparseable) answer.
const AGENT_MAX_OUTPUT_TOKENS = 10000;
const BEDROCK_TIMEOUT_MS = 120_000;
const MEDIA_DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_AGENT_MEDIA_BYTES = 24 * 1024 * 1024;
// Some CDNs/WAFs (e.g. AWS WAF Core Rule Set NoUserAgent_HEADER fronting
// CloudFront, or Vercel Blob) reject requests without a User-Agent with a 403,
// even though browsers can load the same public URL. Always send one.
const MEDIA_DOWNLOAD_USER_AGENT = 'Marsha/0.1';
// Amazon Nova 2 inference tuning. The first (creative) pass runs Nova 2 Lite in
// extended-thinking REASONING mode. "low" effort fits this task: a single
// structured-analysis pass that weighs the image, schema, and context to produce
// three distinct directions (the docs scope "medium"/"high" to multi-step tool
// coordination and STEM proofs). A high temperature/top-p "induce more
// variations" so the three suggestions genuinely diverge. The repair pass turns
// reasoning OFF and uses greedy decoding for a fast, reliable structured fix.
// NOTE: reasoning effort "high" forbids temperature/top-p/top-k.
const AGENT_REASONING_EFFORT = 'low';
const AGENT_REASONING_TEMPERATURE = 1;
const AGENT_REASONING_TOP_P = 0.9;

type BedrockNovaConfig = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  modelIdentifier?: string;
  region?: string;
};

type DownloadedMedia = {
  bytes: Buffer;
  mediaType: string;
};

export function createBedrockNovaAgent(
  config: BedrockNovaConfig = {},
): ChainAgent {
  const env = getEnv();
  const fetchImpl = config.fetchImpl ?? fetch;
  const apiKey = config.apiKey ?? env.AGENT_CHAIN_AWS_BEDROCK_TOKEN;
  const region =
    config.region ??
    env.AGENT_CHAIN_AWS_BEDROCK_REGION ??
    BEDROCK_DEFAULT_REGION;
  const modelIdentifier =
    config.modelIdentifier ??
    env.AGENT_CHAIN_AWS_BEDROCK_AGENT ??
    BEDROCK_DEFAULT_MODEL;

  return {
    async suggestNextStep(
      input: ChainAgentPromptContext,
    ): Promise<ChainAgentResult> {
      if (!apiKey) {
        throw new AppError(
          'chain_agent_not_configured',
          'Chain Agent requires AGENT_CHAIN_AWS_BEDROCK_TOKEN on the the app server.',
          500,
        );
      }

      const startedAt = Date.now();

      // The creative first pass occasionally emits malformed JSON at its high
      // temperature. That is recoverable: capture it and let the greedy repair
      // pass (reasoning off, temperature 0) return clean structured output,
      // exactly as it does for a validation failure. Only intercept parse
      // failures here; surface every other error.
      let first: Awaited<ReturnType<typeof invokeAgent>> | null = null;
      let repairContext: { error: string; previousJson: string | null } | null =
        null;

      try {
        first = await invokeAgent({
          apiKey,
          context: input,
          fetchImpl,
          modelIdentifier,
          region,
        });
      } catch (error) {
        if (
          error instanceof AppError &&
          error.code === 'chain_agent_invalid_response'
        ) {
          repairContext = {
            error: error.message,
            previousJson:
              typeof error.details?.rawText === 'string'
                ? error.details.rawText
                : null,
          };
        } else {
          throw error;
        }
      }

      if (first) {
        first.result = completeAgentResultParams(first.result, input);
        const firstValidation = validateChainAgentResult(first.result, input);

        if (firstValidation.ok) {
          return withObservability(first.result, {
            latencyMs: Date.now() - startedAt,
            modelIdentifier,
            repaired: false,
            requestCount: 1,
            usage: first.usage,
            validation: firstValidation,
          });
        }

        repairContext = {
          error:
            firstValidation.error ?? 'Chain Agent result failed validation.',
          previousJson: first.result.rawText,
        };
      }

      if (repairContext) {
        const repair = await invokeAgent({
          apiKey,
          context: input,
          fetchImpl,
          modelIdentifier,
          previousJson: repairContext.previousJson,
          region,
          repairError: repairContext.error,
        });
        repair.result = completeAgentResultParams(repair.result, input);
        const repairValidation = validateChainAgentResult(repair.result, input);

        if (!repairValidation.ok) {
          throw new AppError(
            'chain_agent_invalid_response',
            `Chain Agent repair failed validation: ${repairValidation.error}`,
            502,
          );
        }

        return withObservability(repair.result, {
          latencyMs: Date.now() - startedAt,
          modelIdentifier,
          repaired: true,
          requestCount: 2,
          usage: first ? mergeUsage(first.usage, repair.usage) : repair.usage,
          validation: repairValidation,
        });
      }

      // Unreachable: first is set and valid (returned above) or repairContext is
      // set. Guards the type and an otherwise impossible state.
      throw new AppError(
        'chain_agent_invalid_response',
        'Chain Agent did not produce a result.',
        502,
      );
    },
  };
}

function completeAgentResultParams(
  result: ChainAgentResult,
  context: ChainAgentPromptContext,
): ChainAgentResult {
  return {
    ...result,
    selectedParams: completeChainAgentSelectedParams(
      result.selectedParams,
      context,
    ),
  };
}

export function defaultBedrockNovaModelIdentifier() {
  return getEnv().AGENT_CHAIN_AWS_BEDROCK_AGENT ?? BEDROCK_DEFAULT_MODEL;
}

async function invokeAgent(args: {
  apiKey: string;
  context: ChainAgentPromptContext;
  fetchImpl: typeof fetch;
  modelIdentifier: string;
  previousJson?: string | null;
  region: string;
  repairError?: string | null;
}) {
  const body = await buildConverseBody(args.context, args.fetchImpl, {
    previousJson: args.previousJson ?? null,
    repairError: args.repairError ?? null,
  });
  const response = await fetchBedrockConverse({
    apiKey: args.apiKey,
    body,
    fetchImpl: args.fetchImpl,
    modelIdentifier: args.modelIdentifier,
    region: args.region,
  });
  const rawText = extractTextResponse(response);

  return {
    result: normalizeAgentOutput(rawText),
    usage: isRecord(response.usage) ? toJsonObject(response.usage) : {},
  };
}

async function buildConverseBody(
  context: ChainAgentPromptContext,
  fetchImpl: typeof fetch,
  options: {
    repairError?: string | null;
    previousJson?: string | null;
  } = {},
) {
  const content: JsonObject[] = [];

  for (const outputFile of context.previousStep.outputFiles.slice(0, 2)) {
    if (context.previousStep.stepKind === 'video') {
      content.push({
        text: `Previous video ${content.length + 1}: available as the app media handoff. Use previous request params and downstream schema to plan the modify step; do not request or set media handoff fields.`,
      });
      continue;
    }

    const media = await readAgentMedia(outputFile, fetchImpl);
    const kind = media.mediaType.startsWith('video/') ? 'video' : 'image';
    if (kind === 'video') {
      content.push({
        text: `Previous video ${content.length + 1}: available as the app media handoff. Use the previous request params and downstream schema to plan the modify step; do not request or set media handoff fields.`,
      });
      continue;
    }

    const format = mediaFormat(media.mediaType, kind);

    content.push({
      text: `Image ${content.length + 1}:`,
    });
    content.push({
      [kind]: {
        format,
        source: {
          bytes: media.bytes.toString('base64'),
        },
      },
    });
  }

  content.push({ text: buildChainAgentUserPrompt(context, options) });

  const isRepairPass = Boolean(options.repairError);

  // Repair pass: greedy decoding (temperature 0, topK 1) with reasoning OFF is
  // the fastest reliable way to fix a malformed structured output. Creative
  // pass: Nova 2 Lite extended-thinking reasoning (medium) with a high
  // temperature/top-p so the planner reasons through the shoot and the three
  // options genuinely diverge.
  const inferenceConfig: JsonObject = isRepairPass
    ? { maxTokens: AGENT_MAX_OUTPUT_TOKENS, temperature: 0, topP: 1 }
    : {
        maxTokens: AGENT_MAX_OUTPUT_TOKENS,
        temperature: AGENT_REASONING_TEMPERATURE,
        topP: AGENT_REASONING_TOP_P,
      };
  // Nova-specific knobs travel via additionalModelRequestFields, not the
  // standard inferenceConfig block. reasoningConfig turns on extended thinking;
  // it is left off (default) for the greedy repair pass.
  const additionalModelRequestFields: JsonObject = isRepairPass
    ? { inferenceConfig: { topK: 1 } }
    : {
        reasoningConfig: {
          type: 'enabled',
          maxReasoningEffort: AGENT_REASONING_EFFORT,
        },
      };

  return {
    system: [{ text: buildChainAgentSystemPrompt(options) }],
    messages: [
      {
        role: 'user',
        content,
      },
    ],
    inferenceConfig,
    additionalModelRequestFields,
  };
}

async function fetchBedrockConverse(args: {
  apiKey: string;
  body: JsonObject;
  fetchImpl: typeof fetch;
  modelIdentifier: string;
  region: string;
}) {
  const response = await args.fetchImpl(
    `https://bedrock-runtime.${args.region}.amazonaws.com/model/${encodeURIComponent(args.modelIdentifier)}/converse`,
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${args.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(args.body),
      signal: AbortSignal.timeout(BEDROCK_TIMEOUT_MS),
    },
  );

  const payload = (await response
    .json()
    .catch(() => null)) as JsonObject | null;

  if (!response.ok) {
    const message = bedrockErrorMessage(payload);

    throw new AppError(
      response.status === 429
        ? 'chain_agent_rate_limited'
        : 'chain_agent_failed',
      message
        ? `Bedrock Nova agent request failed with status ${response.status}: ${message}`
        : `Bedrock Nova agent request failed with status ${response.status}.`,
      response.status === 429 ? 429 : 502,
      payload ?? undefined,
    );
  }

  return payload ?? {};
}

function bedrockErrorMessage(payload: JsonObject | null) {
  if (!payload) return null;

  return (
    stringValue(payload.message) ??
    stringValue(payload.Message) ??
    stringValue(payload.error) ??
    stringValue(payload.errorMessage)
  );
}

function extractTextResponse(payload: JsonObject) {
  const output = payload.output;
  if (!isRecord(output)) return '';
  const message = output.message;
  if (!isRecord(message) || !Array.isArray(message.content)) return '';

  return message.content
    .map((part) =>
      isRecord(part) && typeof part.text === 'string' ? part.text : '',
    )
    .join('\n')
    .trim();
}

function normalizeAgentOutput(rawText: string): ChainAgentResult {
  const parsed = parseAgentJson(rawText);
  const suggestions = normalizeSuggestions(parsed.suggestions);
  const parsedParams = isRecord(parsed.selected_params)
    ? toJsonObject(parsed.selected_params)
    : {};
  const selectedPrompt =
    stringValue(parsedParams.generation_prompt) ??
    stringValue(parsed.selected_prompt) ??
    suggestions[0]?.prompt ??
    '';
  const selectedParams = normalizeSelectedParams(parsedParams, selectedPrompt);

  if (!selectedPrompt.trim()) {
    throw new AppError(
      'chain_agent_invalid_response',
      'Chain Agent response did not include a usable prompt.',
      502,
    );
  }

  return {
    observations: isRecord(parsed.observations)
      ? toJsonObject(parsed.observations)
      : {},
    observability: {},
    suggestions,
    selectedPrompt,
    selectedParams,
    rawText,
  };
}

function withObservability(
  result: ChainAgentResult,
  input: {
    latencyMs: number;
    modelIdentifier: string;
    repaired: boolean;
    requestCount: number;
    usage: JsonObject;
    validation: ChainAgentValidationResult;
  },
): ChainAgentResult {
  return {
    ...result,
    observability: {
      instruction_version: CHAIN_AGENT_INSTRUCTION_VERSION,
      latency_ms: input.latencyMs,
      model_identifier: input.modelIdentifier,
      repair_attempted: input.repaired,
      request_count: input.requestCount,
      schema_version: schemaVersion(),
      selected_suggestion_index: selectedSuggestionIndex(result),
      token_usage: input.usage,
      validation: input.validation as unknown as JsonObject,
    },
  };
}

function selectedSuggestionIndex(result: ChainAgentResult) {
  return result.suggestions.findIndex(
    (suggestion) => suggestion.prompt === result.selectedPrompt,
  );
}

function schemaVersion() {
  return 'semantic-lady-runtime-schema';
}

function mergeUsage(left: JsonObject, right: JsonObject) {
  const merged: JsonObject = { ...left };

  for (const [key, value] of Object.entries(right)) {
    const existing = merged[key];
    merged[key] =
      typeof existing === 'number' && typeof value === 'number'
        ? existing + value
        : value;
  }

  return merged;
}

function parseAgentJson(rawText: string) {
  const trimmed = rawText.trim();
  // Nova 2 reasons internally in reasoning mode (its thinking is returned
  // separately and redacted), so the prompt asks it to emit only the final JSON
  // inside <output>. Prefer that block (its braces are the answer, not any
  // preamble). We still fall back to a ``` fence, the whole text, and the first
  // balanced object so a bare JSON object or a safety preamble does not waste a
  // repair round-trip.
  const outputBlock = /<output>\s*([\s\S]*?)\s*<\/output>/i
    .exec(trimmed)?.[1]
    ?.trim();
  const fenced = /```(?:[a-z0-9]+)?\s*([\s\S]*?)\s*```/i.exec(trimmed)?.[1];
  const candidates = [
    outputBlock,
    outputBlock ? extractFirstJsonObject(outputBlock) : null,
    fenced?.trim(),
    trimmed,
    extractFirstJsonObject(trimmed),
  ];

  let lastError: unknown;

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    try {
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch (error) {
      lastError = error;
    }
  }

  throw new AppError(
    'chain_agent_invalid_response',
    `Chain Agent returned invalid JSON: ${toErrorMessage(lastError)}`,
    502,
    { rawText: trimmed },
  );
}

// Scans for the first balanced top-level `{...}` object, ignoring braces that
// appear inside JSON string literals. Used as a fallback when Nova wraps its
// JSON object in explanatory prose without a fence.
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');

  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;

      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function normalizeSuggestions(value: unknown): ChainAgentSuggestion[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item, index): ChainAgentSuggestion | null => {
      if (!isRecord(item)) return null;
      const prompt = stringValue(item.prompt);
      if (!prompt) return null;
      const rationale = stringValue(item.rationale);
      const suggestion: ChainAgentSuggestion = {
        title: stringValue(item.title) ?? `Option ${index + 1}`,
        prompt,
      };

      if (isRecord(item.params)) {
        suggestion.params = toJsonObject(item.params);
      }

      if (rationale) {
        suggestion.rationale = rationale;
      }

      return suggestion;
    })
    .filter((item): item is ChainAgentSuggestion => item !== null)
    .slice(0, 5);
}

function normalizeSelectedParams(value: unknown, selectedPrompt: string) {
  const params = isRecord(value) ? toJsonObject(value) : {};
  const generationPrompt = stringValue(params.generation_prompt);

  return {
    ...Object.fromEntries(
      Object.entries(params).filter(([key]) => key.startsWith('generation_')),
    ),
    generation_prompt: generationPrompt ?? selectedPrompt,
  } satisfies JsonObject;
}

async function readAgentMedia(
  value: string,
  fetchImpl: typeof fetch,
): Promise<DownloadedMedia> {
  const dataUrl = parseDataUrlOutputFile(value);
  if (dataUrl) {
    if (dataUrl.bytes.byteLength > MAX_AGENT_MEDIA_BYTES) {
      throw new AppError(
        'chain_agent_media_too_large',
        'Chain Agent inline media must be 24MB or smaller until the app media storage is enabled.',
        400,
      );
    }

    return {
      bytes: dataUrl.bytes,
      mediaType: dataUrl.mediaType,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AppError(
      'chain_agent_media_invalid',
      'Chain Agent media references must be data URLs or HTTPS URLs.',
      400,
    );
  }

  if (parsed.protocol !== 'https:') {
    throw new AppError(
      'chain_agent_media_invalid',
      'Chain Agent media references must use HTTPS.',
      400,
    );
  }

  const resolved = await lookupAllowedNetworkAddress(parsed.hostname);
  if (!resolved) {
    throw new AppError(
      'chain_agent_media_blocked',
      'Chain Agent media URL resolves to a blocked address.',
      400,
    );
  }

  return fetchImpl === fetch
    ? downloadAgentMediaWithPinnedAddress(parsed, resolved)
    : downloadAgentMediaWithFetch(parsed, fetchImpl);
}

function downloadAgentMediaWithPinnedAddress(
  parsed: URL,
  resolved: LookupAddress,
) {
  return new Promise<DownloadedMedia>((resolve, reject) => {
    const request = httpsRequest(
      parsed,
      {
        headers: {
          accept: 'image/*,video/*',
          'user-agent': MEDIA_DOWNLOAD_USER_AGENT,
        },
        lookup: (_hostname, options, callback) => {
          if (typeof options === 'object' && options.all) {
            const allCallback = callback as unknown as (
              error: NodeJS.ErrnoException | null,
              addresses: LookupAddress[],
            ) => void;

            allCallback(null, [resolved]);
            return;
          }

          callback(null, resolved.address, resolved.family);
        },
        method: 'GET',
      },
      (response) => {
        void readAgentMediaResponse(response, parsed.pathname)
          .then(resolve)
          .catch(reject);
      },
    );
    const timeout = setTimeout(() => {
      request.destroy(
        new AppError(
          'chain_agent_media_download_failed',
          'Chain Agent media download timed out.',
          502,
        ),
      );
    }, MEDIA_DOWNLOAD_TIMEOUT_MS);

    request.on('error', reject);
    request.on('close', () => clearTimeout(timeout));
    request.end();
  }).catch((error: unknown) => {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      'chain_agent_media_download_failed',
      `Chain Agent media download failed: ${toErrorMessage(error)}`,
      502,
    );
  });
}

async function downloadAgentMediaWithFetch(
  parsed: URL,
  fetchImpl: typeof fetch,
) {
  const response = await fetchImpl(parsed.href, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      accept: 'image/*,video/*',
      'user-agent': MEDIA_DOWNLOAD_USER_AGENT,
    },
    signal: AbortSignal.timeout(MEDIA_DOWNLOAD_TIMEOUT_MS),
  }).catch((error: unknown) => {
    throw new AppError(
      'chain_agent_media_download_failed',
      `Chain Agent media download failed: ${toErrorMessage(error)}`,
      502,
    );
  });

  return readAgentMediaFetchResponse(response, parsed.pathname);
}

async function readAgentMediaFetchResponse(
  response: Response,
  pathname: string,
): Promise<DownloadedMedia> {
  assertAgentMediaStatus(response.status);
  assertAgentMediaContentLength(response.headers.get('content-length'));

  const bytes = Buffer.from(await response.arrayBuffer());

  return normalizeDownloadedAgentMedia({
    bytes,
    contentType: response.headers.get('content-type'),
    pathname,
  });
}

function readAgentMediaResponse(response: IncomingMessage, pathname: string) {
  return new Promise<DownloadedMedia>((resolve, reject) => {
    try {
      assertAgentMediaStatus(response.statusCode ?? null);
      assertAgentMediaContentLength(response.headers['content-length']);
    } catch (error) {
      response.resume();
      reject(error);
      return;
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;

    response.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;

      if (totalBytes > MAX_AGENT_MEDIA_BYTES) {
        reject(
          new AppError(
            'chain_agent_media_too_large',
            'Chain Agent media must be 24MB or smaller until the app media storage is enabled.',
            400,
          ),
        );
        response.destroy();
        return;
      }

      chunks.push(buffer);
    });
    response.on('end', () => {
      try {
        resolve(
          normalizeDownloadedAgentMedia({
            bytes: Buffer.concat(chunks),
            contentType: stringHeader(response.headers['content-type']),
            pathname,
          }),
        );
      } catch (error) {
        reject(error);
      }
    });
    response.on('error', reject);
  });
}

function assertAgentMediaStatus(status: number | null) {
  if (status !== null && status >= 300 && status < 400) {
    throw new AppError(
      'chain_agent_media_blocked',
      'Chain Agent media redirects are not allowed.',
      400,
    );
  }

  if (status === null || status < 200 || status >= 300) {
    throw new AppError(
      'chain_agent_media_download_failed',
      `Chain Agent media download responded ${status ?? 'unknown'}.`,
      400,
    );
  }
}

function assertAgentMediaContentLength(
  value: string | string[] | null | undefined,
) {
  const contentLength = Number(Array.isArray(value) ? value[0] : value);

  if (Number.isFinite(contentLength) && contentLength > MAX_AGENT_MEDIA_BYTES) {
    throw new AppError(
      'chain_agent_media_too_large',
      'Chain Agent media must be 24MB or smaller until the app media storage is enabled.',
      400,
    );
  }
}

function normalizeDownloadedAgentMedia({
  bytes,
  contentType,
  pathname,
}: {
  bytes: Buffer;
  contentType: string | null | undefined;
  pathname: string;
}) {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_AGENT_MEDIA_BYTES) {
    throw new AppError(
      'chain_agent_media_too_large',
      'Chain Agent media must be non-empty and 24MB or smaller until the app media storage is enabled.',
      400,
    );
  }

  const mediaType = contentType?.split(';')[0]?.trim().toLowerCase();

  return {
    bytes,
    mediaType:
      mediaType &&
      (mediaType.startsWith('image/') || mediaType.startsWith('video/'))
        ? mediaType
        : inferMediaType(pathname),
  };
}

function stringHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function mediaFormat(mediaType: string, kind: 'image' | 'video') {
  const subtype = mediaType.split('/')[1]?.toLowerCase() ?? '';

  if (subtype === 'jpeg') return 'jpeg';
  if (['png', 'gif', 'webp'].includes(subtype)) return subtype;
  if (['mp4', 'mov', 'webm'].includes(subtype)) return subtype;

  return kind === 'video' ? 'mp4' : 'png';
}

function inferMediaType(pathname: string) {
  const lower = pathname.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  return 'image/png';
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toJsonObject(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => isJsonValue(entry)),
  ) as JsonObject;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  return isRecord(value) && Object.values(value).every(isJsonValue);
}
