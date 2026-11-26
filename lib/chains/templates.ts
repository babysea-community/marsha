import type { GenerationParams } from 'babysea';
import { z } from 'zod';

import { AppError } from '@/lib/utils/errors';
import {
  chainFieldModeForRole,
  isChainWiredSemanticFieldName,
  type ChainSchemaStepRole,
} from '@/lib/models/chain-schema';
import { getMediaDrivenRequiredCallerField } from '@/lib/models/media-driven-variants';
import {
  assertByokGenerationFields,
  getMediaDrivenSchemaOptionsForRole,
  getSemanticModel,
  getSemanticModelSchemaFields,
  isImageChainModel,
  isImageInputCapableModel,
  isImageToVideoChainModel,
  isTextToImageCapableModel,
  isVideoToVideoChainModel,
} from '@/lib/models/semantic-schema';
import {
  isBlockedNetworkHostname,
  lookupAllowedNetworkAddress,
} from '@/lib/security/network-safety';

import type {
  ChainInput,
  ChainStepTemplate,
  ChainStepOutput,
  ChainTemplate,
  ChainTemplateSummary,
} from './types';
import { deriveChainInputFields } from './schema-fields';

const StepModelInputSchemaBase = z
  .record(z.string(), z.unknown())
  .superRefine((modelInput, context) => {
    const credentialPath = findCredentialLikeParamPath(modelInput);
    const providerControlledPath = findProviderControlledParamPath(modelInput);

    if (credentialPath) {
      context.addIssue({
        code: 'custom',
        message:
          'Credential-like keys are not allowed in model input objects. Configure provider keys on the the app server env.',
        path: credentialPath,
      });
    }

    if (providerControlledPath) {
      context.addIssue({
        code: 'custom',
        message:
          'Provider-controlled keys are not allowed in model input objects. Select models and callbacks through the app fields.',
        path: providerControlledPath,
      });
    }

    for (const [key, value] of Object.entries(modelInput)) {
      if (value === undefined || key.startsWith('generation_')) {
        continue;
      }

      context.addIssue({
        code: 'custom',
        message:
          'Model input objects only accept Semantic Lady generation_* fields.',
        path: [key],
      });
    }

    const lastFrame = modelInput.generation_last_frame;

    if (lastFrame !== undefined && !isSafeHttpsUrlValue(lastFrame)) {
      context.addIssue({
        code: 'custom',
        message: 'generation_last_frame must be an HTTPS public URL.',
        path: ['generation_last_frame'],
      });
    }

    for (const key of [
      'generation_input_image_file',
      'generation_input_video_file',
      'generation_input_audio_file',
    ]) {
      const value = modelInput[key];

      if (
        value !== undefined &&
        (!Array.isArray(value) || !value.every(isSafeHttpsUrlValue))
      ) {
        context.addIssue({
          code: 'custom',
          message: `${key} must be an array of HTTPS public URLs.`,
          path: [key],
        });
      }
    }
  });

const StepModelInputSchema = StepModelInputSchemaBase.default({});
const OptionalStepModelInputSchema = StepModelInputSchemaBase.optional();

const CREDENTIAL_LIKE_KEYS = new Set([
  'apikey',
  'authorization',
  'authtoken',
  'accesstoken',
  'bearertoken',
  'dashscopeapikey',
  'secret',
  'secretkey',
  'accesskeyid',
  'accesskeysecret',
  'token',
  'xapikey',
  'xkey',
]);

const PROVIDER_CONTROLLED_STEP_PARAM_KEYS = new Set([
  'callbackurl',
  'generationcallbackurl',
  'generationmodel',
  'model',
]);

