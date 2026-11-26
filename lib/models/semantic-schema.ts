import 'server-only';

import {
  getModel as getSemanticLadyModel,
  listModelNames as listSemanticLadyModelNames,
  type SemanticLadyField,
  type SemanticLadyModel,
} from 'semantic-lady';

import {
  filterChainSchemaFields,
  type ChainSchemaStepRole,
  type SemanticChainFieldMode,
} from '@/lib/models/chain-schema';
import { AppError } from '@/lib/utils/errors';

import {
  getMediaDrivenModelVariant,
  getMediaDrivenRequiredCallerField,
  resolveSemanticModelIdentifier,
} from './media-driven-variants';

/**
 * Semantic Lady is the `generation_*` schema core for BYOK mode. the app
 * model identifiers map 1:1 onto Semantic Lady `apiName`s, so the published
 * catalog defines which unified fields each of the 57 models accepts and the
 * value constraints for those fields.
 *
 * The unified `generation_*` vocabulary is checked so typos and invalid
 * values fail fast at run creation instead of surfacing as opaque provider
 * 4xx errors.
 */

/**
 * Keys consumed by the chain runner or provider adapters rather than the
 * model schema:
 *
 *   - `generation_provider_order` is a BabySea-mode concept that BYOK
 *     adapters skip.
 */
const CHAIN_LEVEL_GENERATION_KEYS = new Set(['generation_provider_order']);

const UNKNOWN_KEY_DISPLAY_LIMIT = 100;

export type SemanticRequestSchemaOptions = {
  allowInputImageFile?: boolean;
  allowInputVideoFile?: boolean;
  chainFieldMode?: SemanticChainFieldMode;
};

const SEMANTIC_MODEL_NAMES: ReadonlySet<string> = new Set(
  listSemanticLadyModelNames(),
);

export function hasSemanticModel(modelIdentifier: string): boolean {
  return SEMANTIC_MODEL_NAMES.has(
    resolveSemanticModelIdentifier(modelIdentifier),
  );
}

export function getSemanticModel(
  modelIdentifier: string,
): SemanticLadyModel | null {
  return (
    getSemanticLadyModel(resolveSemanticModelIdentifier(modelIdentifier)) ??
    null
  );
}

export function getSemanticModelSchemaFields(
  modelIdentifier: string,
  options: SemanticRequestSchemaOptions = {},
): readonly SemanticLadyField[] | null {
  const model = getSemanticModel(modelIdentifier);

  if (!model) {
    return null;
  }

  if (options.chainFieldMode !== 'downstream') {
    return model.schema;
  }

  return filterChainSchemaFields(model.schema, 'video', {
    allowInputImageFile: options.allowInputImageFile === true,
    allowInputVideoFile: options.allowInputVideoFile === true,
  });
}

export function getMediaDrivenSchemaOptionsForRole(
  modelIdentifier: string,
  role: ChainSchemaStepRole,
): Pick<
  SemanticRequestSchemaOptions,
  'allowInputImageFile' | 'allowInputVideoFile'
> {
  if (role !== 'video' && role !== 'modify') {
    return {};
  }

  const field = getMediaDrivenRequiredCallerField(modelIdentifier, role);

  if (field === 'generation_input_image_file') {
    return { allowInputImageFile: true };
  }

  if (field === 'generation_input_video_file') {
    return { allowInputVideoFile: true };
  }

  return {};
}

export type SemanticJsonObject = Record<string, unknown>;

export function createSemanticRequestSchema(
  modelIdentifier: string,
  options: SemanticRequestSchemaOptions = {},
): SemanticJsonObject {
  const fields = getSemanticModelSchemaFields(modelIdentifier, options) ?? [];
  const required = fields
    .filter((field) => field.required)
    .map((field) => field.name);

  return {
    type: 'object',
    ...(required.length > 0 ? { required } : {}),
    properties: Object.fromEntries(
      fields.map((field) => [field.name, semanticFieldJsonSchema(field)]),
    ),
  };
}

export function semanticFieldJsonSchema(field: {
  default?: unknown;
  enum?: readonly (number | string)[];
  max?: number;
  min?: number;
  type: string;
}): SemanticJsonObject {
  const schema: SemanticJsonObject = {
    type: semanticJsonType(field.type),
  };

  if (field.enum && field.enum.length > 0) {
    schema.enum = [...field.enum];
  }

  if (field.default !== undefined) {
    schema.default = field.default;
  }

  if (typeof field.min === 'number') {
    schema.minimum = field.min;
  }

  if (typeof field.max === 'number') {
    schema.maximum = field.max;
  }

  if (field.type === 'integer') {
    schema.type = 'integer';
  }

  if (field.type === 'url-array' || field.type === 'string-array') {
    schema.items = {
      type: 'string',
      ...(field.type === 'url-array' ? { format: 'uri' } : {}),
    };
  }

  if (field.type === 'url') {
    schema.format = 'uri';
  }

  return schema;
}

