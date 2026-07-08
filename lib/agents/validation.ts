import 'server-only';

import type { ChainAgentPromptContext, ChainAgentResult } from './types';
import type { JsonObject, JsonValue } from '@/lib/chains/types';

export type ChainAgentValidationResult =
  | { ok: true; checkedParams: string[] }
  | { ok: false; checkedParams: string[]; error: string };

type ChainAgentSchemaContext = {
  nextStep: { requestParams?: JsonObject | null; schema?: JsonObject | null };
};

export function completeChainAgentSelectedParams(
  selectedParams: JsonObject,
  context: ChainAgentSchemaContext,
  options: { pinPromptEnhancementOff?: boolean } = {},
): JsonObject {
  const schema = context.nextStep.schema;

  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return selectedParams;
  }

  const properties = schemaProperties(schema);
  const requestParams = isRecord(context.nextStep.requestParams)
    ? context.nextStep.requestParams
    : {};
  const completed: JsonObject = { ...selectedParams };

  // Some downstream schemas (for example video-to-video modify models) do not
  // declare generation_prompt. the app force-injects it for prompt-driven
  // steps, so drop it here when the schema does not accept it; otherwise the
  // run fails with "generation_prompt is not supported by the downstream schema".
  if (
    !('generation_prompt' in properties) &&
    'generation_prompt' in completed
  ) {
    delete completed.generation_prompt;
  }

  for (const fieldName of agentPlannedSchemaFields(properties)) {
    if (completed[fieldName] !== undefined && completed[fieldName] !== null) {
      continue;
    }

    if (isJsonValue(requestParams[fieldName])) {
      completed[fieldName] = requestParams[fieldName];
      continue;
    }

    const fallback = schemaFallbackValue(properties[fieldName]);
    if (fallback !== undefined) {
      completed[fieldName] = fallback;
    }
  }

  // Pin provider-native prompt enhancement OFF on the agent's PROPOSAL only
  // (pinPromptEnhancementOff): explicitly `false`, not absent, so the provider
  // cannot fall back to its own default-on. This same completion also runs for
  // the user's copilot approval and user-edited cards, where it must NOT
  // override the user's choice - so it is gated behind the flag.
  if (
    options.pinPromptEnhancementOff &&
    'generation_prompt_extend' in properties
  ) {
    completed.generation_prompt_extend = false;
  }

  return completed;
}

export function validateChainAgentResult(
  result: Pick<
    ChainAgentResult,
    'selectedParams' | 'selectedPrompt' | 'suggestions'
  >,
  context: ChainAgentPromptContext,
): ChainAgentValidationResult {
  const schema = context.nextStep.schema;
  const params = completeChainAgentSelectedParams(
    result.selectedParams,
    context,
  );
  const checkedParams = Object.keys(params).sort();
  const selectedParamsPrompt = promptString(params);

  if (selectedParamsPrompt && selectedParamsPrompt !== result.selectedPrompt) {
    return {
      ok: false,
      checkedParams,
      error:
        'selected_prompt must exactly match selected_params.generation_prompt.',
    };
  }

  if (!schema || typeof schema !== 'object') {
    return validatePromptEnhancement(result, context, checkedParams);
  }

  const required = Array.isArray(schema.required)
    ? schema.required.filter(
        (entry): entry is string => typeof entry === 'string',
      )
    : [];
  const properties = schemaProperties(schema);
  const plannedFields = agentPlannedSchemaFields(properties);

  for (const fieldName of plannedFields) {
    const field = properties[fieldName];
    const isRequired = required.includes(fieldName);

    if (!(fieldName in params)) {
      return {
        ok: false,
        checkedParams,
        error: `${fieldName} must be included in selected_params because it is defined by the downstream schema.`,
      };
    }

    if (isRequired && !hasProvidedAgentValue(params[fieldName])) {
      return {
        ok: false,
        checkedParams,
        error: `${fieldName} is required by the downstream schema.`,
      };
    }

    if (!isRequired && !hasOptionalAgentValue(params[fieldName], field)) {
      return {
        ok: false,
        checkedParams,
        error: `${fieldName} must be a schema-valid planned value.`,
      };
    }
  }

  for (const [key, value] of Object.entries(params)) {
    const field = properties[key];

    if (!field) {
      return {
        ok: false,
        checkedParams,
        error: `${key} is not supported by the downstream schema.`,
      };
    }

    const error = validateAgentFieldValue(key, value, field);
    if (error) {
      return { ok: false, checkedParams, error };
    }
  }

  return validatePromptEnhancement(
    { ...result, selectedParams: params },
    context,
    checkedParams,
  );
}

function schemaProperties(schema: JsonObject) {
  return schema.properties &&
    typeof schema.properties === 'object' &&
    !Array.isArray(schema.properties)
    ? (schema.properties as Record<string, JsonObject>)
    : {};
}