function expandChainModelsInput(value: unknown) {
  if (!isPlainRecord(value) || !isPlainRecord(value.chain_models)) {
    return value;
  }

  const { chain_models: chainModels, ...rest } = value;

  return {
    ...rest,
    ...Object.fromEntries(
      Object.entries(chainModels).filter(([key]) => key.endsWith('_model')),
    ),
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const ChainInputSchema = z.preprocess(
  normalizeChainInput,
  z
    .object({
      image_model: z.string().trim().min(1),
      refine_model: z.string().trim().min(1).optional(),
      video_model: z.string().trim().min(1),
      modify_model: z.string().trim().min(1).optional(),
      image_model_input: StepModelInputSchema,
      refine_model_input: OptionalStepModelInputSchema,
      video_model_input: StepModelInputSchema,
      modify_model_input: OptionalStepModelInputSchema,
    })
    .passthrough()
    .superRefine((input, context) => {
      rejectRootPrompt(input, context);
      rejectRootGenerationFields(input, context);
      rejectUnsupportedRootFields(input, context);
      requireRefineModelForRefineInput(input, context);
      requireModifyModelForModifyInput(input, context);
    }),
);

function normalizeChainInput(value: unknown) {
  const expanded = expandChainModelsInput(value);

  if (!isPlainRecord(expanded)) {
    return expanded;
  }

  const { chain_models: _chainModels, ...rest } = expanded;

  return rest;
}

const chainTemplate = defineChainTemplate({
  slug: 'chain',
  version: '2026-06-01',
  title:
    'image model → optional image model → image-to-video → optional video-to-video',
  description:
    'Run one image model, optionally pass the output through a second image model, hand the final image URL to one image-to-video model, then optionally modify the video output.',
  inputSchema: ChainInputSchema,
  inputFields: [
    {
      name: 'image_model',
      type: 'string',
      required: true,
      description: 'Image model used for the first step.',
    },
    {
      name: 'refine_model',
      type: 'string',
      required: false,
      description:
        'Optional second image model. When provided, the app passes the first image output into this model before the final image-to-video step.',
    },
    {
      name: 'video_model',
      type: 'string',
      required: true,
      description: 'image-to-video model used for the video step.',
    },
    {
      name: 'modify_model',
      type: 'string',
      required: false,
      description:
        'Optional video-to-video model. When provided, the app passes the video output into this model after the image-to-video step.',
    },
    {
      name: 'image_model_input',
      type: 'object',
      required: false,
      description:
        'First image model input. Use Semantic Lady generation_* fields.',
    },
    {
      name: 'refine_model_input',
      type: 'object',
      required: false,
      description:
        'Optional second image model input. Use Semantic Lady generation_* fields while the app supplies the previous image output.',
    },
    {
      name: 'video_model_input',
      type: 'object',
      required: false,
      description: 'Video model input. Use Semantic Lady generation_* fields.',
    },
    {
      name: 'modify_model_input',
      type: 'object',
      required: false,
      description:
        'Optional video-to-video model input. Use Semantic Lady generation_* fields while the app supplies the previous video output.',
    },
  ],
  steps: [
    {
      key: 'image',
      title: 'Run image model',
      kind: 'image',
      model: '${image_model}',
      dependsOn: [],
      estimate: () => ({ count: 1 }),
      buildParams: ({ input }) =>
        imageParams({
          input,
          paramsKey: 'image_model_input',
        }),
    },
    {
      key: 'refine',
      title: 'Run image model (2nd)',
      kind: 'image',
      model: '${refine_model}',
      dependsOn: ['image'],
      estimate: () => ({ count: 1 }),
      buildParams: ({ input, steps }) =>
        imageParams({
          input,
          inputFileUrl: firstStepOutput(steps.image),
          paramsKey: 'refine_model_input',
        }),
    },
    {
      key: 'video',
      title: 'Run video model',
      kind: 'video',
      model: '${video_model}',
      dependsOn: ['refine'],
      estimate: (input) => videoEstimate(input, 'video_model_input'),
      buildParams: ({ input, steps }) =>
        videoParams({
          input,
          inputFile: firstStepOutput(steps.refine ?? steps.image),
          paramsKey: 'video_model_input',
        }),
    },
    {
      key: 'modify',
      title: 'Run video model (2nd)',
      kind: 'video',
      model: '${modify_model}',
      dependsOn: ['video'],
      estimate: (input) => videoEstimate(input, 'modify_model_input'),
      buildParams: ({ input, steps }) =>
        videoParams({
          input,
          inputFile: firstStepOutput(steps.video),
          paramsKey: 'modify_model_input',
        }),
    },
  ],
});

const CHAIN_TEMPLATES = [chainTemplate];

export function listChainTemplates() {
  return CHAIN_TEMPLATES;
}

export function getChainTemplate(slug: string) {
  return CHAIN_TEMPLATES.find((template) => template.slug === slug) ?? null;
}

export function getChainTemplateSummaries(): ChainTemplateSummary[] {
  return CHAIN_TEMPLATES.map(toTemplateSummary);
}

export function parseTemplateInput(
  template: ChainTemplate,
  input: unknown,
  options: { agentDownstreamInputs?: boolean; byokMode?: boolean } = {},
) {
  const parsed = template.inputSchema.parse(input);
  normalizeEmptyModelInputPlaceholders(parsed);
  assertChainInputRequirements(template, parsed, options);
  return parsed;
}

export function assertChainInputRequirements(
  template: ChainTemplate,
  input: ChainInput,
  options: { agentDownstreamInputs?: boolean; byokMode?: boolean } = {},
) {
  normalizeEmptyModelInputPlaceholders(input);
  const byokMode = options.byokMode ?? false;
  const agentDownstreamInputs = options.agentDownstreamInputs === true;

  if (!byokMode && !agentDownstreamInputs) {
    requireVideoDuration(input);
  }

  // Role gates run first so a wrong-role model produces a role error rather
  // than a field-level schema error.
  requireImageGenerationModel(input);

  if (hasSelectedRefineModel(input)) {
    requireRefineImageInputCapableModel(input);
  }

  requireImageToVideoModel(input);
  if (!agentDownstreamInputs) {
    requireMediaDrivenStepInput(input, 'video');
  }
  requireModifyVideoToVideoModel(input);
  if (!agentDownstreamInputs) {
    requireMediaDrivenStepInput(input, 'modify');
  }

  if (agentDownstreamInputs) {
    rejectAgentPlannedDownstreamPrompts(input);
  }

  rejectCallerHandoffInputs(input);

  if (hasInitialImageInput(input, { byokMode })) {
    requireImageInputCapableModel(input);
  } else {
    // No starting image: the first image step runs purely from the prompt, so
    // edit-only models (image-to-image without text-to-image) would fail at
    // the provider. Reject them up front, before any credit is spent.
    requireTextToImageModel(input);
  }

  rejectChainWiredImageInputs(input);

  if (byokMode) {
    assertByokGenerationFieldsForSteps(input, { agentDownstreamInputs });
  }
}

function normalizeEmptyModelInputPlaceholders(input: ChainInput) {
  for (const [modelKey, paramsKey, role] of STEP_MODEL_INPUT_PAIRS) {
    const modelIdentifier = optionalString(input[modelKey]);
    const params = input[paramsKey];

    if (!modelIdentifier || !isPlainRecord(params)) {
      continue;
    }

    const fields = getSemanticModelSchemaFields(modelIdentifier, {
      ...getMediaDrivenSchemaOptionsForRole(modelIdentifier, role),
      chainFieldMode: chainFieldModeForRole(role),
    });

    if (!fields) {
      continue;
    }

    const fieldByName = new Map<string, (typeof fields)[number]>(
      fields.map((field) => [field.name, field]),
    );

    for (const [key, value] of Object.entries(params)) {
      if (!key.startsWith('generation_')) {
        continue;
      }

      const field = fieldByName.get(key);

      if (!field || field.default !== undefined) {
        continue;
      }

      if (isEmptyModelInputPlaceholder(value)) {
        delete params[key];
      }
    }
  }
}

function isEmptyModelInputPlaceholder(value: unknown) {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === 'string') {
    return value.trim().length === 0;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return isPlainRecord(value) && Object.keys(value).length === 0;
}

const STEP_MODEL_INPUT_PAIRS = [
  ['image_model', 'image_model_input', 'image'],
  ['refine_model', 'refine_model_input', 'refine'],
  ['video_model', 'video_model_input', 'video'],
  ['modify_model', 'modify_model_input', 'modify'],
] as const;

/**
 * BYOK mode treats Semantic Lady as the `generation_*` schema core: every
 * unified field present in a step model input must exist in the model's
 * Semantic Lady schema and satisfy its value constraints.
 */
function assertByokGenerationFieldsForSteps(
  input: ChainInput,
  options: { agentDownstreamInputs?: boolean } = {},
) {
  for (const [modelKey, paramsKey, role] of STEP_MODEL_INPUT_PAIRS) {
    const modelIdentifier = optionalString(input[modelKey]);
    const params = input[paramsKey];

    if (!modelIdentifier) {
      continue;
    }

    if (options.agentDownstreamInputs && role !== 'image') {
      continue;
    }

    assertByokGenerationFields(modelIdentifier, params ?? {}, paramsKey, {
      ...getMediaDrivenSchemaOptionsForRole(modelIdentifier, role),
      chainFieldMode: chainFieldModeForRole(role),
    });
  }
}

function requireImageGenerationModel(input: ChainInput) {
  const modelIdentifier = optionalString(input.image_model);

  if (modelIdentifier && isImageChainModel(modelIdentifier)) {
    return;
  }

  throw new AppError(
    'invalid_chain_input',
    'The selected image_model is not an image generation model. Choose an image model for the image step.',
    400,
    { path: ['image_model'] },
  );
}

function requireImageToVideoModel(input: ChainInput) {
  const modelIdentifier = optionalString(input.video_model);

  if (modelIdentifier && isImageToVideoChainModel(modelIdentifier)) {
    return;
  }

  throw new AppError(
    'invalid_chain_input',
    'The selected video_model does not support the image-to-video workflow required by the chain video step. Choose an image-to-video model or a media-driven transfer model with a reference video input.',
    400,
    { path: ['video_model'] },
  );
}

function requireMediaDrivenStepInput(
  input: ChainInput,
  role: Extract<ChainSchemaStepRole, 'video' | 'modify'>,
) {
  const modelKey = role === 'video' ? 'video_model' : 'modify_model';
  const paramsKey =
    role === 'video' ? 'video_model_input' : 'modify_model_input';
  const modelIdentifier = optionalString(input[modelKey]);

  if (!modelIdentifier) {
    return;
  }

  const requiredField = getMediaDrivenRequiredCallerField(
    modelIdentifier,
    role,
  );

  if (!requiredField) {
    return;
  }

  const params = input[paramsKey];
  const callerMedia =
    params && typeof params === 'object' && !Array.isArray(params)
      ? (params as Record<string, unknown>)[requiredField]
      : undefined;

  if (hasProvidedInputValue(callerMedia)) {
    return;
  }

  throw new AppError(
    'invalid_chain_input',
    `${paramsKey}.${requiredField} is required for the selected media-driven ${role} model.`,
    400,
    { path: [paramsKey, requiredField] },
  );
}

function requireModifyVideoToVideoModel(input: ChainInput) {
  const modelIdentifier = optionalString(input.modify_model);

  if (!modelIdentifier || isVideoToVideoChainModel(modelIdentifier)) {
    requireModifyHandoffCompatibility(input);
    return;
  }

  throw new AppError(
    'invalid_chain_input',
    'The selected modify_model does not support the video-to-video workflow required by the chain modify step. Choose a prompt-driven video-to-video model or a media-driven video variant.',
    400,
    { path: ['modify_model'] },
  );
}

/**
 * Providers whose video-to-video inputs require a publicly reachable URL.
 * Google video models return data-video URIs, which these providers reject.
 */
const URL_ONLY_VIDEO_INPUT_PROVIDERS = new Set(['alibaba-cloud', 'byteplus']);

function requireModifyHandoffCompatibility(input: ChainInput) {
  const videoModelIdentifier = optionalString(input.video_model);
  const modifyModelIdentifier = optionalString(input.modify_model);

  if (!videoModelIdentifier || !modifyModelIdentifier) {
    return;
  }

  const videoModel = getSemanticModel(videoModelIdentifier);
  const modifyModel = getSemanticModel(modifyModelIdentifier);

  if (!videoModel || !modifyModel) {
    return;
  }

  if (
    videoModel.provider === 'google' &&
    URL_ONLY_VIDEO_INPUT_PROVIDERS.has(modifyModel.provider)
  ) {
    throw new AppError(
      'invalid_chain_input',
      'The selected modify_model cannot accept the selected video_model output. Choose a video-to-video model that accepts data-video handoffs or choose a video_model that returns a public video URL.',
      400,
      { path: ['modify_model'] },
    );
  }
}

function requireImageInputCapableModel(input: ChainInput) {
  const modelIdentifier = optionalString(input.image_model);

  if (modelIdentifier && isImageInputCapableModel(modelIdentifier)) {
    return;
  }

  throw new AppError(
    'invalid_chain_input',
    'The selected image_model does not accept image input. Choose an image-input-capable image model or remove image_model_input.generation_input_image_file.',
    400,
    { path: ['image_model'] },
  );
}

function requireTextToImageModel(input: ChainInput) {
  const modelIdentifier = optionalString(input.image_model);

  if (modelIdentifier && isTextToImageCapableModel(modelIdentifier)) {
    return;
  }

  throw new AppError(
    'invalid_chain_input',
    'The selected image_model only supports the image-to-image workflow. Provide a starting image in image_model_input.generation_input_image_file or choose a text-to-image model.',
    400,
    { path: ['image_model'] },
  );
}

function requireRefineImageInputCapableModel(input: ChainInput) {
  const modelIdentifier = optionalString(input.refine_model);

  if (modelIdentifier && isImageInputCapableModel(modelIdentifier)) {
    return;
  }

  throw new AppError(
    'invalid_chain_input',
    'The selected refine_model does not accept image input. Choose an image-input-capable image model or remove refine_model.',
    400,
    { path: ['refine_model'] },
  );
}

function hasInitialImageInput(
  input: ChainInput,
  options: { byokMode?: boolean } = {},
) {
  const params = input.image_model_input;
  const paramsRecord =
    params && typeof params === 'object' && !Array.isArray(params)
      ? (params as Record<string, unknown>)
      : null;

  if (!paramsRecord) {
    return false;
  }

  const inputImageFile = paramsRecord.generation_input_image_file;

  if (Array.isArray(inputImageFile) && inputImageFile.length > 0) {
    return true;
  }

  return Boolean(options.byokMode && hasRawProviderImageInput(paramsRecord));
}

export function selectChainTemplateSteps(
  template: ChainTemplate,
  input: ChainInput,
): ChainStepTemplate[] {
  if (template.slug !== 'chain') {
    return template.steps;
  }

  const hasRefineStep = hasSelectedRefineModel(input);
  const hasModifyStep = hasSelectedModifyModel(input);

  return template.steps
    .filter((step) => hasRefineStep || step.key !== 'refine')
    .filter((step) => hasModifyStep || step.key !== 'modify')
    .map((step) => {
      if (step.key !== 'video') {
        return step;
      }

      return {
        ...step,
        dependsOn: [hasRefineStep ? 'refine' : 'image'],
      };
    });
}

function hasSelectedRefineModel(input: ChainInput) {
  return optionalString(input.refine_model) !== undefined;
}

function hasSelectedModifyModel(input: ChainInput) {
  return optionalString(input.modify_model) !== undefined;
}

export function resolveStepModel(templateStepModel: string, input: ChainInput) {
  const match = /^\$\{([A-Za-z0-9_]+)\}$/.exec(templateStepModel);

  if (!match) {
    return templateStepModel;
  }

  const key = match[1];

  if (!key) {
    throw new Error('Invalid step model token.');
  }

  return stringValue(input[key]);
}

export async function assertSafeChainInputTargets(input: ChainInput) {
  await assertSafeUrlTargets(collectChainInputUrls(input));
}

export async function assertSafeGenerationParamsTargets(params: unknown) {
  await assertSafeUrlTargets(collectGenerationParamUrls(params));
}

function defineChainTemplate(template: ChainTemplate) {
  assertChainTemplateInvariants(template);
  return template;
}

export function assertChainTemplateInvariants(template: ChainTemplate) {
  if (template.steps.length === 0) {
    throw new Error(`Chain template "${template.slug}" must define steps.`);
  }

  assertUniqueStepKeys(template);
  assertStepDependencies(template);
  assertStepModelTokens(template);
}

function assertStepDependencies(template: ChainTemplate) {
  const earlierStepKeys = new Set<string>();

  for (const step of template.steps) {
    for (const dependency of step.dependsOn) {
      if (!earlierStepKeys.has(dependency)) {
        throw new Error(
          `Step "${step.key}" in chain template "${template.slug}" depends on unknown or later step "${dependency}".`,
        );
      }
    }

    earlierStepKeys.add(step.key);
  }
}

function assertStepModelTokens(template: ChainTemplate) {
  const inputFieldNames = new Set(
    deriveChainInputFields(template.inputSchema, template.inputFields).map(
      (field) => field.name,
    ),
  );

  for (const step of template.steps) {
    const match = /^\$\{([A-Za-z0-9_]+)\}$/.exec(step.model);

    if (!match) {
      continue;
    }

    const token = match[1];

    if (token && !inputFieldNames.has(token)) {
      throw new Error(
        `Step "${step.key}" in chain template "${template.slug}" references unknown model input "${token}".`,
      );
    }
  }
}

function rejectRootPrompt(
  input: Record<string, unknown>,
  context: z.RefinementCtx,
) {
  for (const key of ['prompt', 'generation_prompt']) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) {
      continue;
    }

    context.addIssue({
      code: 'custom',
      message:
        'Use generation_prompt inside each model input object instead of a top-level prompt.',
      path: [key],
    });
  }
}