function semanticJsonType(type: string) {
  switch (type) {
    case 'boolean':
      return 'boolean';
    case 'integer':
      return 'integer';
    case 'number':
      return 'number';
    case 'object':
      return 'object';
    case 'string-array':
    case 'url-array':
      return 'array';
    default:
      return 'string';
  }
}

/**
 * Chain step role gates, derived entirely from the Semantic Lady catalog so
 * the app never hand-maintains per-model role tables:
 *
 *   - `image_model`  : kind `image`.
 *   - `refine_model` : kind `image` with the `image-to-image` workflow (the
 *                      chain wires the previous image output in).
 *   - `video_model`  : kind `video` with the `image-to-video` workflow.
 *   - `modify_model` : kind `video` with the `video-to-video` workflow.
 *
 * Prompt-driven video roles require the model to accept `generation_prompt`.
 * Media-driven transfer models are exposed as the app-specific variants:
 * `(Image)` variants run as video steps, and `(Video)` variants run as modify
 * steps.
 */
export function isImageChainModel(modelIdentifier: string): boolean {
  return getSemanticModel(modelIdentifier)?.kind === 'image';
}

export function isImageInputCapableModel(modelIdentifier: string): boolean {
  const model = getSemanticModel(modelIdentifier);

  return model?.kind === 'image' && model.workflows.includes('image-to-image');
}

export function isTextToImageCapableModel(modelIdentifier: string): boolean {
  const model = getSemanticModel(modelIdentifier);

  return model?.kind === 'image' && model.workflows.includes('text-to-image');
}

export function isImageToVideoChainModel(modelIdentifier: string): boolean {
  const variant = getMediaDrivenModelVariant(modelIdentifier);

  if (variant) {
    return variant.role === 'video';
  }

  const model = getSemanticModel(modelIdentifier);

  return (
    model?.kind === 'video' &&
    model.workflows.includes('image-to-video') &&
    hasGenerationPromptField(model)
  );
}

export function isMediaDrivenImageToVideoChainModel(
  modelIdentifier: string,
): boolean {
  const variant = getMediaDrivenModelVariant(modelIdentifier);

  return variant?.role === 'video';
}

export function isVideoToVideoChainModel(modelIdentifier: string): boolean {
  const variant = getMediaDrivenModelVariant(modelIdentifier);

  if (variant) {
    return variant.role === 'modify';
  }

  const model = getSemanticModel(modelIdentifier);

  return (
    model?.kind === 'video' &&
    model.workflows.includes('video-to-video') &&
    hasGenerationPromptField(model)
  );
}

function hasGenerationPromptField(model: SemanticLadyModel): boolean {
  return model.schema.some((field) => field.name === 'generation_prompt');
}

export type ByokGenerationFieldIssue = {
  message: string;
  path: string[];
};

/**
 * Validate the `generation_*` fields of one BYOK model input object against
 * the Semantic Lady schema for the model. Returns `null` when the input is
 * valid (or when the model is unknown to Semantic Lady, which the model
 * library rejects separately).
 */
export function findByokGenerationFieldIssue(
  modelIdentifier: string,
  params: unknown,
  options: SemanticRequestSchemaOptions = {},
): ByokGenerationFieldIssue | null {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return null;
  }

  const model = getSemanticModel(modelIdentifier);

  if (!model) {
    return null;
  }

  const fieldByName = new Map<string, SemanticLadyField>(
    model.schema.map((field) => [field.name, field]),
  );
  const paramsRecord = params as Record<string, unknown>;

  for (const [key, value] of Object.entries(paramsRecord)) {
    if (!key.startsWith('generation_') || value === undefined) {
      continue;
    }

    if (CHAIN_LEVEL_GENERATION_KEYS.has(key)) {
      continue;
    }

    const field = fieldByName.get(key);

    if (!field) {
      return {
        message: unknownFieldMessage(key, modelIdentifier, model),
        path: [key],
      };
    }

    const valueIssue = findFieldValueIssue(field, key, value);

    if (valueIssue) {
      return valueIssue;
    }
  }

  const requiredFields =
    options.chainFieldMode === 'downstream'
      ? filterChainSchemaFields(model.schema, 'video', {
          allowInputImageFile: options.allowInputImageFile === true,
          allowInputVideoFile: options.allowInputVideoFile === true,
        })
      : model.schema;

  for (const field of requiredFields) {
    if (!field.required) {
      continue;
    }

    if (hasProvidedSemanticValue(paramsRecord[field.name])) {
      continue;
    }

    return issue(field.name, 'is required.');
  }

  return null;
}

