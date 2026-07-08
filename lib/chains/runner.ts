import 'server-only';

import { randomInt } from 'node:crypto';
import type { LookupAddress } from 'node:dns';
import type { IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';

import type {
  BabySea,
  EstimateData,
  Generation,
  GenerationParams,
  GenerationWebhookPayload,
} from 'babysea';

import { createBabySeaClient } from '@/lib/babysea';
import { createChainAgent, type ChainAgent } from '@/lib/agents';
import {
  completeChainAgentSelectedParams,
  validateChainAgentResult,
} from '@/lib/agents/validation';
import {
  getProvider,
  readByokRunConfig,
  resolveProvider,
  type ByokProviderName,
  type ByokRunConfig,
  type Provider,
  type ProviderName,
} from '@/lib/providers';
import { createBabySeaProvider } from '@/lib/providers/babysea';
import type { ProviderSubmitResult } from '@/lib/providers/types';
import { signJsonPayload } from '@/lib/security/crypto';
import { getEnv } from '@/lib/utils/env';
import { AppError, toErrorMessage } from '@/lib/utils/errors';
import { persistOutputFiles } from '@/lib/storage';
import type { StorageProvider } from '@/lib/storage';
import {
  isBlockedNetworkHostname,
  lookupAllowedNetworkAddress,
  normalizeHostname,
} from '@/lib/security/network-safety';
import { createSemanticRequestSchema } from '@/lib/models/semantic-schema';
import { chainFieldModeForRole } from '@/lib/models/chain-schema';
import type { ChainSchemaStepRole } from '@/lib/models/chain-schema';
import { outputFilesWithStorageUrls } from './output-files';

import {
  serializeCompletedRunOutput,
  serializeRunWithSteps,
} from './presenters';
import {
  APP_SDK_REQUEST_TIMEOUT_MS,
  APP_STEP_WATCHDOG_SECONDS,
} from './shared-constants';
import { createChainStore, type ChainStore } from './store';
import {
  assertSafeGenerationParamsTargets,
  getChainTemplate,
  resolveStepModel,
} from './templates';
import type {
  ChainEstimate,
  ChainAgentCheckpointRecord,
  ChainExecutionContext,
  ChainInput,
  ChainRunWithSteps,
  ChainStepOutput,
  ChainStepRecord,
  ChainStepTemplate,
  ChainTemplate,
  JsonObject,
} from './types';

const TERMINAL_RUN_STATUSES = new Set(['succeeded', 'failed', 'canceled']);
const CALLBACK_TIMEOUT_MS = 10_000;
const CALLBACK_RESPONSE_TEXT_LIMIT = 2_000;
const STARTING_STEP_STALE_MS = APP_SDK_REQUEST_TIMEOUT_MS + 60_000;
// Once a step has a provider/generation id it polls until the provider returns
// a terminal state. This wall-clock watchdog auto-cancels a step that never
// reaches a terminal state so a lost or hung provider job cannot keep a run
// polling - and billing on the provider - forever. A the app step hits a
// SINGLE provider per model, so this budget is independent of BabySea's
// 3-provider failover route budget (210s/790s); video gets more room because
// providers like Runway plus an unstable network can legitimately run long. The
// watchdog is wall-clock across cron re-entries, not one invocation, so it is
// not bound by Vercel's per-invocation maxDuration.
function runningStepTimeoutMs(step: ChainStepRecord) {
  const seconds =
    step.stepKind === 'video'
      ? APP_STEP_WATCHDOG_SECONDS.video
      : APP_STEP_WATCHDOG_SECONDS.image;
  return seconds * 1000;
}
const TRANSIENT_PROVIDER_ERROR_CODES = new Set([
  'provider_network_error',
  'provider_rate_limited',
]);
const AGENT_RESERVED_PARAM_KEYS = new Set([
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

export type RunnerDependencies = {
  agent?: ChainAgent;
  babysea?: BabySea;
  storage?: StorageProvider | null;
  store?: ChainStore;
};

export async function estimateChain(
  template: ChainTemplate,
  input: ChainInput,
  babysea?: BabySea,
  options: {
    byokMode?: boolean;
    byokProviders?: ByokProviderName[];
    steps?: ChainStepTemplate[];
  } = {},
): Promise<ChainEstimate> {
  const byokMode = options.byokMode ?? false;
  const steps = options.steps ?? template.steps;
  const estimates: EstimateData[] = [];
  const resolutions = steps.map((step) => ({
    step,
    modelIdentifier: resolveStepModel(step.model, input),
    resolution: resolveProvider(resolveStepModel(step.model, input), {
      byokMode,
    }),
  }));

  if (byokMode) {
    const incompatible = resolutions.find(
      (entry) => entry.resolution.provider === 'babysea',
    );

    if (incompatible) {
      throw new AppError(
        'byok_credentials_missing',
        `Model "${incompatible.modelIdentifier}" routes to the BabySea SDK provider, which is not BYOK-compatible. Use an Alibaba Cloud, Black Forest Labs, BytePlus, Google, OpenAI, or Runway-backed model for BYOK mode.`,
        400,
      );
    }

    const configuredProviders = new Set(options.byokProviders ?? []);
    const missingProvider = resolutions
      .map((entry) => {
        const provider = entry.resolution.provider;

        return isByokProviderName(provider) ? { entry, provider } : null;
      })
      .find(
        (entry): entry is NonNullable<typeof entry> =>
          entry !== null && !configuredProviders.has(entry.provider),
      );

    if (missingProvider) {
      throw new AppError(
        'byok_credentials_missing',
        `Model "${missingProvider.entry.modelIdentifier}" requires ${serverKeyNameForProvider(missingProvider.provider)} on the the app server.`,
        400,
      );
    }
  }

  const needsBabySea = resolutions.some(
    (entry) => entry.resolution.provider === 'babysea',
  );
  const babyseaProvider = needsBabySea
    ? createBabySeaProvider(babysea ?? createBabySeaClient())
    : null;

  for (const { step, modelIdentifier, resolution } of resolutions) {
    const options = step.estimate(input);

    if (resolution.provider === 'babysea') {
      const estimate = await babyseaProvider!.estimate({
        modelIdentifier,
        stepKind: step.kind,
        options,
      });
      estimates.push(estimate);
    } else {
      // BYOK providers bill the caller's account, so surface a zero cost.
      estimates.push({
        model_identifier: modelIdentifier,
        model_type: step.kind,
        assets_count: options.count ?? 1,
        cost_per_generation: 0,
        cost_total_consumed: 0,
        credit_balance: null,
        credit_balance_can_afford: null,
        credit_balance_max_affordable: null,
      });
    }
  }

  return {
    currency: 'credits',
    steps: steps.map((step, index) => ({
      cost_total_consumed: estimates[index]?.cost_total_consumed ?? null,
      model_identifier:
        estimates[index]?.model_identifier ??
        resolveStepModel(step.model, input),
      step_key: step.key,
    })),
    total: estimates.reduce(
      (sum, estimate) => sum + estimate.cost_total_consumed,
      0,
    ),
  };
}

export async function processRunById(
  runId: string,
  dependencies: RunnerDependencies = {},
) {
  const store = dependencies.store ?? createChainStore();
  const record = await store.getRunWithSteps(runId);

  if (!record) {
    throw new AppError('run_not_found', 'Chain run was not found.', 404);
  }

  return processRun(record, { ...dependencies, store });
}

export async function processRun(
  initialRecord: ChainRunWithSteps,
  dependencies: RunnerDependencies = {},
) {
  const store = dependencies.store ?? createChainStore();
  let record = initialRecord;
  const byokConfig = readRunByokConfig(record);
  const providerOverrides = { babysea: dependencies.babysea };

  for (let attempt = 0; attempt < 10; attempt++) {
    if (TERMINAL_RUN_STATUSES.has(record.run.status)) {
      await deliverTerminalCallback(record, store);
      return record;
    }

    const template = getChainTemplate(record.run.chainSlug);

    if (!template || template.version !== record.run.chainVersion) {
      return failRun(
        record,
        store,
        'template_not_found',
        'Chain template is no longer available.',
      );
    }

    const runningStep = record.steps.find((step) => step.status === 'running');

    if (runningStep) {
      if (!runningStep.babyseaGenerationId) {
        if (isStartingStepStale(runningStep)) {
          const errorMessage =
            'BabySea generation did not return a generation id before the step start deadline.';

          const failedStep = await store.updateRunningStep(runningStep.id, {
            completedAt: new Date().toISOString(),
            errorCode: 'babysea_start_timed_out',
            errorMessage,
            status: 'failed',
          });

          if (!failedStep) {
            return mustGetRun(store, record.run.id);
          }

          record = await failRun(
            record,
            store,
            'babysea_start_timed_out',
            errorMessage,
          );
          continue;
        }

        return record;
      }

      if (isRunningStepStale(runningStep)) {
        // Cancel the stuck job at the provider too (best-effort), not just
        // locally, so a lost or hung generation cannot keep running and
        // billing after the app gives up on it.
        if (runningStep.babyseaGenerationId) {
          await cancelGenerationsAtProvider(
            [
              {
                generationId: runningStep.babyseaGenerationId,
                modelIdentifier: runningStep.modelIdentifier,
                providerMetadata: runningStep.providerMetadata,
              },
            ],
            byokConfig,
            providerOverrides,
          );
        }

        const timeoutSeconds = Math.round(
          runningStepTimeoutMs(runningStep) / 1000,
        );
        const errorMessage = `The ${runningStep.stepKind} generation timed out: the provider did not finish within the ${timeoutSeconds}-second time limit, so it was canceled.`;

        const failedStep = await store.updateRunningStep(runningStep.id, {
          completedAt: new Date().toISOString(),
          errorCode: 'step_running_timed_out',
          errorMessage,
          status: 'failed',
        });

        if (!failedStep) {
          return mustGetRun(store, record.run.id);
        }

        record = await failRun(
          record,
          store,
          'step_running_timed_out',
          errorMessage,
        );
        continue;
      }

      await refreshStepFromProvider(
        runningStep,
        byokConfig,
        providerOverrides,
        store,
        dependencies.storage,
      );
      record = await mustGetRun(store, record.run.id);

      if (record.steps.some((step) => step.status === 'running')) {
        return record;
      }

      continue;
    }

    const failedStep = record.steps.find((step) => step.status === 'failed');

    if (failedStep) {
      record = await failRun(
        record,
        store,
        failedStep.errorCode ?? 'step_failed',
        failedStep.errorMessage ?? 'A chain step failed.',
      );
      continue;
    }

    const canceledStep = record.steps.find(
      (step) => step.status === 'canceled',
    );

    if (canceledStep) {
      record = await cancelRunRecord(record, store, 'step_canceled');
      continue;
    }

    if (record.steps.every((step) => step.status === 'succeeded')) {
      record = await completeRun(record, store);
      continue;
    }

    const readyStep = findReadyQueuedStep(record.steps);

    if (!readyStep) {
      return record;
    }

    const agentCheckpoint = await prepareAgentCheckpoint({
      agent: dependencies.agent,
      record,
      readyStep,
      store,
    });

    if (agentCheckpoint.kind === 'paused') {
      return mustGetRun(store, record.run.id);
    }

    if (agentCheckpoint.kind === 'failed') {
      record = await failRun(
        record,
        store,
        agentCheckpoint.errorCode,
        agentCheckpoint.errorMessage,
      );
      continue;
    }

    await startStep(
      record,
      readyStep,
      template,
      byokConfig,
      providerOverrides,
      store,
      agentCheckpoint.checkpoint,
      dependencies.storage,
    );
    return mustGetRun(store, record.run.id);
  }

  return mustGetRun(store, record.run.id);
}

export async function continueAgentRun(
  runId: string,
  input: {
    checkpointId: string;
    selectedParams: JsonObject;
    selectedPrompt: string;
  },
  dependencies: RunnerDependencies = {},
) {
  const store = dependencies.store ?? createChainStore();
  const record = await mustGetRun(store, runId);

  if (record.run.executionConfig.type !== 'chain_agent') {
    throw new AppError(
      'invalid_chain_agent_run',
      'This run is not a Chain Agent run.',
      400,
    );
  }

  const checkpoint = record.agentCheckpoints.find(
    (candidate) => candidate.id === input.checkpointId,
  );

  if (!checkpoint || checkpoint.status !== 'suggested') {
    throw new AppError(
      'invalid_agent_checkpoint',
      'Agent checkpoint is not waiting for approval.',
      400,
    );
  }

  const nextStep = record.steps.find(
    (step) => step.stepKey === checkpoint.stepKey,
  );
  const nextStepSchema = nextStep ? agentStepSchema(nextStep) : null;
  const nextStepRequestParams = nextStep
    ? agentStepRequestParams(record, nextStep)
    : null;
  const selectedParams = normalizeAgentSelectedParams(
    input.selectedPrompt,
    input.selectedParams,
    {
      allowSelectedPromptFallback: schemaSupportsAgentPrompt(nextStepSchema),
    },
  );
  const completedSelectedParams = nextStep
    ? completeChainAgentSelectedParams(selectedParams, {
        nextStep: {
          requestParams: nextStepRequestParams,
          schema: nextStepSchema,
        },
      })
    : selectedParams;
  const validation = validateAgentCheckpointApproval(
    record,
    checkpoint,
    completedSelectedParams,
    input.selectedPrompt,
  );

  if (!validation.ok) {
    throw new AppError(
      'chain_agent_invalid_checkpoint',
      `Agent checkpoint approval is invalid: ${validation.error}`,
      400,
    );
  }

  const approved = await store.approveAgentCheckpoint({
    checkpointId: checkpoint.id,
    selectedParams: completedSelectedParams,
    selectedPrompt: input.selectedPrompt,
  });

  if (!approved) {
    throw new AppError(
      'invalid_agent_checkpoint',
      'Agent checkpoint is not waiting for approval.',
      400,
    );
  }

  await store.updateActiveRun(runId, {
    currentStepKey: null,
    errorCode: null,
    errorMessage: null,
    status: 'queued',
  });

  const updated = await mustGetRun(store, runId);

  await store.recordAuditEvent({
    action: 'agent_checkpoint.approved',
    apiKeyId: updated.run.apiKeyId,
    details: {
      checkpoint_id: checkpoint.id,
      step_key: checkpoint.stepKey,
    },
    runId,
  });

  return processRun(updated, { ...dependencies, store });
}

function validateAgentCheckpointApproval(
  record: ChainRunWithSteps,
  checkpoint: ChainAgentCheckpointRecord,
  selectedParams: JsonObject,
  selectedPrompt: string,
) {
  const previousStep = record.steps.find(
    (step) => step.stepKey === checkpoint.previousStepKey,
  );
  const nextStep = record.steps.find(
    (step) => step.stepKey === checkpoint.stepKey,
  );

  if (!previousStep || !nextStep) {
    return {
      ok: false as const,
      checkedParams: Object.keys(selectedParams).sort(),
      error: 'checkpoint step context is missing.',
    };
  }

  const suggestions = Array.isArray(checkpoint.output.suggestions)
    ? (
        checkpoint.output.suggestions as Array<{
          params?: JsonObject;
          prompt?: string;
          rationale?: string | null;
          title?: string;
        }>
      ).map((suggestion, index) => ({
        title: suggestion.title ?? `Option ${index + 1}`,
        prompt: suggestion.prompt ?? selectedPrompt,
        ...(suggestion.params ? { params: suggestion.params } : {}),
        ...(suggestion.rationale ? { rationale: suggestion.rationale } : {}),
      }))
    : [];

  const approveModelContext =
    typeof record.run.metadata.model_context === 'string'
      ? record.run.metadata.model_context.trim()
      : '';

  return validateChainAgentResult(
    {
      selectedParams,
      selectedPrompt,
      suggestions,
    },
    {
      currentInput: record.run.input as JsonObject,
      ...(approveModelContext ? { modelContext: approveModelContext } : {}),
      flow: {
        currentStepKey: checkpoint.previousStepKey,
        mode: checkpoint.mode,
        nextStepKey: checkpoint.stepKey,
      },
      previousStep,
      nextStep: {
        ...nextStep,
        requestParams: agentStepRequestParams(record, nextStep),
        schema: agentStepSchema(nextStep),
      },
    },
  );
}

export async function applyBabySeaWebhook(
  payload: GenerationWebhookPayload,
  dependencies: RunnerDependencies = {},
) {
  const store = dependencies.store ?? createChainStore();
  const step = await store.findStepByBabySeaGenerationId(
    payload.webhook_data.generation_id,
  );

  if (!step) {
    return null;
  }

  const currentRecord = await mustGetRun(store, step.runId);

  // Webhooks only originate from BabySea, so ignore if the step has been routed
  // to a BYOK provider (defence-in-depth against generation-id collisions).
  if (
    resolveProvider(step.modelIdentifier, {
      byokMode: readRunByokConfig(currentRecord) !== null,
    }).provider !== 'babysea'
  ) {
    return null;
  }

  await applyGenerationStatus(step, generationFromWebhook(payload), store, {
    storage: dependencies.storage,
  });

  const record = await mustGetRun(store, step.runId);
  return processRun(record, { ...dependencies, store });
}

// Best-effort provider cancellation shared by every cancel path (client cancel
// button, API cancel, and the auto-timeout watchdog) so a canceled run never
// keeps running - and billing - on the provider side.
async function cancelGenerationsAtProvider(
  cancellations: Array<{
    generationId: string;
    modelIdentifier: string;
    providerMetadata: JsonObject | null;
  }>,
  byokConfig: Parameters<typeof getProvider>[1],
  providerOverrides: Parameters<typeof getProvider>[2],
) {
  for (const cancellation of cancellations) {
    try {
      const resolution = resolveProvider(cancellation.modelIdentifier, {
        byokMode: byokConfig !== null,
      });
      const provider = getProvider(resolution, byokConfig, providerOverrides);
      await provider.cancel({
        generationId: cancellation.generationId,
        modelIdentifier: resolution.modelIdentifier,
        providerMetadata: cancellation.providerMetadata,
      });
    } catch {
      // Local cancellation/failure already recorded; provider cancel is best-effort.
    }
  }
}

export async function cancelRun(
  runId: string,
  dependencies: RunnerDependencies = {},
) {
  const store = dependencies.store ?? createChainStore();
  const record = await mustGetRun(store, runId);
  const byokConfig = readRunByokConfig(record);
  const providerOverrides = { babysea: dependencies.babysea };

  if (TERMINAL_RUN_STATUSES.has(record.run.status)) {
    return record;
  }

  const canceledRun = await store.updateActiveRun(runId, {
    completedAt: new Date().toISOString(),
    currentStepKey: null,
    errorCode: 'client_canceled',
    errorMessage: 'Chain run was canceled.',
    status: 'canceled',
  });

  if (!canceledRun) {
    return mustGetRun(store, runId);
  }

  const cancellations: Array<{
    generationId: string;
    modelIdentifier: string;
    providerMetadata: JsonObject | null;
  }> = [];

  for (const step of record.steps) {
    if (step.status === 'running') {
      const canceledStep = await store.updateRunningStep(step.id, {
        completedAt: new Date().toISOString(),
        status: 'canceled',
      });

      if (canceledStep && step.babyseaGenerationId) {
        cancellations.push({
          generationId: step.babyseaGenerationId,
          modelIdentifier: step.modelIdentifier,
          providerMetadata: step.providerMetadata,
        });
      }
    }

    if (step.status === 'queued') {
      await store.updateQueuedStep(step.id, {
        completedAt: new Date().toISOString(),
        status: 'skipped',
      });
    }
  }

  await cancelGenerationsAtProvider(
    cancellations,
    byokConfig,
    providerOverrides,
  );

  const updated = await mustGetRun(store, runId);
  await deliverTerminalCallback(updated, store);
  await store.recordAuditEvent({
    action: 'run.canceled',
    apiKeyId: updated.run.apiKeyId,
    details: { reason: 'client_request' },
    runId,
  });

  return updated;
}

function findReadyQueuedStep(steps: ChainStepRecord[]) {
  return steps.find(
    (step) =>
      step.status === 'queued' &&
      step.dependsOn.every((dependency) =>
        steps.some(
          (candidate) =>
            candidate.stepKey === dependency &&
            candidate.status === 'succeeded',
        ),
      ),
  );
}

async function startStep(
  record: ChainRunWithSteps,
  step: ChainStepRecord,
  template: ChainTemplate,
  byokConfig: ByokRunConfig | null,
  providerOverrides: { babysea?: BabySea },
  store: ChainStore,
  agentCheckpoint: ChainAgentCheckpointRecord | null = null,
  storageProvider: StorageProvider | null | undefined = undefined,
) {
  const stepTemplate = template.steps.find(
    (candidate) => candidate.key === step.stepKey,
  );

  if (!stepTemplate) {
    throw new AppError(
      'step_template_not_found',
      'Step template was not found.',
      500,
    );
  }

  const context: ChainExecutionContext = {
    input: record.run.input,
    steps: toStepContext(record.steps),
  };
  let params: GenerationParams;
  const modelIdentifier = step.modelIdentifier;
  const resolution = resolveProvider(modelIdentifier, {
    byokMode: byokConfig !== null,
  });

  try {
    params = stepTemplate.buildParams(context);
    params = applyAgentParams(params, agentCheckpoint?.selectedParams ?? null);
    params = prepareStepParamsForProvider({
      input: context.input,
      params,
      providerName: resolution.provider,
      stepKey: step.stepKey,
    });
    await assertSafeGenerationParamsTargets(params);
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    const failedStep = await store.updateQueuedStep(step.id, {
      completedAt: new Date().toISOString(),
      errorCode: 'chain_step_params_failed',
      errorMessage,
      status: 'failed',
    });

    if (failedStep) {
      await failRun(record, store, 'chain_step_params_failed', errorMessage);
    }

    return;
  }

  // Use the resolved (provider-prefixed raw) identifier when talking to the
  // adapter so BYOK endpoints receive the real provider model id, not the
  // BabySea-style display name persisted on the step record.
  const providerModelIdentifier = resolution.modelIdentifier;

  let provider: Provider;
  try {
    provider = getProvider(resolution, byokConfig, providerOverrides);
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    const code =
      error instanceof AppError ? error.code : 'provider_resolution_failed';
    const failedStep = await store.updateQueuedStep(step.id, {
      completedAt: new Date().toISOString(),
      errorCode: code,
      errorMessage,
      status: 'failed',
    });
    if (failedStep) {
      await failRun(record, store, code, errorMessage);
    }
    return;
  }

  const startedAt = new Date().toISOString();

  const claimedStep = await store.claimQueuedStep(step.id, {
    requestParams: toJsonObject(params),
    startedAt,
    status: 'running',
  });

  if (!claimedStep) {
    return;
  }

  const runningRun = await store.updateActiveRun(record.run.id, {
    currentStepKey: step.stepKey,
    status: 'running',
  });

  if (!runningRun) {
    await store.updateRunningStep(claimedStep.id, {
      completedAt: new Date().toISOString(),
      status: 'canceled',
    });
    return;
  }

  if (agentCheckpoint) {
    await store.markAgentCheckpointApplied(agentCheckpoint.id);
  }

  try {
    const result = await provider.submit({
      modelIdentifier: providerModelIdentifier,
      stepKey: stepTemplate.key,
      stepKind: stepTemplate.kind,
      params,
      idempotencyKey: createStepIdempotencyKey(record, claimedStep),
      sourceModelIdentifier: modelIdentifier,
    });

    const updatedStep = await store.updateRunningStep(
      claimedStep.id,
      await submitResultPatch(result, provider.name, claimedStep, {
        storage: storageProvider,
      }),
    );

    if (!updatedStep) {
      await cancelStartedGeneration(result, provider, providerModelIdentifier);
    }
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    const code =
      error instanceof AppError ? error.code : 'babysea_generate_failed';

    if (isTransientProviderErrorCode(code)) {
      const retryableStep = await store.updateRunningStep(claimedStep.id, {
        completedAt: null,
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        status: 'queued',
      });

      if (!retryableStep) {
        return;
      }

      await store.updateActiveRun(record.run.id, {
        currentStepKey: null,
        errorCode: null,
        errorMessage: null,
        status: 'queued',
      });
      return;
    }

    const failedStep = await store.updateRunningStep(claimedStep.id, {
      completedAt: new Date().toISOString(),
      errorCode: code,
      errorMessage,
      status: 'failed',
    });

    if (!failedStep) {
      return;
    }

    await store.updateActiveRun(record.run.id, {
      completedAt: new Date().toISOString(),
      errorCode: code,
      errorMessage,
      status: 'failed',
    });
  }
}

type AgentCheckpointOutcome =
  | { kind: 'ready'; checkpoint: ChainAgentCheckpointRecord | null }
  | { kind: 'paused' }
  | { kind: 'failed'; errorCode: string; errorMessage: string };

async function resolveExistingAgentCheckpoint(
  existing: ChainAgentCheckpointRecord,
  args: {
    readyStep: ChainStepRecord;
    record: ChainRunWithSteps;
    store: ChainStore;
  },
): Promise<AgentCheckpointOutcome> {
  const { readyStep, record, store } = args;

  if (existing.status === 'failed') {
    return {
      kind: 'failed',
      errorCode: existing.errorCode ?? 'chain_agent_failed',
      errorMessage: existing.errorMessage ?? 'Chain Agent checkpoint failed.',
    };
  }

  if (existing.status === 'suggested') {
    await store.updateActiveRun(record.run.id, {
      currentStepKey: readyStep.stepKey,
      status: 'awaiting_agent',
    });
    return { kind: 'paused' };
  }

  if (!existing.selectedParams || !existing.selectedPrompt) {
    return {
      kind: 'failed',
      errorCode: 'chain_agent_invalid_checkpoint',
      errorMessage: 'Agent checkpoint is missing selected prompt data.',
    };
  }

  return { kind: 'ready', checkpoint: existing };
}

async function prepareAgentCheckpoint(args: {
  agent?: ChainAgent;
  readyStep: ChainStepRecord;
  record: ChainRunWithSteps;
  store: ChainStore;
}): Promise<AgentCheckpointOutcome> {
  const { readyStep, record, store } = args;
  const execution = record.run.executionConfig;

  if (execution.type !== 'chain_agent' || readyStep.dependsOn.length === 0) {
    return { kind: 'ready', checkpoint: null };
  }

  const existing =
    record.agentCheckpoints.find(
      (checkpoint) => checkpoint.stepKey === readyStep.stepKey,
    ) ??
    (await store.getAgentCheckpointForStep(record.run.id, readyStep.stepKey));

  if (existing) {
    return resolveExistingAgentCheckpoint(existing, {
      readyStep,
      record,
      store,
    });
  }

  const previousStepKey = readyStep.dependsOn[readyStep.dependsOn.length - 1];
  const previousStep = record.steps.find(
    (step) => step.stepKey === previousStepKey && step.status === 'succeeded',
  );

  if (!previousStep) {
    return {
      kind: 'failed',
      errorCode: 'chain_agent_context_missing',
      errorMessage: 'Chain Agent could not find the previous completed step.',
    };
  }

  try {
    const agent = args.agent ?? createChainAgent(execution);
    const previousStepForAgent = {
      ...previousStep,
      outputFiles: outputFilesWithStorageUrls({
        files: previousStep.outputFiles,
        providerMetadata: previousStep.providerMetadata,
      }),
    };
    const metadataModelContext = record.run.metadata.model_context;
    const ownerModelContext =
      typeof metadataModelContext === 'string'
        ? metadataModelContext.trim()
        : '';
    const agentContext = {
      currentInput: record.run.input as JsonObject,
      ...(ownerModelContext ? { modelContext: ownerModelContext } : {}),
      flow: {
        currentStepKey: previousStepForAgent.stepKey,
        nextStepKey: readyStep.stepKey,
        mode: execution.mode,
      },
      previousStep: previousStepForAgent,
      nextStep: {
        ...readyStep,
        requestParams: agentStepRequestParams(record, readyStep),
        schema: agentStepSchema(readyStep),
      },
    };
    // A concurrent processor (an overlapping cron tick or the BabySea webhook
    // for the previous step) may have produced this checkpoint while we were
    // assembling the agent context. Re-check immediately before the expensive
    // model call so we don't pay for a duplicate agent invocation; the
    // ON CONFLICT insert below stays the authoritative correctness guard.
    const concurrent = await store.getAgentCheckpointForStep(
      record.run.id,
      readyStep.stepKey,
    );
    if (concurrent) {
      return resolveExistingAgentCheckpoint(concurrent, {
        readyStep,
        record,
        store,
      });
    }

    const result = await agent.suggestNextStep(agentContext);
    const nextStepSchema = agentStepSchema(readyStep);
    const selectedParams = normalizeAgentSelectedParams(
      result.selectedPrompt,
      result.selectedParams,
      {
        allowSelectedPromptFallback: schemaSupportsAgentPrompt(nextStepSchema),
      },
    );
    const completedSelectedParams = withFreshAgentSeed(
      completeChainAgentSelectedParams(
        selectedParams,
        {
          nextStep: {
            requestParams: agentContext.nextStep.requestParams,
            schema: nextStepSchema,
          },
        },
        { pinPromptEnhancementOff: true },
      ),
      nextStepSchema,
      record,
    );
    const validation = validateChainAgentResult(
      {
        selectedParams: completedSelectedParams,
        selectedPrompt: result.selectedPrompt,
        suggestions: result.suggestions,
      },
      agentContext,
    );

    if (!validation.ok) {
      return {
        kind: 'failed',
        errorCode: 'chain_agent_invalid_response',
        errorMessage: `Chain Agent response failed validation: ${validation.error}`,
      };
    }

    const checkpoint = await store.createAgentCheckpoint({
      inputSnapshot: agentInputSnapshot(
        record,
        previousStepForAgent,
        readyStep,
      ),
      mode: execution.mode,
      modelIdentifier: execution.modelIdentifier,
      output: {
        observations: result.observations,
        observability: result.observability ?? {},
        raw_text: result.rawText,
        selected_params: completedSelectedParams,
        selected_prompt: result.selectedPrompt,
        suggestions: result.suggestions as unknown as JsonObject['suggestions'],
      } as JsonObject,
      previousStepKey: previousStep.stepKey,
      provider: execution.provider,
      runId: record.run.id,
      selectedParams: completedSelectedParams,
      selectedPrompt: result.selectedPrompt,
      status: execution.mode === 'autopilot' ? 'approved' : 'suggested',
      stepKey: readyStep.stepKey,
    });

    await store.recordAuditEvent({
      action: 'agent_checkpoint.created',
      apiKeyId: record.run.apiKeyId,
      details: {
        checkpoint_id: checkpoint.id,
        mode: execution.mode,
        step_key: readyStep.stepKey,
      },
      runId: record.run.id,
    });

    if (execution.mode === 'copilot') {
      await store.updateActiveRun(record.run.id, {
        currentStepKey: readyStep.stepKey,
        status: 'awaiting_agent',
      });
      return { kind: 'paused' };
    }

    return { kind: 'ready', checkpoint };
  } catch (error) {
    return {
      kind: 'failed',
      errorCode: error instanceof AppError ? error.code : 'chain_agent_failed',
      errorMessage: toErrorMessage(error),
    };
  }
}

function agentStepRequestParams(
  record: ChainRunWithSteps,
  step: ChainStepRecord,
): JsonObject | null {
  const paramsKey = stepInputKey(step.stepKey);
  if (!paramsKey) return null;

  const params = record.run.input[paramsKey];
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return null;
  }

  return params as JsonObject;
}

function stepInputKey(stepKey: string) {
  switch (stepKey) {
    case 'image':
      return 'image_model_input';
    case 'refine':
      return 'refine_model_input';
    case 'video':
      return 'video_model_input';
    case 'modify':
      return 'modify_model_input';
    default:
      return null;
  }
}

function agentStepSchema(step: ChainStepRecord): JsonObject {
  const stepRole = toChainSchemaStepRole(step.stepKey);

  if (!stepRole) {
    return {};
  }

  return createSemanticRequestSchema(step.modelIdentifier, {
    chainFieldMode: chainFieldModeForRole(stepRole),
  }) as JsonObject;
}

// the app assigns a fresh generation_seed to every agent-planned step so the
// Agentic Workflow never reuses a model default (e.g. 42) or the same seed twice
// in a run. The value stays within the downstream schema's range so it still
// passes validation.
const AGENT_SEED_DEFAULT_MIN = 1;
const AGENT_SEED_DEFAULT_MAX = 2_147_483_647;

function withFreshAgentSeed(
  params: JsonObject,
  schema: JsonObject | null | undefined,
  record: ChainRunWithSteps,
): JsonObject {
  const range = agentSeedRange(schema);

  if (!range) {
    return params;
  }

  const seed = freshAgentSeedValue(range, collectUsedAgentSeeds(record));

  return { ...params, generation_seed: seed };
}

export function agentSeedRange(schema: JsonObject | null | undefined) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return null;
  }

  const properties = schema.properties;

  if (
    !properties ||
    typeof properties !== 'object' ||
    Array.isArray(properties)
  ) {
    return null;
  }

  const field = (properties as Record<string, unknown>).generation_seed;

  if (!field || typeof field !== 'object' || Array.isArray(field)) {
    return null;
  }

  const spec = field as Record<string, unknown>;
  const min =
    typeof spec.minimum === 'number'
      ? Math.ceil(spec.minimum)
      : AGENT_SEED_DEFAULT_MIN;
  const max =
    typeof spec.maximum === 'number'
      ? Math.floor(spec.maximum)
      : AGENT_SEED_DEFAULT_MAX;

  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return null;
  }

  return {
    min,
    max,
    defaultValue: typeof spec.default === 'number' ? spec.default : null,
  };
}

