import 'server-only';

import type { JsonObject } from '@/lib/chains/types';

import type { ChainAgentPromptContext } from '../types';

export type ChainAgentToolName =
  | 'read_downstream_schema'
  | 'read_previous_step_summary'
  | 'resolve_aspect_ratio'
  | 'select_schema_defaults'
  | 'retrieve_brand_context';

export type ChainAgentToolResult = {
  name: ChainAgentToolName;
  output: JsonObject;
};

export const CHAIN_AGENT_TOOL_STRATEGY = {
  current: 'prompt_planning_context_only',
  tools: [],
  note: 'The app currently passes previous-step context and downstream Semantic Lady schema as read-only planning context. Bedrock tool calling is not required until the agent needs external retrieval or multi-step API actions.',
} satisfies JsonObject;

export const CHAIN_AGENT_RESERVED_TOOL_FIELDS = [
  'generation_callback_url',
  'generation_input_audio_file',
  'generation_input_file',
  'generation_input_image_file',
  'generation_input_video_file',
  'generation_last_frame',
  'generation_output_file',
  'generation_provider_order',
  'generation_provider_used',
];

export function runChainAgentTools(
  context: ChainAgentPromptContext,
): ChainAgentToolResult[] {
  return [
    readDownstreamSchema(context),
    selectSchemaDefaults(context),
    resolveAspectRatio(context),
  ];
}

function readDownstreamSchema(
  context: ChainAgentPromptContext,
): ChainAgentToolResult {
  return {
    name: 'read_downstream_schema',
    output: {
      model_identifier: context.nextStep.modelIdentifier,
      schema_location: 'runtime_context.downstream_schema',
      step_key: context.nextStep.stepKey,
      step_kind: context.nextStep.stepKind,
    },
  };
}

function selectSchemaDefaults(
  context: ChainAgentPromptContext,
): ChainAgentToolResult {
  const schema = context.nextStep.schema;
  const properties =
    schema &&
    typeof schema.properties === 'object' &&
    !Array.isArray(schema.properties)
      ? (schema.properties as Record<string, JsonObject>)
      : {};
  const defaults: JsonObject = {};

  for (const [key, value] of Object.entries(properties)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      'default' in value
    ) {
      defaults[key] = value.default;
    }
  }

  return {
    name: 'select_schema_defaults',
    output: {
      defaults,
      note: 'Defaults are read-only context. The agent must return every downstream schema generation_* field that is not the app-owned media handoff, including advanced fields.',
      required: Array.isArray(schema?.required) ? schema.required : [],
    },
  };
}

// The whole chain must keep ONE consistent aspect ratio. The reasoning model
// is unreliable at deriving it from prose rules (it picked 16:9 and 9:16 for
// the same 1:1 base on different runs), so the app resolves it
// deterministically here and hands the planner the exact value to use.
function resolveAspectRatio(
  context: ChainAgentPromptContext,
): ChainAgentToolResult {
  const base = chainAspectRatio(context);
  const recommendation =
    base === null
      ? null
      : recommendAspectForSchema(base.ratio, context.nextStep.schema);

  return {
    name: 'resolve_aspect_ratio',
    output: {
      canonical_base_ratio: base ? Number(base.ratio.toFixed(4)) : null,
      basis: base
        ? base.basis
        : 'no aspect signal in previous params or base image input',
      recommended_field: recommendation ? recommendation.field : null,
      recommended_value: recommendation ? recommendation.value : null,
      note: 'Use recommended_value verbatim for this step aspect field so the whole chain keeps one consistent ratio. When it is null, judge the base ratio from the previous image and preserve its orientation (a square or portrait base never becomes landscape).',
    },
  };
}

function chainAspectRatio(
  context: ChainAgentPromptContext,
): { ratio: number; basis: string } | null {
  // The frame this step continues from is the previous step's output, so its
  // params define the ratio to keep. Fall back to the base image input, which
  // sets the canonical ratio for the chain.
  const fromPrevious = ratioFromParams(context.previousStep.requestParams);
  if (fromPrevious) {
    return {
      ratio: fromPrevious.ratio,
      basis: `previous_step ${fromPrevious.basis}`,
    };
  }

  const input = context.currentInput;
  const imageInput =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as JsonObject).image_model_input
      : null;
  const fromBase = ratioFromParams(imageInput);
  if (fromBase) {
    return {
      ratio: fromBase.ratio,
      basis: `image_model_input ${fromBase.basis}`,
    };
  }

  return null;
}

function ratioFromParams(
  params: unknown,
): { ratio: number; basis: string } | null {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return null;
  }
  const record = params as JsonObject;

  const fromAspect = parseRatioNumber(record.generation_aspect_ratio);
  if (fromAspect !== null) {
    return {
      ratio: fromAspect,
      basis: `generation_aspect_ratio ${String(record.generation_aspect_ratio)}`,
    };
  }

  const width = record.generation_width;
  const height = record.generation_height;
  if (
    typeof width === 'number' &&
    typeof height === 'number' &&
    width > 0 &&
    height > 0
  ) {
    return {
      ratio: width / height,
      basis: `generation_width/height ${width}x${height}`,
    };
  }

  const fromSize = parseRatioNumber(record.generation_size);
  if (fromSize !== null) {
    return {
      ratio: fromSize,
      basis: `generation_size ${String(record.generation_size)}`,
    };
  }

  return null;
}

// Parses "9:16", "16:9", "1280:720", "1024*1024", "2048x2048" into width/height.
function parseRatioNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return value > 0 ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const match = value
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*[:x*]\s*(\d+(?:\.\d+)?)$/i);
  if (!match) {
    return null;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width > 0 && height > 0) {
    return width / height;
  }
  return null;
}

function recommendAspectForSchema(
  baseRatio: number,
  schema: JsonObject | null | undefined,
): { field: string; value: string } | null {
  const properties =
    schema &&
    typeof schema.properties === 'object' &&
    !Array.isArray(schema.properties)
      ? (schema.properties as Record<string, JsonObject>)
      : {};
  const aspectField = properties.generation_aspect_ratio;
  const enumValues = Array.isArray(aspectField?.enum) ? aspectField.enum : [];

  const candidates = enumValues
    .map((value) => ({ value, ratio: parseRatioNumber(value) }))
    .filter(
      (entry): entry is { value: string; ratio: number } =>
        typeof entry.value === 'string' && entry.ratio !== null,
    );

  if (candidates.length === 0) {
    return null;
  }

  // Orientation is sticky. An upright base - portrait OR square - must never
  // become landscape, and a landscape base must never become upright. A 1:1
  // square counts as upright, so with video options [16:9, 9:16] it maps to
  // the portrait 9:16, never the landscape 16:9. Only when no same-orientation
  // option exists do we fall back to the full set.
  const EPSILON = 0.02;
  const baseIsUpright = baseRatio <= 1 + EPSILON;
  let pool = candidates.filter((entry) =>
    baseIsUpright ? entry.ratio <= 1 + EPSILON : entry.ratio >= 1 - EPSILON,
  );
  if (pool.length === 0) {
    pool = candidates;
  }

  pool.sort(
    (a, b) => Math.abs(a.ratio - baseRatio) - Math.abs(b.ratio - baseRatio),
  );

  const best = pool[0];
  return best ? { field: 'generation_aspect_ratio', value: best.value } : null;
}