const ROOT_GENERATION_FIELDS = [
  'image_prompt',
  'refine_prompt',
  'video_prompt',
  'modify_prompt',
  'image_ratio',
  'video_ratio',
  'image_output_format',
  'image_size',
  'video_duration',
  'video_resolution',
  'video_generate_audio',
  'provider_order',
] as const;

const SUPPORTED_ROOT_FIELDS = new Set([
  'image_model',
  'refine_model',
  'video_model',
  'modify_model',
  'image_model_input',
  'refine_model_input',
  'video_model_input',
  'modify_model_input',
]);

const ROOT_PROMPT_FIELDS = new Set(['prompt', 'generation_prompt']);
const ROOT_GENERATION_FIELD_SET = new Set<string>(ROOT_GENERATION_FIELDS);

function rejectRootGenerationFields(
  input: Record<string, unknown>,
  context: z.RefinementCtx,
) {
  for (const key of ROOT_GENERATION_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) {
      continue;
    }

    context.addIssue({
      code: 'custom',
      message: `Use model input objects for generation fields instead of top-level ${key}.`,
      path: [key],
    });
  }
}

function rejectUnsupportedRootFields(
  input: Record<string, unknown>,
  context: z.RefinementCtx,
) {
  for (const key of Object.keys(input)) {
    if (
      SUPPORTED_ROOT_FIELDS.has(key) ||
      ROOT_PROMPT_FIELDS.has(key) ||
      ROOT_GENERATION_FIELD_SET.has(key)
    ) {
      continue;
    }

    context.addIssue({
      code: 'custom',
      message: `Unsupported top-level input field ${key}. Put model-specific content inside image_model_input, refine_model_input, video_model_input, or modify_model_input.`,
      path: [key],
    });
  }
}

