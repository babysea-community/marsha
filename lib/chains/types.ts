import type { GenerationParams } from 'babysea';
import type { z } from 'zod';

export const CHAIN_RUN_STATUSES = [
  'queued',
  'running',
  'awaiting_agent',
  'succeeded',
  'failed',
  'canceled',
] as const;

export const CHAIN_AGENT_CHECKPOINT_STATUSES = [
  'suggested',
  'approved',
  'applied',
  'failed',
] as const;

export const CHAIN_STEP_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
  'skipped',
] as const;

export type ChainRunStatus = (typeof CHAIN_RUN_STATUSES)[number];
export type ChainAgentCheckpointStatus =
  (typeof CHAIN_AGENT_CHECKPOINT_STATUSES)[number];
export type ChainStepStatus = (typeof CHAIN_STEP_STATUSES)[number];
export type ChainStepKind = 'image' | 'video';

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type ChainInput = Record<string, unknown>;

export type ChainInputField = {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'url' | 'object' | 'array';
  required: boolean;
  description: string;
  default?: unknown;
  enum?: string[];
  min?: number;
  max?: number;
};

export type ChainStepOutput = {
  generationId: string;
  modelIdentifier: string;
  outputFiles: string[];
  providerOrder: string[];
  providerUsed: string | null;
  predictionId: string | null;
  status: 'succeeded';
};

export type ChainExecutionContext = {
  input: ChainInput;
  steps: Record<string, ChainStepOutput>;
};

export type ChainStepEstimateOptions = {
  audio?: boolean;
  count?: number;
  duration?: number;
  resolution?: string;
};

export type ChainStepTemplate = {
  key: string;
  title: string;
  kind: ChainStepKind;
  model: string;
  dependsOn: string[];
  estimate: (input: ChainInput) => ChainStepEstimateOptions;
  buildParams: (context: ChainExecutionContext) => GenerationParams;
};

export type ChainTemplate = {
  slug: string;
  version: string;
  title: string;
  description: string;
  inputSchema: z.ZodType<ChainInput>;
  inputFields: ChainInputField[];
  steps: ChainStepTemplate[];
};

export type ChainTemplateSummary = {
  object: 'chain_template';
  slug: string;
  version: string;
  title: string;
  description: string;
  input_fields: ChainInputField[];
  steps: Array<{
    key: string;
    title: string;
    kind: ChainStepKind;
    model: string;
    depends_on: string[];
  }>;
};

export type ChainRunRecord = {
  id: string;
  apiKeyId: string | null;
  apiKeyPrefix: string;
  chainSlug: string;
  chainVersion: string;
  status: ChainRunStatus;
  input: ChainInput;
  output: JsonObject | null;
  errorCode: string | null;
  errorMessage: string | null;
  currentStepKey: string | null;
  callbackUrl: string | null;
  callbackStatus: string | null;
  callbackClaimedAt: string | null;
  clientRequestId: string | null;
  idempotencyKeyHash: string | null;
  estimate: JsonObject | null;
  metadata: JsonObject;
  executionConfig: ChainExecutionConfig;
  /** Non-secret marker for server-side BYOK mode; `null` for BabySea mode. */
  byokCredentials: JsonObject | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type ChainExecutionConfig =
  | {
      type: 'self_control';
    }
  | {
      type: 'chain_agent';
      mode: 'copilot' | 'autopilot';
      provider: 'bedrock';
      modelIdentifier: string;
    };

export type ChainAgentCheckpointRecord = {
  id: string;
  runId: string;
  stepKey: string;
  previousStepKey: string;
  mode: 'copilot' | 'autopilot';
  provider: 'bedrock';
  modelIdentifier: string;
  status: ChainAgentCheckpointStatus;
  inputSnapshot: JsonObject;
  output: JsonObject;
  selectedPrompt: string | null;
  selectedParams: JsonObject | null;
  errorCode: string | null;
  errorMessage: string | null;
  approvedAt: string | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChainStepRecord = {
  id: string;
  runId: string;
  stepIndex: number;
  stepKey: string;
  stepKind: ChainStepKind;
  modelIdentifier: string;
  status: ChainStepStatus;
  dependsOn: string[];
  requestParams: JsonObject | null;
  babyseaGenerationId: string | null;
  babyseaPredictionId: string | null;
  babyseaRequestId: string | null;
  babyseaIdempotencyReplayed: boolean | null;
  providerOrder: string[];
  providerUsed: string | null;
  outputFiles: string[];
  /**
   * Provider-specific async bookkeeping (e.g. BFL `polling_url`, BytePlus
   * task id, signed-URL expiry hints). Excluded from caller-visible idempotency
   * checks and never returned to webhook recipients verbatim.
   */
  providerMetadata: JsonObject | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChainRunWithSteps = {
  run: ChainRunRecord;
  steps: ChainStepRecord[];
  agentCheckpoints: ChainAgentCheckpointRecord[];
};

export type ApiKeyPrincipal = {
  apiKeyId: string | null;
  keyPrefix: string;
  name: string;
  scopes: string[];
};

export type ChainEstimate = {
  currency: 'credits';
  total: number;
  steps: Array<{
    step_key: string;
    model_identifier: string;
    cost_total_consumed: number | null;
  }>;
};
