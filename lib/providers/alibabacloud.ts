import 'server-only';

import { lookupAllowedNetworkAddress } from '@/lib/security/network-safety';
import type { JsonObject, JsonValue } from '@/lib/chains/types';
import { getMediaDrivenModelVariant } from '@/lib/models/media-driven-variants';
import { AppError } from '@/lib/utils/errors';
import { VIDEO_HANDOFF_AS_REFERENCE } from '@/lib/config/natural-video';

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
 * Alibaba Cloud Model Studio/DashScope - direct BYOK adapter.
 *
 * the app supports DashScope's direct HTTP APIs:
 * synchronous multimodal image calls and asynchronous image/video task calls.
 * Auth uses `Authorization: Bearer <DASHSCOPE_API_KEY>`.
 */
export type AlibabaCloudProviderConfig = {
  apiKey: string;
  fetchImpl?: typeof fetch;
};

const ALIBABA_CLOUD_HOST = 'dashscope-intl.aliyuncs.com';
const ALIBABA_CLOUD_REGION = 'singapore';
const SUBMIT_TIMEOUT_MS = 60_000;
const POLL_TIMEOUT_MS = 10_000;

const MULTIMODAL_SYNC_IMAGE_MODELS = new Set([
  'qwen-image-2.0-pro',
  'qwen-image-2.0',
  'qwen-image-max',
  'qwen-image-plus',
  'qwen-image',
  'qwen-image-edit-max',
  'qwen-image-edit-plus',
  'qwen-image-edit',
  'z-image-turbo',
  'wan2.7-image-pro',
  'wan2.7-image',
  'wan2.6-image',
  'wan2.6-t2i',
]);

const ASYNC_IMAGE_TO_IMAGE_MODELS = new Set([
  'wan2.5-i2i-preview',
  'wanx2.1-imageedit',
]);

const VIDEO_GENERATION_MODELS = new Set([
  'happyhorse-1.0-t2v',
  'happyhorse-1.0-i2v',
  'happyhorse-1.0-r2v',
  'happyhorse-1.0-video-edit',
  'wan2.7-t2v',
  'wan2.7-i2v-2026-04-25',
  'wan2.7-r2v',
  'wan2.7-videoedit',
]);

const VIDEO_PARAMETER_KEYS_BY_MODEL: Record<string, readonly string[]> = {
  'happyhorse-1.0-t2v': [
    'duration',
    'ratio',
    'resolution',
    'seed',
    'watermark',
  ],
  'happyhorse-1.0-i2v': ['duration', 'resolution', 'seed', 'watermark'],
  'happyhorse-1.0-r2v': [
    'duration',
    'ratio',
    'resolution',
    'seed',
    'watermark',
  ],
  'happyhorse-1.0-video-edit': [
    'audio_setting',
    'resolution',
    'seed',
    'watermark',
  ],
  'wan2.7-t2v': [
    'duration',
    'prompt_extend',
    'ratio',
    'resolution',
    'seed',
    'watermark',
  ],
  'wan2.7-i2v-2026-04-25': [
    'duration',
    'prompt_extend',
    'resolution',
    'seed',
    'watermark',
  ],
  'wan2.7-r2v': [
    'duration',
    'prompt_extend',
    'ratio',
    'resolution',
    'seed',
    'watermark',
  ],
  'wan2.7-videoedit': [
    'audio_setting',
    'duration',
    'prompt_extend',
    'ratio',
    'resolution',
    'seed',
    'watermark',
  ],
};

const ANIMATE_PARAMETER_KEYS = new Set(['check_image', 'mode']);

const ANIMATE_IMAGE_TO_VIDEO_MODELS = new Set([
  'wan2.2-animate-mix',
  'wan2.2-animate-move',
]);