function requireRefineModelForRefineInput(
  input: Record<string, unknown>,
  context: z.RefinementCtx,
) {
  const hasRefineParams = input.refine_model_input !== undefined;

  if (!hasRefineParams) {
    return;
  }

  if (optionalString(input.refine_model)) {
    return;
  }

  context.addIssue({
    code: 'custom',
    message: 'Provide refine_model when using refine_model_input.',
    path: ['refine_model'],
  });
}

function requireModifyModelForModifyInput(
  input: Record<string, unknown>,
  context: z.RefinementCtx,
) {
  const hasModifyParams = input.modify_model_input !== undefined;

  if (!hasModifyParams) {
    return;
  }

  if (optionalString(input.modify_model)) {
    return;
  }

  context.addIssue({
    code: 'custom',
    message: 'Provide modify_model when using modify_model_input.',
    path: ['modify_model'],
  });
}

// In chain_agent mode the Agentic Workflow authors every downstream step
// prompt, so a caller-supplied refine/video/modify prompt would be silently
// discarded. Reject it up front with a clear contract: steer the planner with
// metadata.model_context, or switch to self_control to write prompts directly.
// The base image prompt stays caller-authored and is intentionally excluded.
const AGENT_PLANNED_DOWNSTREAM_INPUT_KEYS = [
  'refine_model_input',
  'video_model_input',
  'modify_model_input',
] as const;

