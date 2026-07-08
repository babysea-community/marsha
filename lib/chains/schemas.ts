import { Buffer } from 'node:buffer';

import { z } from 'zod';

import { APP_CRON_RUN_LIMIT } from './shared-constants';

export const MAX_RUN_INPUT_BYTES = 64 * 1024;
export const MAX_RUN_METADATA_BYTES = 16 * 1024;
export const MAX_AGENT_PARAMS_BYTES = 16 * 1024;

const MAX_JSON_DEPTH = 12;
const MAX_JSON_KEYS = 200;
const MAX_JSON_ARRAY_ITEMS = 100;
const MAX_JSON_STRING_BYTES = 8 * 1024;
const MAX_JSON_NODES = 1_000;

export const CreateRunExecutionSchema = z
  .object({
    type: z.enum(['self_control', 'chain_agent']).default('self_control'),
    mode: z.enum(['copilot', 'autopilot']).optional(),
    provider: z.literal('bedrock').optional(),
    model_identifier: z.preprocess(
      emptyStringToUndefined,
      z.string().trim().min(1).max(200).optional(),
    ),
  })
  .default({ type: 'self_control' })
  .superRefine((value, context) => {
    if (value.type === 'self_control') {
      return;
    }

    if (!value.mode) {
      context.addIssue({
        code: 'custom',
        message: 'execution.mode is required for Chain Agent runs.',
        path: ['mode'],
      });
    }
  });

export const CreateRunRequestSchema = z.object({
  input: boundedJsonRecord('input', MAX_RUN_INPUT_BYTES).default({}),
  metadata: boundedJsonRecord('metadata', MAX_RUN_METADATA_BYTES).default({}),
  execution: CreateRunExecutionSchema,
  webhook_url: z.preprocess(emptyStringToUndefined, z.url().trim().optional()),
});

export const ContinueAgentRunRequestSchema = z.object({
  checkpoint_id: z.uuid(),
  selected_prompt: z
    .string()
    .trim()
    .min(1)
    .max(8 * 1024),
  selected_params: boundedJsonRecord(
    'selected_params',
    MAX_AGENT_PARAMS_BYTES,
  ).default({}),
});

export const RunIdSchema = z.uuid();

export const CronRequestSchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(APP_CRON_RUN_LIMIT)
    .default(APP_CRON_RUN_LIMIT),
});

export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;

function emptyStringToUndefined(value: unknown) {
  return value === '' || value === null ? undefined : value;
}

function boundedJsonRecord(label: string, maxBytes: number) {
  return z.record(z.string(), z.unknown()).superRefine((value, context) => {
    const serialized = tryStringifyJson(value);

    if (!serialized) {
      context.addIssue({
        code: 'custom',
        message: `${label} must contain only JSON-serializable values.`,
      });

      return;
    }

    if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
      context.addIssue({
        code: 'custom',
        message: `${label} must be ${maxBytes} bytes or smaller.`,
      });
    }

    const violation = findJsonLimitViolation(value);

    if (violation) {
      context.addIssue({
        code: 'custom',
        message: `${label} ${violation}`,
      });
    }
  });
}

function tryStringifyJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function findJsonLimitViolation(root: unknown) {
  const stack: Array<{ depth: number; value: unknown }> = [
    { depth: 0, value: root },
  ];
  const seen = new Set<object>();
  let keys = 0;
  let nodes = 0;

  while (stack.length > 0) {
    const current = stack.pop()!;
    const { depth, value } = current;
    nodes += 1;

    if (nodes > MAX_JSON_NODES) {
      return `must contain ${MAX_JSON_NODES} JSON nodes or fewer.`;
    }

    if (depth > MAX_JSON_DEPTH) {
      return `must not be nested deeper than ${MAX_JSON_DEPTH} levels.`;
    }

    if (value === undefined) {
      return 'must not contain undefined values.';
    }

    if (typeof value === 'bigint' || typeof value === 'function') {
      return 'must contain only JSON values.';
    }

    if (typeof value === 'number' && !Number.isFinite(value)) {
      return 'must contain only finite numbers.';
    }

    if (
      typeof value === 'string' &&
      Buffer.byteLength(value, 'utf8') > MAX_JSON_STRING_BYTES
    ) {
      return `strings must be ${MAX_JSON_STRING_BYTES} bytes or smaller.`;
    }

    if (!value || typeof value !== 'object') {
      continue;
    }

    if (seen.has(value)) {
      return 'must not contain circular references.';
    }

    seen.add(value);

    if (Array.isArray(value)) {
      if (value.length > MAX_JSON_ARRAY_ITEMS) {
        return `arrays must contain ${MAX_JSON_ARRAY_ITEMS} items or fewer.`;
      }

      for (const item of value) {
        stack.push({ depth: depth + 1, value: item });
      }

      continue;
    }

    const entries = Object.entries(value as Record<string, unknown>);
    keys += entries.length;

    if (keys > MAX_JSON_KEYS) {
      return `must contain ${MAX_JSON_KEYS} object keys or fewer.`;
    }

    for (const [, entryValue] of entries) {
      stack.push({ depth: depth + 1, value: entryValue });
    }
  }

  return null;
}