function collectUsedAgentSeeds(record: ChainRunWithSteps): Set<number> {
  const used = new Set<number>();

  const add = (params: unknown) => {
    if (params && typeof params === 'object' && !Array.isArray(params)) {
      const seed = (params as Record<string, unknown>).generation_seed;

      if (typeof seed === 'number' && Number.isFinite(seed)) {
        used.add(seed);
      }
    }
  };

  for (const step of record.steps) {
    add(step.requestParams);
  }

  for (const checkpoint of record.agentCheckpoints) {
    add(checkpoint.selectedParams);
  }

  return used;
}

export function freshAgentSeedValue(
  range: { min: number; max: number; defaultValue: number | null },
  used: Set<number>,
): number {
  const span = range.max - range.min + 1;
  let candidate = range.min + randomInt(0, span);

  for (
    let attempt = 0;
    attempt < 16 && (candidate === range.defaultValue || used.has(candidate));
    attempt += 1
  ) {
    candidate = range.min + randomInt(0, span);
  }

  // Guarantee the seed differs from the model default even in tiny ranges.
  if (candidate === range.defaultValue) {
    candidate = candidate < range.max ? candidate + 1 : range.min;
  }

  return candidate;
}

function toChainSchemaStepRole(value: string): ChainSchemaStepRole | null {
  return value === 'image' ||
    value === 'refine' ||
    value === 'video' ||
    value === 'modify'
    ? value
    : null;
}