function rejectAgentPlannedDownstreamPrompts(input: ChainInput) {
  for (const paramsKey of AGENT_PLANNED_DOWNSTREAM_INPUT_KEYS) {
    const params = input[paramsKey];

    if (!isPlainRecord(params)) {
      continue;
    }

    if (optionalString(params.generation_prompt) === undefined) {
      continue;
    }

    throw new AppError(
      'invalid_chain_input',
      `${paramsKey}.generation_prompt is not allowed in chain_agent mode: the Agentic Workflow writes downstream prompts. Steer it with metadata.model_context, or use execution.type "self_control" to author the prompt yourself.`,
      400,
      { path: [paramsKey, 'generation_prompt'] },
    );
  }
}

function requireVideoDuration(input: Record<string, unknown>) {
  const params = input.video_model_input;
  const paramsRecord =
    params && typeof params === 'object' && !Array.isArray(params)
      ? (params as Record<string, unknown>)
      : null;
  const paramDurationValue = paramsRecord?.generation_duration;
  const hasParamDuration = paramDurationValue !== undefined;
  const paramDuration = optionalPositiveNumber(paramDurationValue);
  if (hasParamDuration && paramDuration === undefined) {
    throw new AppError(
      'invalid_chain_input',
      'video_model_input.generation_duration must be a positive number.',
      400,
      { path: ['video_model_input', 'generation_duration'] },
    );
  }

  if (paramDuration !== undefined) {
    return;
  }

  throw new AppError(
    'invalid_chain_input',
    'Provide video_model_input.generation_duration so the app can route the image-to-video step through BabySea video generation.',
    400,
    { path: ['video_model_input', 'generation_duration'] },
  );
}