function schemaFallbackValue(
  field: JsonObject | undefined,
): JsonValue | undefined {
  if (!field) return undefined;

  if ('default' in field && isJsonValue(field.default)) {
    return field.default;
  }

  const enumValues = Array.isArray(field.enum)
    ? field.enum.filter(isJsonValue)
    : [];
  if (enumValues.length > 0) {
    return enumValues[0];
  }

  switch (field.type) {
    case 'string':
      return '';
    case 'integer':
      return typeof field.minimum === 'number' ? Math.ceil(field.minimum) : 0;
    case 'number':
      return typeof field.minimum === 'number' ? field.minimum : 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return undefined;
  }
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

  if (isRecord(value)) {
    return Object.values(value).every(isJsonValue);
  }

  return false;
}

function agentPlannedSchemaFields(properties: Record<string, JsonObject>) {
  return Object.keys(properties)
    .filter(
      (fieldName) =>
        fieldName.startsWith('generation_') &&
        !AGENT_RESERVED_SCHEMA_FIELDS.has(fieldName),
    )
    .sort();
}

const AGENT_RESERVED_SCHEMA_FIELDS = new Set([
  'generation_callback_url',
  'generation_input_audio_file',
  'generation_input_file',
  'generation_input_image_file',
  'generation_input_video_file',
  'generation_last_frame',
  'generation_output_file',
  'generation_provider_order',
  'generation_provider_used',
]);

function validatePromptEnhancement(
  result: Pick<
    ChainAgentResult,
    'selectedParams' | 'selectedPrompt' | 'suggestions'
  >,
  context: ChainAgentPromptContext,
  checkedParams: string[],
): ChainAgentValidationResult {
  const selected = normalizeComparablePrompt(result.selectedPrompt);
  const existing = normalizeComparablePrompt(
    stringValue(
      isRecord(context.nextStep.requestParams)
        ? context.nextStep.requestParams.generation_prompt
        : undefined,
    ) ?? '',
  );
  const previous = normalizeComparablePrompt(
    stringValue(
      isRecord(context.previousStep.requestParams)
        ? context.previousStep.requestParams.generation_prompt
        : undefined,
    ) ?? '',
  );
  const prompts = result.suggestions.map((suggestion) =>
    normalizeComparablePrompt(suggestion.prompt),
  );
  const uniquePrompts = new Set(prompts.filter(Boolean));

  if (existing && selected === existing) {
    return {
      ok: false,
      checkedParams,
      error:
        'selected_prompt is the same as the existing downstream prompt. Rewrite it with clearly improved motion, camera, pacing, and continuity details.',
    };
  }

  if (previous && selected === previous) {
    return {
      ok: false,
      checkedParams,
      error:
        'selected_prompt is the same as the previous step prompt. Rewrite it for the next step instead of copying the source prompt.',
    };
  }

  if (uniquePrompts.size < Math.min(3, result.suggestions.length)) {
    return {
      ok: false,
      checkedParams,
      error: 'suggestions must be meaningfully distinct from each other.',
    };
  }

  return { ok: true, checkedParams };
}

function promptString(value: unknown) {
  if (!isRecord(value)) return '';
  const prompt = value.generation_prompt;
  return typeof prompt === 'string' ? prompt : '';
}

function validateAgentFieldValue(
  key: string,
  value: JsonValue,
  field: JsonObject,
) {
  const enumValues = Array.isArray(field.enum) ? field.enum : [];
  if (enumValues.length > 0 && !enumValues.includes(value)) {
    return `${key} must be one of: ${enumValues.join(', ')}.`;
  }

  if (field.type === 'number' || field.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return `${key} must be a finite number.`;
    }

    if (field.type === 'integer' && !Number.isInteger(value)) {
      return `${key} must be an integer.`;
    }

    if (typeof field.minimum === 'number' && value < field.minimum) {
      return `${key} must be >= ${field.minimum}.`;
    }

    if (typeof field.maximum === 'number' && value > field.maximum) {
      return `${key} must be <= ${field.maximum}.`;
    }
  }

  if (field.type === 'boolean' && typeof value !== 'boolean') {
    return `${key} must be a boolean.`;
  }

  if (field.type === 'string' && typeof value !== 'string') {
    return `${key} must be a string.`;
  }

  if (field.type === 'array' && !Array.isArray(value)) {
    return `${key} must be an array.`;
  }

  if (
    field.type === 'object' &&
    (!value || typeof value !== 'object' || Array.isArray(value))
  ) {
    return `${key} must be an object.`;
  }

  return null;
}

function hasProvidedAgentValue(value: JsonValue | undefined) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function hasOptionalAgentValue(
  value: JsonValue | undefined,
  field?: JsonObject,
) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string' && value.trim().length === 0) {
    return field?.type === 'string';
  }
  return true;
}

function normalizeComparablePrompt(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