function applyAgentParams(
  params: GenerationParams,
  selectedParams: JsonObject | null,
): GenerationParams {
  if (!selectedParams) {
    return params;
  }

  return {
    ...params,
    ...agentTunableParams(selectedParams),
  } as GenerationParams;
}

function normalizeAgentSelectedParams(
  selectedPrompt: string,
  selectedParams: JsonObject,
  options: { allowSelectedPromptFallback?: boolean } = {},
): JsonObject {
  const tunableParams = agentTunableParams(selectedParams);
  const generationPrompt =
    typeof tunableParams.generation_prompt === 'string' &&
    tunableParams.generation_prompt.trim().length > 0
      ? tunableParams.generation_prompt
      : options.allowSelectedPromptFallback === true
        ? selectedPrompt
        : null;

  if (!generationPrompt) {
    return tunableParams as JsonObject;
  }

  return {
    ...tunableParams,
    generation_prompt: generationPrompt,
  } as JsonObject;
}

function schemaSupportsAgentPrompt(schema: JsonObject | null | undefined) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return true;
  }

  const properties = schema.properties;

  return (
    properties !== null &&
    typeof properties === 'object' &&
    !Array.isArray(properties) &&
    'generation_prompt' in properties
  );
}

function agentTunableParams(params: JsonObject) {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([key]) =>
        key.startsWith('generation_') && !AGENT_RESERVED_PARAM_KEYS.has(key),
    ),
  );
}