function hasRawProviderImageInput(params: Record<string, unknown>) {
  return findProviderChainWiredMediaParamPath(params) !== null;
}

function rejectCallerHandoffInputs(input: ChainInput) {
  for (const paramsKey of [
    'image_model_input',
    'refine_model_input',
    'video_model_input',
    'modify_model_input',
  ] as const) {
    const params = input[paramsKey];

    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      continue;
    }

    const value = (params as Record<string, unknown>).generation_input_file;

    if (!hasProvidedInputValue(value)) {
      continue;
    }

    throw new AppError(
      'invalid_chain_input',
      'generation_input_file is reserved for the app step handoffs. Use generation_input_image_file for caller-supplied image input on image_model_input.',
      400,
      { path: [paramsKey, 'generation_input_file'] },
    );
  }
}

function rejectChainWiredImageInputs(input: ChainInput) {
  for (const paramsKey of [
    'refine_model_input',
    'video_model_input',
    'modify_model_input',
  ] as const) {
    const params = input[paramsKey];
    const role = roleForModelInputKey(paramsKey);
    const modelIdentifier = optionalString(input[modelKeyForRole(role)]);
    const allowedField =
      role === 'video' || role === 'modify'
        ? getMediaDrivenRequiredCallerField(modelIdentifier ?? '', role)
        : null;
    const path =
      findProviderChainWiredOverrideParamPath(params) ??
      findProviderChainWiredMediaParamPath(params, [], {
        allowGenerationInputImageFile:
          allowedField === 'generation_input_image_file',
        allowGenerationInputVideoFile:
          allowedField === 'generation_input_video_file',
      });

    if (!path) {
      continue;
    }

    const fullPath = [paramsKey, ...path];

    throw new AppError(
      'invalid_chain_input',
      `The app supplies ${paramsKey} input from the previous step. Remove ${fullPath.join('.')}.`,
      400,
      { path: fullPath },
    );
  }
}

function roleForModelInputKey(
  paramsKey: 'refine_model_input' | 'video_model_input' | 'modify_model_input',
): Exclude<ChainSchemaStepRole, 'image'> {
  if (paramsKey === 'refine_model_input') {
    return 'refine';
  }

  return paramsKey === 'video_model_input' ? 'video' : 'modify';
}

function modelKeyForRole(role: Exclude<ChainSchemaStepRole, 'image'>) {
  switch (role) {
    case 'refine':
      return 'refine_model';
    case 'video':
      return 'video_model';
    case 'modify':
      return 'modify_model';
  }
}