export function assertByokGenerationFields(
  modelIdentifier: string,
  params: unknown,
  paramsKey: string,
  options: SemanticRequestSchemaOptions = {},
) {
  const issue = findByokGenerationFieldIssue(modelIdentifier, params, options);

  if (!issue) {
    return;
  }

  throw new AppError('invalid_chain_input', issue.message, 400, {
    path: [paramsKey, ...issue.path],
  });
}

function hasProvidedSemanticValue(value: unknown) {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return true;
}

function findFieldValueIssue(
  field: SemanticLadyField,
  key: string,
  value: unknown,
): ByokGenerationFieldIssue | null {
  switch (field.type) {
    case 'boolean':
      if (typeof value !== 'boolean') {
        return issue(key, 'must be a boolean.');
      }
      return null;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return issue(key, 'must be an integer.');
      }
      return (
        numberEnumIssue(field, key, value) ??
        numberBoundsIssue(field, key, value)
      );
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return issue(key, 'must be a finite number.');
      }
      return (
        numberEnumIssue(field, key, value) ??
        numberBoundsIssue(field, key, value)
      );
    case 'enum':
      return enumIssue(field, key, value);
    case 'string':
    case 'url':
      if (typeof value !== 'string') {
        return issue(key, 'must be a string.');
      }
      return null;
    case 'string-array':
    case 'url-array':
      if (
        !Array.isArray(value) ||
        !value.every((item) => typeof item === 'string' && item.length > 0)
      ) {
        return issue(key, 'must be an array of non-empty strings.');
      }
      return null;
    case 'object':
      if (!value || typeof value !== 'object') {
        return issue(key, 'must be an object or array.');
      }
      return null;
    default:
      return null;
  }
}

function enumIssue(
  field: SemanticLadyField,
  key: string,
  value: unknown,
): ByokGenerationFieldIssue | null {
  if (typeof value !== 'string') {
    return issue(key, 'must be a string.');
  }

  const allowed = field.enum ?? [];
  const normalized = value.toLowerCase();

  if (
    allowed.some((candidate) => String(candidate).toLowerCase() === normalized)
  ) {
    return null;
  }

  return issue(key, `must be one of: ${allowed.join(', ')}.`);
}

function numberEnumIssue(
  field: SemanticLadyField,
  key: string,
  value: number,
): ByokGenerationFieldIssue | null {
  const enumValues = (field.enum ?? []) as readonly unknown[];
  const allowed = enumValues.filter(
    (candidate): candidate is number => typeof candidate === 'number',
  );

  if (allowed.length === 0 || allowed.includes(value)) {
    return null;
  }

  return issue(key, `must be one of: ${allowed.join(', ')}.`);
}

function numberBoundsIssue(
  field: SemanticLadyField,
  key: string,
  value: number,
): ByokGenerationFieldIssue | null {
  if (field.min !== undefined && value < field.min) {
    return issue(key, `must be >= ${field.min}.`);
  }

  if (field.max !== undefined && value > field.max) {
    return issue(key, `must be <= ${field.max}.`);
  }

  return null;
}

function unknownFieldMessage(
  key: string,
  modelIdentifier: string,
  model: SemanticLadyModel,
) {
  const supported = model.schema
    .map((field) => field.name)
    .sort((a, b) => a.localeCompare(b))
    .join(', ');
  const displayKey =
    key.length > UNKNOWN_KEY_DISPLAY_LIMIT
      ? `${key.slice(0, UNKNOWN_KEY_DISPLAY_LIMIT)}…`
      : key;

  return (
    `Unknown generation field "${displayKey}" for model "${modelIdentifier}". ` +
    `Supported generation fields: ${supported}. ` +
    'Use the Semantic Lady schema returned by GET /api/v1/models/{modelId}.'
  );
}

function issue(key: string, message: string): ByokGenerationFieldIssue {
  return { message: `${key} ${message}`, path: [key] };
}