function agentInputSnapshot(
  record: ChainRunWithSteps,
  previousStep: ChainStepRecord,
  nextStep: ChainStepRecord,
): JsonObject {
  return {
    run_id: record.run.id,
    previous_step: {
      step_key: previousStep.stepKey,
      step_kind: previousStep.stepKind,
      model_identifier: previousStep.modelIdentifier,
      output_files: previousStep.outputFiles.map(safeOutputReference),
    },
    next_step: {
      step_key: nextStep.stepKey,
      step_kind: nextStep.stepKind,
      model_identifier: nextStep.modelIdentifier,
    },
  };
}

function safeOutputReference(value: string) {
  if (!value.trim().toLowerCase().startsWith('data:')) {
    return value;
  }

  const commaIndex = value.indexOf(',');
  const header = commaIndex >= 0 ? value.slice(0, commaIndex) : 'data:';
  return `${header},<inline ${value.length} chars>`;
}

async function cancelStartedGeneration(
  result: ProviderSubmitResult,
  provider: Provider,
  modelIdentifier: string,
) {
  if (result.kind === 'completed') {
    return;
  }
  try {
    await provider.cancel({
      generationId: result.generationId,
      modelIdentifier,
      providerMetadata: result.providerMetadata ?? null,
    });
  } catch {
    // Local cancellation already won; provider cancel is best-effort cleanup.
  }
}

