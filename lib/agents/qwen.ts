import 'server-only';

import type { JsonObject } from '@/lib/chains/types';
import { getEnv } from '@/lib/utils/env';
import { AppError } from '@/lib/utils/errors';

import {
  buildShowrunnerAgentSystemPrompt,
  runShowrunnerAgentTool,
  SHOWRUNNER_AGENT_TOOLS,
  type ShowrunnerAgentToolName,
} from './instructions';

const SHOWRUNNER_QWEN_DEFAULT_MODEL = 'qwen3.7-plus';
const DASHSCOPE_BASE_URL = 'https://dashscope-intl.aliyuncs.com/api/v1';
const QWEN_MULTIMODAL_PATH = '/services/aigc/multimodal-generation/generation';
const SHOWRUNNER_QWEN_TIMEOUT_MS = 120_000;
const SHOWRUNNER_QWEN_MAX_TOOL_ROUNDS = 2;
const RESERVED_QWEN_PARAMETER_KEYS = new Set([
  'function_call',
  'parallel_tool_calls',
  'tool_choice',
  'tools',
]);

export type ShowrunnerQwenConfig = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  modelIdentifier?: string;
};

export type ShowrunnerQwenMessage = {
  content: Array<{
    fps?: number;
    image?: string;
    text?: string;
    video?: string | string[];
  }>;
  role: 'assistant' | 'system' | 'user';
};

type QwenToolCall = {
  arguments: JsonObject;
  id: string;
  name: ShowrunnerAgentToolName;
};

export type ShowrunnerQwenAgentInput = {
  messages: ShowrunnerQwenMessage[];
  parameters?: JsonObject;
};

export type ShowrunnerQwenAgent = {
  readonly modelIdentifier: string;
  readonly provider: 'qwen';
  generate(input: ShowrunnerQwenAgentInput): Promise<JsonObject>;
};

export function createShowrunnerQwenAgent(
  config: ShowrunnerQwenConfig = {},
): ShowrunnerQwenAgent {
  const env = getEnv();
  const apiKey = config.apiKey ?? env.DASHSCOPE_API_KEY;

  if (!apiKey) {
    throw new AppError(
      'AGENT_SHOWRUNNER_QWEN_not_configured',
      'Showrunner Qwen agent requires DASHSCOPE_API_KEY on the Marsha server.',
      500,
    );
  }

  const fetchImpl = config.fetchImpl ?? fetch;
  const modelIdentifier =
    config.modelIdentifier ??
    env.AGENT_SHOWRUNNER_QWEN ??
    SHOWRUNNER_QWEN_DEFAULT_MODEL;

  return {
    modelIdentifier,
    provider: 'qwen',
    async generate(input) {
      const messages = withShowrunnerAgentInstruction(input.messages);
      const toolContextMessages = withoutCallerSystemMessages(input.messages);

      return fetchQwenGeneration({
        apiKey,
        body: {
          model: modelIdentifier,
          input: {
            messages,
          },
          parameters: showrunnerQwenParameters(input.parameters),
        },
        context: {
          messages: toolContextMessages,
          modelIdentifier,
        },
        fetchImpl,
      });
    },
  };
}

function withShowrunnerAgentInstruction(messages: ShowrunnerQwenMessage[]) {
  return [
    {
      role: 'system' as const,
      content: [{ text: buildShowrunnerAgentSystemPrompt() }],
    },
    ...withoutCallerSystemMessages(messages),
  ];
}

function withoutCallerSystemMessages(messages: ShowrunnerQwenMessage[]) {
  return messages.filter((message) => message.role !== 'system');
}

export function defaultShowrunnerQwenAgentModelIdentifier() {
  return getEnv().AGENT_SHOWRUNNER_QWEN ?? SHOWRUNNER_QWEN_DEFAULT_MODEL;
}

async function fetchQwenGeneration(args: {
  apiKey: string;
  body: JsonObject;
  context: Parameters<typeof runShowrunnerAgentTool>[1];
  fetchImpl: typeof fetch;
}) {
  let body = args.body;

  for (let round = 0; round <= SHOWRUNNER_QWEN_MAX_TOOL_ROUNDS; round += 1) {
    const payload = await postQwenGeneration({
      apiKey: args.apiKey,
      body,
      fetchImpl: args.fetchImpl,
    });
    const toolCalls = extractToolCalls(payload);

    if (toolCalls.length === 0) {
      return payload;
    }

    if (round === SHOWRUNNER_QWEN_MAX_TOOL_ROUNDS) {
      throw new AppError(
        'AGENT_SHOWRUNNER_QWEN_tool_loop_exceeded',
        'Showrunner Qwen agent requested too many tool rounds.',
        502,
      );
    }

    body = appendToolResults(body, toolCalls, args.context);
  }

  return {};
}