function findProviderChainWiredOverrideParamPath(
  value: unknown,
  path: string[] = [],
): string[] | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const nestedPath = findProviderChainWiredOverrideParamPath(item, [
        ...path,
        String(index),
      ]);

      if (nestedPath) {
        return nestedPath;
      }
    }

    return null;
  }

  for (const [key, entryValue] of Object.entries(value)) {
    if (
      PROVIDER_CHAIN_WIRED_OVERRIDE_KEYS.has(key) &&
      hasProvidedInputValue(entryValue)
    ) {
      return [...path, key];
    }

    const nestedPath = findProviderChainWiredOverrideParamPath(entryValue, [
      ...path,
      key,
    ]);

    if (nestedPath) {
      return nestedPath;
    }
  }

  return null;
}

function findProviderChainWiredMediaParamPath(
  value: unknown,
  path: string[] = [],
  options: {
    allowGenerationInputImageFile?: boolean;
    allowGenerationInputVideoFile?: boolean;
  } = {},
): string[] | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const nestedPath = findProviderChainWiredMediaParamPath(
        item,
        [...path, String(index)],
        options,
      );

      if (nestedPath) {
        return nestedPath;
      }
    }

    return null;
  }

  for (const [key, entryValue] of Object.entries(value)) {
    if (
      isProviderChainWiredMediaParamKey(key) &&
      hasProvidedInputValue(entryValue)
    ) {
      if (
        options.allowGenerationInputImageFile === true &&
        path.length === 0 &&
        key === 'generation_input_image_file'
      ) {
        continue;
      }

      if (
        options.allowGenerationInputVideoFile === true &&
        path.length === 0 &&
        key === 'generation_input_video_file'
      ) {
        continue;
      }

      return [...path, key];
    }

    const nestedPath = findProviderChainWiredMediaParamPath(
      entryValue,
      [...path, key],
      options,
    );

    if (nestedPath) {
      return nestedPath;
    }
  }

  return null;
}

function isProviderChainWiredMediaParamKey(key: string) {
  return (
    isChainWiredSemanticFieldName(key) ||
    PROVIDER_CHAIN_WIRED_MEDIA_PARAM_KEYS.has(key) ||
    /^input_image(?:_\d+)?$/.test(key)
  );
}

function hasProvidedInputValue(value: unknown) {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }

  return true;
}

const PROVIDER_CHAIN_WIRED_MEDIA_PARAM_KEYS = new Set([
  'character',
  'fileData',
  'image',
  'image_prompt',
  'image_url',
  'images',
  'inlineData',
  'input_images',
  'media',
  'promptImage',
  'referenceImages',
  'videoUri',
  'video_url',
  'input_image_blob_path',
]);

const PROVIDER_CHAIN_WIRED_OVERRIDE_KEYS = new Set(['contents', 'instances']);

function toTemplateSummary(template: ChainTemplate): ChainTemplateSummary {
  return {
    object: 'chain_template',
    slug: template.slug,
    version: template.version,
    title: template.title,
    description: template.description,
    input_fields: deriveChainInputFields(
      template.inputSchema,
      template.inputFields,
    ),
    steps: template.steps.map((step) => ({
      key: step.key,
      title: step.title,
      kind: step.kind,
      model: step.model,
      depends_on: step.dependsOn,
    })),
  };
}

function assertUniqueStepKeys(template: ChainTemplate) {
  const keys = new Set<string>();

  for (const step of template.steps) {
    if (keys.has(step.key)) {
      throw new Error(`Duplicate step key in ${template.slug}: ${step.key}`);
    }

    keys.add(step.key);
  }
}

function imageParams({
  input,
  inputFileUrl,
  paramsKey,
}: {
  input: ChainInput;
  inputFileUrl?: string;
  paramsKey: string;
}): GenerationParams {
  const modelParams = imageModelParams(input, paramsKey);
  const params: Record<string, unknown> = {
    ...modelParams,
    generation_output_number:
      optionalNumber(modelParams.generation_output_number) ?? 1,
  };

  if (inputFileUrl) {
    params.generation_input_file = [inputFileUrl];
  }

  return compactParams(params);
}

function videoParams({
  input,
  inputFile,
  paramsKey,
}: {
  input: ChainInput;
  inputFile: string;
  paramsKey: string;
}): GenerationParams {
  const modelParams = videoModelParams(input, paramsKey);

  return compactParams({
    ...modelParams,
    generation_output_format:
      optionalString(modelParams.generation_output_format) ?? 'mp4',
    generation_output_number:
      optionalNumber(modelParams.generation_output_number) ?? 1,
    generation_input_file: [inputFile],
  });
}

function videoEstimate(input: ChainInput, paramsKey: string) {
  const params = videoModelParams(input, paramsKey);

  return compactRecord({
    duration: optionalNumber(params.generation_duration),
    resolution: optionalString(params.generation_resolution),
    audio: optionalBoolean(params.generation_audio),
  });
}

function imageModelParams(input: ChainInput, paramsKey: string) {
  return {
    ...generationParamOverrides(input[paramsKey]),
  };
}

function videoModelParams(input: ChainInput, paramsKey: string) {
  return {
    ...generationParamOverrides(input[paramsKey]),
  };
}