async function refreshStepFromProvider(
  step: ChainStepRecord,
  byokConfig: ByokRunConfig | null,
  providerOverrides: { babysea?: BabySea },
  store: ChainStore,
  storageProvider: StorageProvider | null | undefined = undefined,
) {
  if (!step.babyseaGenerationId) {
    return;
  }

  const resolution = resolveProvider(step.modelIdentifier, {
    byokMode: byokConfig !== null,
  });
  let provider: Provider;
  try {
    provider = getProvider(resolution, byokConfig, providerOverrides);
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    const code =
      error instanceof AppError ? error.code : 'provider_resolution_failed';
    await store.updateRunningStep(step.id, {
      completedAt: new Date().toISOString(),
      errorCode: code,
      errorMessage,
      status: 'failed',
    });
    return;
  }

  try {
    const status = await provider.poll({
      generationId: step.babyseaGenerationId,
      modelIdentifier: resolution.modelIdentifier,
      providerMetadata: step.providerMetadata,
    });
    await applyGenerationStatus(step, status, store, {
      storage: storageProvider,
    });
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    const code =
      error instanceof AppError ? error.code : 'provider_poll_failed';
    // Transient poll failures must not flip the step to failed prematurely;
    // only persisted state moves on success. Caller (cron) retries next tick.
    if (isTransientProviderErrorCode(code)) {
      return;
    }
    await store.updateRunningStep(step.id, {
      completedAt: new Date().toISOString(),
      errorCode: code,
      errorMessage,
      status: 'failed',
    });
  }
}