async function postQwenGeneration(args: {
  apiKey: string;
  body: JsonObject;
  fetchImpl: typeof fetch;
}) {
  const response = await args.fetchImpl(
    `${DASHSCOPE_BASE_URL}${QWEN_MULTIMODAL_PATH}`,
    {
      body: JSON.stringify(args.body),
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${args.apiKey}`,
        'content-type': 'application/json',
      },
      method: 'POST',
      signal: AbortSignal.timeout(SHOWRUNNER_QWEN_TIMEOUT_MS),
    },
  );
  const payload = (await response
    .json()
    .catch(() => null)) as JsonObject | null;

  if (response.ok) {
    return payload ?? {};
  }

  const message = qwenErrorMessage(payload);

  throw new AppError(
    response.status === 429
      ? 'AGENT_SHOWRUNNER_QWEN_rate_limited'
      : 'AGENT_SHOWRUNNER_QWEN_failed',
    message
      ? `Showrunner Qwen agent request failed with status ${response.status}: ${message}`
      : `Showrunner Qwen agent request failed with status ${response.status}.`,
    response.status === 429 ? 429 : 502,
    payload ?? undefined,
  );
}

function qwenErrorMessage(payload: JsonObject | null) {
  if (!payload) return null;

  return (
    stringValue(payload.message) ??
    stringValue(payload.Message) ??
    stringValue(payload.code) ??
    stringValue(payload.error)
  );
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function showrunnerQwenParameters(parameters: JsonObject | undefined) {
  return {
    ...sanitizeQwenParameters(parameters ?? {}),
    result_format: 'message',
    tools: SHOWRUNNER_AGENT_TOOLS,
  } satisfies JsonObject;
}

function sanitizeQwenParameters(parameters: JsonObject) {
  return Object.fromEntries(
    Object.entries(parameters).filter(
      ([key]) => !RESERVED_QWEN_PARAMETER_KEYS.has(key),
    ),
  ) as JsonObject;
}

function extractToolCalls(payload: JsonObject): QwenToolCall[] {
  const message = qwenOutputMessage(payload);
  const toolCalls = Array.isArray(message?.tool_calls)
    ? message.tool_calls
    : message?.function_call
      ? [message.function_call]
      : [];

  return toolCalls.flatMap((toolCall, index) => {
    if (!toolCall || typeof toolCall !== 'object' || Array.isArray(toolCall)) {
      return [];
    }

    const record = toolCall as JsonObject;
    const fn =
      record.function &&
      typeof record.function === 'object' &&
      !Array.isArray(record.function)
        ? (record.function as JsonObject)
        : record;
    const name = stringValue(fn.name);

    if (!isShowrunnerToolName(name)) {
      throw new AppError(
        'AGENT_SHOWRUNNER_QWEN_unknown_tool',
        name
          ? `Showrunner Qwen agent requested unsupported tool: ${name}.`
          : 'Showrunner Qwen agent requested a tool without a name.',
        502,
      );
    }

    return [
      {
        arguments: parseToolArguments(fn.arguments),
        id: stringValue(record.id) ?? `${name}_${index}`,
        name,
      },
    ];
  });
}

function qwenOutputMessage(payload: JsonObject): JsonObject | null {
  const output = payload.output;

  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return null;
  }

  const choices = (output as JsonObject).choices;

  if (Array.isArray(choices)) {
    const first = choices[0];

    if (first && typeof first === 'object' && !Array.isArray(first)) {
      const message = (first as JsonObject).message;

      if (message && typeof message === 'object' && !Array.isArray(message)) {
        return message as JsonObject;
      }
    }
  }

  const message = (output as JsonObject).message;

  return message && typeof message === 'object' && !Array.isArray(message)
    ? (message as JsonObject)
    : null;
}

function parseToolArguments(value: unknown): JsonObject {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as JsonObject)
        : {};
    } catch {
      return {};
    }
  }

  return typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function appendToolResults(
  body: JsonObject,
  toolCalls: QwenToolCall[],
  context: Parameters<typeof runShowrunnerAgentTool>[1],
): JsonObject {
  const input = body.input;
  const messages =
    input &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    Array.isArray((input as JsonObject).messages)
      ? [...((input as JsonObject).messages as JsonObject[])]
      : [];

  messages.push({
    role: 'assistant',
    content: '',
    tool_calls: toolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: 'function',
      function: {
        name: toolCall.name,
        arguments: JSON.stringify(toolCall.arguments),
      },
    })),
  });

  for (const toolCall of toolCalls) {
    messages.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      name: toolCall.name,
      content: JSON.stringify(runShowrunnerAgentTool(toolCall.name, context)),
    });
  }

  return {
    ...body,
    input: {
      ...(input && typeof input === 'object' && !Array.isArray(input)
        ? (input as JsonObject)
        : {}),
      messages,
    },
  };
}

function isShowrunnerToolName(
  value: string | null,
): value is ShowrunnerAgentToolName {
  return (
    value === 'read_showrunner_scene_context' ||
    value === 'read_video_model_contract' ||
    value === 'select_showrunner_defaults'
  );
}