function firstStepOutput(step: ChainStepOutput | undefined) {
  const output = step?.outputFiles.find(isSafeHandoffValue);

  if (!output) {
    throw new Error('Required previous step output is missing.');
  }

  return output;
}

function collectChainInputUrls(input: ChainInput) {
  const urls: string[] = [];

  if (typeof input.source_image_url === 'string') {
    urls.push(input.source_image_url);
  }

  for (const value of Object.values(input)) {
    urls.push(...collectGenerationParamUrls(value));
  }

  return urls;
}

function collectGenerationParamUrls(value: unknown) {
  const urls: string[] = [];
  const seen = new Set<object>();
  const stack: unknown[] = [value];

  while (stack.length > 0) {
    const current = stack.pop();

    if (typeof current === 'string') {
      if (isHttpUrlString(current)) {
        urls.push(current);
      }
      continue;
    }

    if (!current || typeof current !== 'object') {
      continue;
    }

    if (seen.has(current)) {
      continue;
    }

    seen.add(current);

    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }

    stack.push(...Object.values(current as Record<string, unknown>));
  }

  return urls;
}

async function assertSafeUrlTargets(urls: string[]) {
  for (const url of urls) {
    await assertSafeUrlTarget(url);
  }
}

async function assertSafeUrlTarget(url: string) {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw invalidUrlTarget();
  }

  if (!isSafeHttpsUrl(url)) {
    throw invalidUrlTarget();
  }

  const address = await lookupAllowedNetworkAddress(parsed.hostname);

  if (!address) {
    throw invalidUrlTarget('URL host must resolve to a public address.');
  }
}

function compactParams(params: Record<string, unknown>): GenerationParams {
  return compactRecord(params) as GenerationParams;
}

function compactRecord(params: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(params).filter((entry) => entry[1] !== undefined),
  );
}

function generationParamOverrides(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([key, entryValue]) =>
          key.startsWith('generation_') && entryValue !== undefined,
      )
      .map(([key, entryValue]) => [
        key,
        key === 'generation_output_format'
          ? normalizeBabySeaOutputFormat(entryValue)
          : entryValue,
      ]),
  );
}

function normalizeBabySeaOutputFormat(value: unknown) {
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === 'jpeg' ? 'jpg' : normalized;
}

function optionalString(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function stringValue(value: unknown) {
  const text = optionalString(value);

  if (!text) {
    throw new Error('Expected a non-empty string value.');
  }

  return text;
}

function optionalNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return undefined;
}

function optionalPositiveNumber(value: unknown) {
  const numberValue = optionalNumber(value);

  return numberValue !== undefined && numberValue > 0 ? numberValue : undefined;
}

function optionalBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

function findCredentialLikeParamPath(
  value: unknown,
  currentPath: (string | number)[] = [],
): (string | number)[] | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const nested = findCredentialLikeParamPath(value[index], [
        ...currentPath,
        index,
      ]);

      if (nested) {
        return nested;
      }
    }

    return null;
  }

  for (const [key, nestedValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (isCredentialLikeKey(key)) {
      return [...currentPath, key];
    }

    const nested = findCredentialLikeParamPath(nestedValue, [
      ...currentPath,
      key,
    ]);

    if (nested) {
      return nested;
    }
  }

  return null;
}

function isCredentialLikeKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (normalized.startsWith('xmarshaprovider')) {
    return true;
  }

  return (
    CREDENTIAL_LIKE_KEYS.has(normalized) ||
    normalized.endsWith('apikey') ||
    normalized.endsWith('secretkey') ||
    normalized.endsWith('accesskeysecret')
  );
}

function findProviderControlledParamPath(value: Record<string, unknown>) {
  for (const key of Object.keys(value)) {
    if (isProviderControlledStepParamKey(key)) {
      return [key];
    }
  }

  return null;
}

function isProviderControlledStepParamKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');

  return PROVIDER_CONTROLLED_STEP_PARAM_KEYS.has(normalized);
}

function isSafeHttpsUrl(value: string) {
  const parsed = new URL(value);

  return (
    parsed.protocol === 'https:' &&
    !parsed.username &&
    !parsed.password &&
    !isBlockedNetworkHostname(parsed.hostname)
  );
}

function isHttpUrlString(value: string) {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

function isSafeHttpsUrlValue(value: unknown) {
  if (typeof value !== 'string') {
    return false;
  }

  try {
    return isSafeHttpsUrl(value);
  } catch {
    return false;
  }
}

function isSafeHandoffValue(value: unknown) {
  return isSafeHttpsUrlValue(value) || isDataMediaUrlValue(value);
}

function isDataMediaUrlValue(value: unknown) {
  return (
    typeof value === 'string' &&
    /^data:(?:image|video)\/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+$/i.test(
      value.trim(),
    )
  );
}

function invalidUrlTarget(
  message = 'URL must be HTTPS and publicly reachable.',
) {
  return new AppError('invalid_chain_input', message, 400);
}