export function prepareStepParamsForProvider({
  params,
}: {
  input: ChainInput;
  params: GenerationParams;
  providerName: ProviderName;
  stepKey: string;
}): GenerationParams {
  return params;
}

function serverKeyNameForProvider(provider: ByokProviderName) {
  switch (provider) {
    case 'alibabacloud':
      return 'DASHSCOPE_API_KEY';
    case 'bfl':
      return 'BFL_API_KEY';
    case 'byteplus':
      return 'ARK_API_KEY';
    case 'google':
      return 'GEMINI_API_KEY or GOOGLE_API_KEY';
    case 'openai':
      return 'OPENAI_API_KEY';
    case 'runway':
      return 'RUNWAYML_API_SECRET';
    default: {
      const exhaustive: never = provider;
      return exhaustive;
    }
  }
}

async function applyGenerationStatus(
  step: ChainStepRecord,
  generation: Partial<Generation> & { provider_metadata?: JsonObject },
  store: ChainStore,
  options: { requestId?: string; storage?: StorageProvider | null } = {},
) {
  const status = generation.generation_status;
  const providerOrder =
    generation.generation_provider_order ?? step.providerOrder;
  let outputFiles = generation.generation_output_file ?? step.outputFiles;
  const completedAt =
    generation.generation_completed_at ?? new Date().toISOString();
  let mergedProviderMetadata = mergeProviderMetadata(
    step.providerMetadata,
    stripReservedProviderMetadata(generation.provider_metadata),
  );
  const requestId =
    options.requestId ??
    requestIdFromProviderMetadata(generation.provider_metadata) ??
    step.babyseaRequestId;
  const predictionId =
    typeof generation.generation_prediction_id === 'string' &&
    generation.generation_prediction_id.length > 0
      ? generation.generation_prediction_id
      : step.babyseaPredictionId;

  if (status === 'succeeded') {
    const persistedOutputs = await persistOutputFiles({
      outputFiles,
      ...(options.storage !== undefined ? { provider: options.storage } : {}),
      runId: step.runId,
      stepKey: step.stepKey,
    });
    outputFiles = persistedOutputs.outputFiles;
    if (persistedOutputs.storageMetadata) {
      mergedProviderMetadata = mergeProviderMetadata(mergedProviderMetadata, {
        app_storage: persistedOutputs.storageMetadata,
      });
    }

    await store.updateRunningStep(step.id, {
      completedAt,
      babyseaPredictionId: predictionId,
      babyseaRequestId: requestId,
      outputFiles,
      providerMetadata: mergedProviderMetadata,
      providerOrder,
      providerUsed: generation.generation_provider_used ?? step.providerUsed,
      status: 'succeeded',
    });
    return;
  }

  if (status === 'failed') {
    await store.updateRunningStep(step.id, {
      completedAt,
      babyseaPredictionId: predictionId,
      babyseaRequestId: requestId,
      errorCode: generation.generation_error_code ?? 'generation_failed',
      errorMessage:
        generation.generation_error ?? 'Provider generation failed.',
      providerMetadata: mergedProviderMetadata,
      providerOrder,
      providerUsed: generation.generation_provider_used ?? step.providerUsed,
      status: 'failed',
    });
    return;
  }

  if (status === 'canceled') {
    await store.updateRunningStep(step.id, {
      completedAt,
      babyseaPredictionId: predictionId,
      babyseaRequestId: requestId,
      providerMetadata: mergedProviderMetadata,
      providerOrder,
      providerUsed: generation.generation_provider_used ?? step.providerUsed,
      status: 'canceled',
    });
    return;
  }

  await store.updateRunningStep(step.id, {
    providerMetadata: mergedProviderMetadata,
    providerOrder,
    providerUsed: generation.generation_provider_used ?? step.providerUsed,
    babyseaPredictionId: predictionId,
    babyseaRequestId: requestId,
    status: 'running',
  });
}