export function createAlibabaCloudProvider(
  config: AlibabaCloudProviderConfig,
): Provider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const baseUrl = `https://${ALIBABA_CLOUD_HOST}`;

  return {
    name: 'alibabacloud',

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
      const model = stripPrefix(input.modelIdentifier, 'alibabacloud/');
      assertModelId(model);
      const route = routeForModel(model, input.stepKind);
      const body = buildSubmitBody({
        model,
        params: input.params as Record<string, unknown>,
        route,
        sourceModelIdentifier: input.sourceModelIdentifier,
        stepKey: input.stepKey,
      });
      const url = `${baseUrl}${route.path}`;
      const headers: Record<string, string> = {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
        'x-idempotency-key': input.idempotencyKey,
      };

      if (route.async) {
        headers['x-dashscope-async'] = 'enable';
      }

      const response = await fetchWithGuards(fetchImpl, url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
      });
      const payload = (await response.json()) as AlibabaCloudTaskResponse;

      if (!route.async) {
        const outputs = collectOutputUrls(payload);
        if (outputs.length === 0) {
          throw new AppError(
            'provider_unexpected_response',
            'Alibaba Cloud image response contained no output URLs.',
            502,
          );
        }

        return {
          kind: 'completed',
          generationId:
            typeof payload.request_id === 'string'
              ? payload.request_id
              : `alibabacloud_img_${input.idempotencyKey}`,
          providerOrder: ['alibabacloud'],
          providerUsed: 'alibabacloud',
          outputFiles: outputs,
          providerMetadata: {
            provider: 'alibabacloud',
            region: ALIBABA_CLOUD_REGION,
            model,
            kind: 'sync_image',
            request_id:
              typeof payload.request_id === 'string'
                ? payload.request_id
                : null,
            output_files: outputs,
            completed_at: new Date().toISOString(),
          },
        };
      }

      const taskId = readTaskId(payload);
      if (!taskId) {
        throw new AppError(
          'provider_unexpected_response',
          'Alibaba Cloud task submit response is missing `output.task_id`.',
          502,
        );
      }

      return {
        kind: 'async',
        generationId: taskId,
        providerOrder: ['alibabacloud'],
        providerMetadata: {
          provider: 'alibabacloud',
          region: ALIBABA_CLOUD_REGION,
          model,
          kind: route.kind,
          task_id: taskId,
        },
      };
    },

    async poll(
      context: ProviderPollContext,
    ): Promise<ProviderGenerationStatus> {
      const metadata = context.providerMetadata ?? {};

      if (metadata.kind === 'sync_image') {
        const outputs = Array.isArray(metadata.output_files)
          ? (metadata.output_files as unknown[]).filter(isNonEmptyString)
          : [];

        return {
          generation_id: context.generationId,
          generation_status: 'succeeded',
          generation_provider_used: 'alibabacloud',
          generation_output_file: outputs,
          generation_completed_at:
            (metadata.completed_at as string | undefined) ?? null,
          provider_metadata: metadata,
        };
      }

      const taskId =
        typeof metadata.task_id === 'string'
          ? metadata.task_id
          : context.generationId;
      const url = `${baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}`;
      const response = await fetchWithGuards(fetchImpl, url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${config.apiKey}`,
        },
        signal: AbortSignal.timeout(POLL_TIMEOUT_MS),
      });
      const payload = (await response.json()) as AlibabaCloudTaskResponse;

      return mapTaskResponseToStatus({
        payload,
        generationId: context.generationId,
        metadata,
      });
    },

    async cancel(_context: ProviderCancelContext): Promise<void> {
      return;
    },
  };
}

type AlibabaCloudRoute = {
  async: boolean;
  kind: 'sync_image' | 'image_task' | 'video_task';
  path: string;
  protocol: 'animate_image_to_video' | 'image_task' | 'multimodal' | 'video';
};

function routeForModel(
  model: string,
  stepKind: 'image' | 'video',
): AlibabaCloudRoute {
  if (stepKind === 'image') {
    if (MULTIMODAL_SYNC_IMAGE_MODELS.has(model)) {
      return {
        async: false,
        kind: 'sync_image',
        path: '/api/v1/services/aigc/multimodal-generation/generation',
        protocol: 'multimodal',
      };
    }

    if (ASYNC_IMAGE_TO_IMAGE_MODELS.has(model)) {
      return {
        async: true,
        kind: 'image_task',
        path: '/api/v1/services/aigc/image2image/image-synthesis',
        protocol: 'image_task',
      };
    }
  }

  if (stepKind === 'video' && ANIMATE_IMAGE_TO_VIDEO_MODELS.has(model)) {
    return {
      async: true,
      kind: 'video_task',
      path: '/api/v1/services/aigc/image2video/video-synthesis',
      protocol: 'animate_image_to_video',
    };
  }

  if (stepKind === 'video' && VIDEO_GENERATION_MODELS.has(model)) {
    return {
      async: true,
      kind: 'video_task',
      path: '/api/v1/services/aigc/video-generation/video-synthesis',
      protocol: 'video',
    };
  }

  throw new AppError(
    'invalid_model_identifier',
    `Alibaba Cloud model "${model}" is not valid for a ${stepKind} step.`,
    400,
  );
}

function buildSubmitBody(args: {
  model: string;
  params: Record<string, unknown>;
  route: AlibabaCloudRoute;
  sourceModelIdentifier?: string;
  stepKey?: string;
}): JsonObject {
  const input: JsonObject = {};
  const parameters: JsonObject = {};
  const generationPrompt = readNonEmptyString(args.params.generation_prompt);
  const handoffFiles = collectStringValues(args.params.generation_input_file);
  const imageFiles = collectStringValues(
    args.params.generation_input_image_file,
  );
  const videoFiles = collectStringValues(
    args.params.generation_input_video_file,
  );
  const audioFiles = collectStringValues(
    args.params.generation_input_audio_file,
  );
  const inputFiles = [...handoffFiles, ...imageFiles, ...videoFiles];
  const lastFrameFiles = collectStringValues(args.params.generation_last_frame);
  const negativePrompt = readNonEmptyString(
    args.params.generation_negative_prompt,
  );
  const mediaRole = readNonEmptyString(args.params.generation_media_role);
  const referenceVoice = readNonEmptyString(
    args.params.generation_reference_voice_file,
  );

  if (args.route.protocol === 'multimodal') {
    mergeMultimodalInput(input, generationPrompt, inputFiles);
  } else if (args.route.protocol === 'video') {
    mergeVideoInput({
      audioFiles,
      handoffFiles,
      imageFiles,
      input,
      lastFrameFiles,
      mediaRole,
      model: args.model,
      negativePrompt,
      prompt: generationPrompt,
      referenceVoice,
      stepKey: args.stepKey,
      videoFiles,
    });
  } else if (args.route.protocol === 'animate_image_to_video') {
    mergeAnimateImageToVideoInput({
      handoffFiles,
      imageFiles,
      input,
      inputFiles,
      sourceModelIdentifier: args.sourceModelIdentifier,
      videoFiles,
    });
  } else {
    mergeImageTaskInput({
      input,
      model: args.model,
      prompt: generationPrompt,
      inputFiles,
    });
  }

  mergeCommonParameters({
    model: args.model,
    params: args.params,
    parameters,
    route: args.route,
  });

  return compactJsonObject({
    model: args.model,
    input,
    parameters,
  });
}

function mergeMultimodalInput(
  input: JsonObject,
  prompt: string | null,
  inputFiles: string[],
) {
  const content = readOrCreateFirstMessageContent(input);

  if (prompt && !content.some(hasTextContent)) {
    content.push({ text: prompt });
  }

  if (!content.some(hasImageContent)) {
    for (const file of inputFiles) {
      content.push({ image: file });
    }
  }
}

function mergeAnimateImageToVideoInput(args: {
  handoffFiles: string[];
  imageFiles: string[];
  input: JsonObject;
  inputFiles: string[];
  sourceModelIdentifier?: string;
  videoFiles: string[];
}) {
  const variant = args.sourceModelIdentifier
    ? getMediaDrivenModelVariant(args.sourceModelIdentifier)
    : null;
  const imageFile =
    variant?.inputKind === 'video'
      ? args.imageFiles[0]
      : (args.handoffFiles[0] ?? args.imageFiles[0] ?? args.inputFiles[0]);
  const videoFile =
    variant?.inputKind === 'video'
      ? (args.handoffFiles[0] ?? args.videoFiles[0])
      : (args.videoFiles[0] ??
        args.handoffFiles[1] ??
        args.imageFiles[1] ??
        args.inputFiles[1]);

  if (args.input.image_url === undefined && imageFile) {
    args.input.image_url = imageFile;
  }

  if (args.input.video_url === undefined && videoFile) {
    args.input.video_url = videoFile;
  }
}

function mergeImageTaskInput(args: {
  input: JsonObject;
  model: string;
  prompt: string | null;
  inputFiles: string[];
}) {
  if (args.prompt && args.input.prompt === undefined) {
    args.input.prompt = args.prompt;
  }

  if (args.inputFiles.length === 0) {
    return;
  }

  if (args.input.images === undefined) {
    args.input.images = args.inputFiles;
  }
}

function mergeVideoInput(args: {
  audioFiles: string[];
  handoffFiles: string[];
  imageFiles: string[];
  input: JsonObject;
  lastFrameFiles: string[];
  mediaRole: string | null;
  model: string;
  negativePrompt: string | null;
  prompt: string | null;
  referenceVoice: string | null;
  stepKey?: string;
  videoFiles: string[];
}) {
  if (args.prompt && args.input.prompt === undefined) {
    args.input.prompt = args.prompt;
  }

  if (args.negativePrompt && args.input.negative_prompt === undefined) {
    args.input.negative_prompt = args.negativePrompt;
  }

  if (
    args.model === 'wan2.7-t2v' &&
    args.audioFiles[0] &&
    args.input.audio_url === undefined
  ) {
    args.input.audio_url = args.audioFiles[0];
  }

  if (args.input.media !== undefined) {
    return;
  }

  const media: JsonObject[] = [];

  if (isVideoEditModel(args.model) && args.stepKey !== 'video') {
    const videoFile = args.videoFiles[0] ?? args.handoffFiles[0];
    const referenceFiles = [
      ...args.imageFiles,
      ...(args.videoFiles[0] ? args.handoffFiles : args.handoffFiles.slice(1)),
    ];
    if (videoFile) {
      media.push({ type: 'video', url: videoFile });
    }
    for (const file of referenceFiles) {
      media.push({
        type: mediaImageType(args.mediaRole, 'reference_image'),
        url: file,
      });
    }
  } else if (args.model.includes('r2v')) {
    for (const file of [...args.handoffFiles, ...args.imageFiles]) {
      media.push(
        compactJsonObject({
          reference_voice:
            media.length === 0 && !args.videoFiles[0]
              ? args.referenceVoice
              : undefined,
          type: mediaImageType(args.mediaRole, 'reference_image'),
          url: file,
        }),
      );
    }
    for (const file of args.videoFiles) {
      media.push(
        compactJsonObject({
          reference_voice: args.referenceVoice,
          type: mediaVideoType(args.mediaRole, 'reference_video'),
          url: file,
        }),
      );
    }
  } else {
    const firstFile = args.imageFiles[0] ?? args.handoffFiles[0];
    const referenceFiles = [
      ...args.imageFiles.slice(firstFile === args.imageFiles[0] ? 1 : 0),
      ...args.handoffFiles.slice(firstFile === args.handoffFiles[0] ? 1 : 0),
    ];
    // A chain handoff first frame becomes a subject reference when enabled, so
    // the clip opens already in motion. A caller-provided first image keeps
    // first_frame, and an explicit generation_media_role still wins.
    const firstFrameFallback =
      !args.imageFiles[0] &&
      Boolean(args.handoffFiles[0]) &&
      VIDEO_HANDOFF_AS_REFERENCE
        ? 'reference_image'
        : 'first_frame';
    if (firstFile) {
      media.push({
        type: mediaImageType(args.mediaRole, firstFrameFallback),
        url: firstFile,
      });
    }
    for (const file of referenceFiles) {
      media.push({
        type: mediaImageType(args.mediaRole, 'reference_image'),
        url: file,
      });
    }
    for (const file of args.videoFiles) {
      media.push({
        type: mediaVideoType(args.mediaRole, 'first_clip'),
        url: file,
      });
    }
  }

  for (const file of args.lastFrameFiles) {
    media.push({ type: 'last_frame', url: file });
  }

  if (args.model !== 'wan2.7-t2v') {
    for (const file of args.audioFiles) {
      media.push({ type: 'driving_audio', url: file });
    }
  }

  if (media.length > 0) {
    args.input.media = media;
  }
}

function mediaImageType(role: string | null, fallback: string) {
  return role === 'first_frame' ||
    role === 'last_frame' ||
    role === 'reference_image'
    ? role
    : fallback;
}

function mediaVideoType(role: string | null, fallback: string) {
  return role === 'video' || role === 'first_clip' || role === 'reference_video'
    ? role
    : fallback;
}

function isVideoEditModel(model: string) {
  return model === 'happyhorse-1.0-video-edit' || model === 'wan2.7-videoedit';
}

function mergeCommonParameters(args: {
  model: string;
  params: Record<string, unknown>;
  parameters: JsonObject;
  route: AlibabaCloudRoute;
}) {
  if (args.route.protocol === 'animate_image_to_video') {
    setIfMissing(
      args.parameters,
      'check_image',
      args.params.generation_check_image,
    );
    setIfMissing(args.parameters, 'mode', args.params.generation_mode);
    pruneUnsupportedParameters(args.parameters, ANIMATE_PARAMETER_KEYS);
    return;
  }

  const videoParameterKeys =
    args.route.protocol === 'video'
      ? new Set(VIDEO_PARAMETER_KEYS_BY_MODEL[args.model] ?? [])
      : null;

  if (args.route.protocol === 'video') {
    pruneUnsupportedParameters(
      args.parameters,
      videoParameterKeys ?? new Set(),
    );
    delete args.parameters.n;
  } else {
    setIfMissing(args.parameters, 'n', args.params.generation_output_number);
  }
  setIfSupported(
    args.parameters,
    videoParameterKeys,
    'duration',
    args.params.generation_duration,
  );
  setIfSupported(
    args.parameters,
    videoParameterKeys,
    'prompt_extend',
    args.params.generation_prompt_extend,
  );
  setIfSupported(
    args.parameters,
    videoParameterKeys,
    'watermark',
    args.params.generation_watermark,
  );
  setIfSupported(
    args.parameters,
    videoParameterKeys,
    'seed',
    args.params.generation_seed,
  );
  setIfSupported(
    args.parameters,
    videoParameterKeys,
    'audio_setting',
    args.params.generation_audio,
  );
  if (args.params.generation_mode !== undefined) {
    args.parameters.mode = args.params.generation_mode as JsonValue;
  }

  const outputSize = readNonEmptyString(args.params.generation_size);
  if (
    args.route.protocol !== 'video' &&
    outputSize &&
    args.parameters.size === undefined
  ) {
    args.parameters.size = normalizeSize(outputSize);
  }

  const ratio = readNonEmptyString(args.params.generation_aspect_ratio);
  const resolution = readNonEmptyString(args.params.generation_resolution);

  if (args.route.protocol === 'video') {
    setIfSupported(
      args.parameters,
      videoParameterKeys,
      'resolution',
      normalizeResolution(resolution),
    );
    setIfSupported(args.parameters, videoParameterKeys, 'ratio', ratio);
    return;
  }
}

function pruneUnsupportedParameters(
  parameters: JsonObject,
  supportedKeys: ReadonlySet<string>,
) {
  for (const key of Object.keys(parameters)) {
    if (!supportedKeys.has(key)) {
      delete parameters[key];
    }
  }
}

function setIfSupported(
  target: JsonObject,
  supportedKeys: ReadonlySet<string> | null,
  key: string,
  value: unknown,
) {
  if (supportedKeys && !supportedKeys.has(key)) {
    return;
  }

  setIfMissing(target, key, value);
}

function readOrCreateFirstMessageContent(input: JsonObject) {
  const existingMessages = Array.isArray(input.messages)
    ? input.messages.filter(isJsonObject)
    : [];

  const firstMessage = existingMessages[0] ?? { role: 'user', content: [] };
  const content = Array.isArray(firstMessage.content)
    ? firstMessage.content.filter(isJsonObject)
    : [];

  firstMessage.role =
    typeof firstMessage.role === 'string' ? firstMessage.role : 'user';
  firstMessage.content = content;
  input.messages = [firstMessage, ...existingMessages.slice(1)];

  return content;
}

function mapTaskResponseToStatus(args: {
  payload: AlibabaCloudTaskResponse;
  generationId: string;
  metadata: JsonObject;
}): ProviderGenerationStatus {
  const status = args.payload.output?.task_status ?? '';
  const providerMetadata: JsonObject = {
    ...args.metadata,
    last_polled_at: new Date().toISOString(),
    last_status: status || null,
    request_id:
      typeof args.payload.request_id === 'string'
        ? args.payload.request_id
        : null,
  };

  if (status === 'SUCCEEDED') {
    const outputs = collectOutputUrls(args.payload);

    if (outputs.length === 0) {
      return {
        generation_id: args.generationId,
        generation_status: 'failed',
        generation_provider_used: 'alibabacloud',
        generation_error:
          'Alibaba Cloud reported SUCCEEDED without output URLs.',
        generation_error_code: 'provider_unexpected_response',
        provider_metadata: providerMetadata,
      };
    }

    return {
      generation_id: args.generationId,
      generation_status: 'succeeded',
      generation_provider_used: 'alibabacloud',
      generation_output_file: outputs,
      generation_completed_at: new Date().toISOString(),
      provider_metadata: providerMetadata,
    };
  }

  if (status === 'FAILED' || status === 'UNKNOWN') {
    return {
      generation_id: args.generationId,
      generation_status: 'failed',
      generation_provider_used: 'alibabacloud',
      generation_error:
        args.payload.output?.message ?? `Alibaba Cloud status: ${status}`,
      generation_error_code:
        args.payload.output?.code ??
        (status === 'UNKNOWN' ? 'provider_task_not_found' : 'provider_failed'),
      provider_metadata: providerMetadata,
    };
  }

  if (status === 'CANCELED') {
    return {
      generation_id: args.generationId,
      generation_status: 'canceled',
      generation_provider_used: 'alibabacloud',
      provider_metadata: providerMetadata,
    };
  }

  return {
    generation_id: args.generationId,
    generation_status: 'processing',
    generation_provider_used: 'alibabacloud',
    provider_metadata: providerMetadata,
  };
}

type AlibabaCloudTaskResponse = {
  request_id?: string;
  code?: string;
  message?: string;
  output?: {
    task_id?: string;
    task_status?: string;
    image_url?: string;
    video_url?: string;
    code?: string;
    message?: string;
    choices?: Array<{
      message?: {
        content?: Array<{ image?: string; video_url?: string; url?: string }>;
      };
    }>;
    results?: Array<{ url?: string; image_url?: string; video_url?: string }>;
  };
};

function collectOutputUrls(payload: AlibabaCloudTaskResponse) {
  const output = payload.output;
  const urls: string[] = [];

  if (!output) {
    return urls;
  }

  for (const value of [output.image_url, output.video_url]) {
    if (isNonEmptyString(value)) {
      urls.push(value);
    }
  }

  for (const choice of output.choices ?? []) {
    for (const item of choice.message?.content ?? []) {
      for (const value of [item.image, item.video_url, item.url]) {
        if (isNonEmptyString(value)) {
          urls.push(value);
        }
      }
    }
  }

  for (const result of output.results ?? []) {
    for (const value of [result.url, result.image_url, result.video_url]) {
      if (isNonEmptyString(value)) {
        urls.push(value);
      }
    }
  }

  return [...new Set(urls)];
}

function readTaskId(payload: AlibabaCloudTaskResponse) {
  const taskId = payload.output?.task_id;
  return isNonEmptyString(taskId) ? taskId : null;
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
      'Alibaba Cloud endpoints must be HTTPS.',
      400,
    );
  }

  if (!isAllowedAlibabaCloudHost(parsed.hostname)) {
    throw new AppError(
      'provider_request_blocked',
      'Alibaba Cloud endpoint host is not in the allowlist.',
      400,
    );
  }

  const resolved = await lookupAllowedNetworkAddress(parsed.hostname);
  if (!resolved) {
    throw new AppError(
      'provider_request_blocked',
      'Alibaba Cloud endpoint host resolves to a blocked address.',
      400,
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    throw new AppError(
      'provider_network_error',
      `Alibaba Cloud request failed: ${error instanceof Error ? error.message : 'network error'}`,
      502,
    );
  }

  if (!response.ok) {
    const text = await safeReadText(response);
    throw new AppError(
      mapAlibabaCloudErrorCode(response.status),
      `Alibaba Cloud responded ${response.status}${text ? `: ${truncate(text, 500)}` : ''}`,
      response.status === 429 ? 429 : 502,
    );
  }

  return response;
}

function isAllowedAlibabaCloudHost(hostname: string) {
  const lower = hostname.toLowerCase();
  return lower === ALIBABA_CLOUD_HOST;
}

function mapAlibabaCloudErrorCode(status: number) {
  if (status === 401 || status === 403) return 'provider_unauthorized';
  if (status === 404) return 'provider_not_found';
  if (status === 409) return 'provider_invalid_request';
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

function assertModelId(value: string) {
  if (!/^[A-Za-z0-9._\-/:]+$/.test(value) || value.length === 0) {
    throw new AppError(
      'invalid_model_identifier',
      'Alibaba Cloud model identifier contains invalid characters.',
      400,
    );
  }
}

function compactJsonObject(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as JsonObject;
}

function setIfMissing(target: JsonObject, key: string, value: unknown) {
  if (target[key] !== undefined || value === undefined || value === null) {
    return;
  }

  target[key] = value as JsonValue;
}

function collectStringValues(value: unknown) {
  if (isNonEmptyString(value)) {
    return [value];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isNonEmptyString);
}

function readNonEmptyString(value: unknown) {
  return isNonEmptyString(value) ? value : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasTextContent(value: JsonObject) {
  return typeof value.text === 'string' && value.text.length > 0;
}

function hasImageContent(value: JsonObject) {
  return typeof value.image === 'string' && value.image.length > 0;
}

function normalizeResolution(value: string | null) {
  if (!value) return undefined;
  const upper = value.trim().toUpperCase();
  return upper.endsWith('P') ? upper : value;
}

function normalizeSize(value: string) {
  return value.replace(/x/i, '*');
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
