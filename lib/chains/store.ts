import 'server-only';

import { AuroraChainStore } from './aurora-store';
import type {
  ApiKeyPrincipal,
  ChainEstimate,
  ChainExecutionConfig,
  ChainInput,
  ChainRunStatus,
  ChainStepKind,
  ChainStepStatus,
  JsonObject,
} from './types';

/**
 * Chain store contract + factory.
 *
 * the app's runtime state lives in AWS Aurora (PostgreSQL) via
 * {@link AuroraChainStore}. `ChainStore` is the contract type consumed by
 * `runner.ts` and the API routes.
 */

export type CreateChainRunInput = {
  /** Non-secret marker for server-side BYOK mode; `null` for BabySea mode. */
  byokCredentials: JsonObject | null;
  byokProviders: string[];
  callbackUrl: string | null;
  chainSlug: string;
  chainVersion: string;
  clientRequestId: string | null;
  estimate: ChainEstimate | null;
  executionConfig: ChainExecutionConfig;
  idempotencyKeyHash: string | null;
  input: ChainInput;
  metadata: JsonObject;
  principal: ApiKeyPrincipal;
  steps: Array<{
    dependsOn: string[];
    modelIdentifier: string;
    stepIndex: number;
    stepKey: string;
    stepKind: ChainStepKind;
  }>;
};

export type CreateAgentCheckpointInput = {
  inputSnapshot: JsonObject;
  mode: 'copilot' | 'autopilot';
  modelIdentifier: string;
  output: JsonObject;
  previousStepKey: string;
  provider: 'bedrock';
  runId: string;
  selectedParams?: JsonObject | null;
  selectedPrompt?: string | null;
  status: 'suggested' | 'approved';
  stepKey: string;
};

export type ApproveAgentCheckpointInput = {
  checkpointId: string;
  selectedParams: JsonObject;
  selectedPrompt: string;
};

export type FindIdempotentRunInput = {
  chainSlug: string;
  idempotencyKeyHash: string;
  principal: ApiKeyPrincipal;
};

export type ChainRunPatch = Partial<{
  callbackClaimedAt: string | null;
  callbackStatus: string | null;
  completedAt: string | null;
  currentStepKey: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  output: JsonObject | null;
  status: ChainRunStatus;
}>;

export type ChainStepPatch = Partial<{
  babyseaGenerationId: string | null;
  babyseaIdempotencyReplayed: boolean | null;
  babyseaPredictionId: string | null;
  babyseaRequestId: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  outputFiles: string[];
  providerMetadata: JsonObject | null;
  providerOrder: string[];
  providerUsed: string | null;
  requestParams: JsonObject | null;
  startedAt: string | null;
  status: ChainStepStatus;
}>;

/** The chain store contract consumed by the runner and API routes. */
export type ChainStore = AuroraChainStore;

export function createChainStore(): ChainStore {
  return new AuroraChainStore();
}