async function completeRun(record: ChainRunWithSteps, store: ChainStore) {
  const output = serializeCompletedRunOutput(record);

  await store.updateActiveRun(record.run.id, {
    completedAt: new Date().toISOString(),
    currentStepKey: null,
    output,
    status: 'succeeded',
  });

  const updated = await mustGetRun(store, record.run.id);
  await deliverTerminalCallback(updated, store);
  return updated;
}

async function failRun(
  record: ChainRunWithSteps,
  store: ChainStore,
  code: string,
  message: string,
) {
  await store.updateActiveRun(record.run.id, {
    completedAt: new Date().toISOString(),
    currentStepKey: null,
    errorCode: code,
    errorMessage: message,
    status: 'failed',
  });

  // Downstream queued steps can never start once the run has failed (their
  // input will never arrive), so mark them skipped immediately instead of
  // leaving them queued forever.
  for (const step of record.steps) {
    if (step.status === 'queued') {
      await store.updateQueuedStep(step.id, {
        completedAt: new Date().toISOString(),
        status: 'skipped',
      });
    }
  }

  const updated = await mustGetRun(store, record.run.id);
  await deliverTerminalCallback(updated, store);
  return updated;
}

async function cancelRunRecord(
  record: ChainRunWithSteps,
  store: ChainStore,
  reason: string,
) {
  await store.updateActiveRun(record.run.id, {
    completedAt: new Date().toISOString(),
    currentStepKey: null,
    errorCode: reason,
    errorMessage: 'Chain run was canceled.',
    status: 'canceled',
  });

  const updated = await mustGetRun(store, record.run.id);
  await deliverTerminalCallback(updated, store);
  return updated;
}

async function deliverTerminalCallback(
  record: ChainRunWithSteps,
  store: ChainStore,
) {
  if (!record.run.callbackUrl || record.run.callbackStatus === 'delivered') {
    return;
  }

  const claimed = await store.claimCallbackDelivery(record.run.id);

  if (!claimed) {
    return;
  }

  const env = getEnv();
  const body = JSON.stringify(serializeRunWithSteps(record));
  const headers: Record<string, string> = {
    'Content-Length': String(Buffer.byteLength(body)),
    'Content-Type': 'application/json',
    'User-Agent': 'Marsha/0.1',
    'X-the app-Event': 'chain_run.completed',
  };

  if (env.APP_CALLBACK_SECRET) {
    headers['X-Marsha-Signature'] = signJsonPayload(
      env.APP_CALLBACK_SECRET,
      body,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CALLBACK_TIMEOUT_MS);

  try {
    const response = await postCallback(record.run.callbackUrl, {
      body,
      headers,
      signal: controller.signal,
    });
    const status = response.ok ? 'delivered' : 'failed';

    await store.recordCallbackDelivery({
      responseText: response.text,
      runId: record.run.id,
      status,
      statusCode: response.status,
    });
    await store.updateRun(record.run.id, {
      callbackClaimedAt: null,
      callbackStatus: status,
    });
  } catch (error) {
    await store.recordCallbackDelivery({
      responseText: toErrorMessage(error),
      runId: record.run.id,
      status: 'failed',
      statusCode: null,
    });
    await store.updateRun(record.run.id, {
      callbackClaimedAt: null,
      callbackStatus: 'failed',
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function postCallback(
  url: string,
  init: {
    body: string;
    headers: Record<string, string>;
    signal: AbortSignal;
  },
) {
  assertSafeCallbackUrl(url);

  return new Promise<{
    ok: boolean;
    status: number | null;
    text: string;
  }>((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        headers: init.headers,
        lookup: (hostname, options, callback) => {
          void lookupSafeCallbackAddress(hostname)
            .then((address) => {
              if (typeof options === 'object' && options.all) {
                const allCallback = callback as unknown as (
                  error: NodeJS.ErrnoException | null,
                  addresses: LookupAddress[],
                ) => void;

                allCallback(null, [address]);
                return;
              }

              callback(null, address.address, address.family);
            })
            .catch((error: unknown) => callback(toLookupError(error), '', 0));
        },
        method: 'POST',
        signal: init.signal,
      },
      (response) => {
        void readCallbackResponseText(response)
          .then((text) => {
            const status = response.statusCode ?? null;

            resolve({
              ok: status !== null && status >= 200 && status < 300,
              status,
              text,
            });
          })
          .catch(reject);
      },
    );

    request.on('error', reject);
    request.end(init.body);
  });
}

async function lookupSafeCallbackAddress(hostname: string) {
  const address = await lookupAllowedNetworkAddress(
    normalizeHostname(hostname),
  );

  if (!address) {
    throw new AppError(
      'invalid_callback_url',
      'Callback URL host resolves to a blocked address.',
      400,
    );
  }

  return address;
}

function readCallbackResponseText(response: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let responseText = '';

    response.setEncoding('utf8');
    response.on('data', (chunk: string) => {
      const remaining = CALLBACK_RESPONSE_TEXT_LIMIT - responseText.length;

      if (remaining > 0) {
        responseText += chunk.slice(0, remaining);
      }
    });
    response.on('end', () => resolve(responseText));
    response.on('error', reject);
  });
}

function toLookupError(error: unknown) {
  return error instanceof Error ? error : new Error(toErrorMessage(error));
}

function requestIdFromProviderMetadata(
  providerMetadata: JsonObject | null | undefined,
) {
  const requestId = providerMetadata?.request_id;

  return typeof requestId === 'string' && requestId.length > 0
    ? requestId
    : null;
}

async function submitResultPatch(
  result: ProviderSubmitResult,
  providerName: string,
  step: ChainStepRecord,
  options: { storage?: StorageProvider | null } = {},
) {
  if (result.kind === 'completed') {
    const persistedOutputs = await persistOutputFiles({
      outputFiles: result.outputFiles,
      ...(options.storage !== undefined ? { provider: options.storage } : {}),
      runId: step.runId,
      stepKey: step.stepKey,
    });
    const providerMetadata = persistedOutputs.storageMetadata
      ? mergeProviderMetadata(
          stripReservedProviderMetadata(result.providerMetadata),
          {
            app_storage: persistedOutputs.storageMetadata,
          },
        )
      : stripReservedProviderMetadata(result.providerMetadata);

    return {
      babyseaGenerationId: result.generationId,
      babyseaIdempotencyReplayed: false,
      babyseaPredictionId: null,
      babyseaRequestId: requestIdFromProviderMetadata(result.providerMetadata),
      completedAt: new Date().toISOString(),
      outputFiles: persistedOutputs.outputFiles,
      providerMetadata,
      providerOrder: result.providerOrder,
      providerUsed: result.providerUsed,
      status: 'succeeded' as const,
    };
  }

  const idempotencyReplayed =
    result.providerMetadata &&
    typeof result.providerMetadata.idempotency_replayed === 'boolean'
      ? (result.providerMetadata.idempotency_replayed as boolean)
      : false;

  return {
    babyseaGenerationId: result.generationId,
    babyseaIdempotencyReplayed: idempotencyReplayed,
    babyseaPredictionId: result.predictionId ?? null,
    babyseaRequestId: requestIdFromProviderMetadata(result.providerMetadata),
    providerMetadata: stripReservedProviderMetadata(result.providerMetadata),
    providerOrder: result.providerOrder,
    providerUsed: providerName === 'babysea' ? null : providerName,
    status: 'running' as const,
  };
}

function mergeProviderMetadata(
  existing: JsonObject | null,
  incoming: JsonObject | null | undefined,
): JsonObject | null {
  if (!incoming) {
    return existing;
  }
  return { ...(existing ?? {}), ...incoming };
}

function stripReservedProviderMetadata(
  metadata: JsonObject | null | undefined,
): JsonObject | null {
  if (!metadata) {
    return null;
  }

  const { app_storage: _reserved, ...rest } = metadata;
  return rest;
}

function readRunByokConfig(record: ChainRunWithSteps): ByokRunConfig | null {
  return readByokRunConfig(record.run.byokCredentials);
}

function isByokProviderName(
  provider: ProviderName,
): provider is ByokProviderName {
  return provider !== 'babysea';
}

function isTransientProviderErrorCode(code: string) {
  return TRANSIENT_PROVIDER_ERROR_CODES.has(code);
}

function generationFromWebhook(
  payload: GenerationWebhookPayload,
): Partial<Generation> {
  return {
    generation_completed_at:
      payload.webhook_data.generation_status === 'processing'
        ? null
        : payload.webhook_timestamp,
    generation_error: payload.webhook_data.generation_error,
    generation_error_code: payload.webhook_data.generation_error_code,
    generation_id: payload.webhook_data.generation_id,
    generation_output_file: payload.webhook_data.generation_output_file,
    generation_prediction_id: payload.webhook_data.generation_prediction_id,
    generation_provider_used: payload.webhook_data.generation_provider_used,
    generation_status: payload.webhook_data.generation_status,
  };
}

async function mustGetRun(store: ChainStore, runId: string) {
  const record = await store.getRunWithSteps(runId);

  if (!record) {
    throw new AppError('run_not_found', 'Chain run was not found.', 404);
  }

  return record;
}

function isStartingStepStale(step: ChainStepRecord) {
  if (!step.startedAt) {
    return true;
  }

  const startedAtMs = Date.parse(step.startedAt);

  if (!Number.isFinite(startedAtMs)) {
    return true;
  }

  return Date.now() - startedAtMs > STARTING_STEP_STALE_MS;
}

function isRunningStepStale(step: ChainStepRecord) {
  if (!step.startedAt) {
    // Without a start timestamp we cannot measure elapsed time, and the step
    // already holds a provider id, so do not watchdog-fail on an unknown clock.
    return false;
  }

  const startedAtMs = Date.parse(step.startedAt);

  if (!Number.isFinite(startedAtMs)) {
    return false;
  }

  return Date.now() - startedAtMs > runningStepTimeoutMs(step);
}

function toStepContext(steps: ChainStepRecord[]) {
  const entries = steps
    .filter((step) => step.status === 'succeeded')
    .map((step) => {
      const outputFiles = outputFilesWithStorageUrls({
        files: step.outputFiles,
        providerMetadata: step.providerMetadata,
      });

      return [
        step.stepKey,
        {
          generationId: step.babyseaGenerationId ?? '',
          modelIdentifier: step.modelIdentifier,
          outputFiles,
          predictionId: step.babyseaPredictionId,
          providerOrder: step.providerOrder,
          providerUsed: step.providerUsed,
          status: 'succeeded',
        } satisfies ChainStepOutput,
      ] as const;
    });

  return Object.fromEntries(entries);
}

function toJsonObject(params: Record<string, unknown>) {
  return params as JsonObject;
}

function createStepIdempotencyKey(
  record: ChainRunWithSteps,
  step: ChainStepRecord,
) {
  return `marsha:${record.run.id}:${step.stepKey}:${record.run.chainVersion}`;
}

export function assertSafeCallbackUrl(url: string) {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new AppError(
      'invalid_callback_url',
      'Callback URL must be a valid URL.',
      400,
    );
  }

  if (parsed.protocol !== 'https:') {
    throw new AppError(
      'invalid_callback_url',
      'Callback URL must use HTTPS.',
      400,
    );
  }

  if (parsed.username || parsed.password) {
    throw new AppError(
      'invalid_callback_url',
      'Callback URL must not include credentials.',
      400,
    );
  }

  if (isBlockedNetworkHostname(parsed.hostname)) {
    throw new AppError(
      'invalid_callback_url',
      'Callback URL host is not allowed.',
      400,
    );
  }
}
