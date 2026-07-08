import type { NextRequest } from 'next/server';

import {
  authenticateRequest,
  getClientRequestId,
  getIdempotencyKey,
  parseSchema,
  readJsonBody,
} from '@/lib/api';
import { createBabySeaClient, isBabySeaConfigured } from '@/lib/babysea';
import { defaultBedrockNovaModelIdentifier } from '@/lib/agents/amazon-nova';
import {
  assertIdempotentRunMatches,
  type IdempotentRunRequest,
} from '@/lib/chains/idempotency';
import { preserveInputOrder } from '@/lib/chains/input-order';
import { serializeRunWithSteps } from '@/lib/chains/presenters';
import {
  estimateChain,
  processRun,
  assertSafeCallbackUrl,
} from '@/lib/chains/runner';
import { CreateRunRequestSchema } from '@/lib/chains/schemas';
import type { ChainStore } from '@/lib/chains/store';
import {
  assertChainInputRequirements,
  assertSafeChainInputTargets,
  getChainTemplate,
  resolveStepModel,
  selectChainTemplateSteps,
} from '@/lib/chains/templates';
import type {
  ChainExecutionConfig,
  ChainRunWithSteps,
  JsonObject,
} from '@/lib/chains/types';
import {
  resolveProvider,
  resolveServerByokConfig,
  type ByokProviderName,
  type ByokRunConfig,
  type ProviderName,
} from '@/lib/providers';
import { deriveSecretDigestHex } from '@/lib/security/crypto';
import { jsonAccepted, jsonError } from '@/lib/security/http';
import { AppError } from '@/lib/utils/errors';
import { getEnv } from '@/lib/utils/env';

export const dynamic = 'force-dynamic';
// Keep in sync with APP_SDK_ROUTE_MAX_DURATION_SECONDS.
// The starter keeps this at 300 for broad Vercel compatibility. Raise it only
// on deployments whose plan supports a higher route duration.
export const maxDuration = 300;
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const template = getChainTemplate('chain');

    if (!template) {
      throw new AppError(
        'chain_not_found',
        'Chain template was not found.',
        404,
      );
    }

    const { principal, store } = await authenticateRequest(
      request,
      'chains:run',
    );
    const body = await readJsonBody(request);
    const payload = parseSchema(CreateRunRequestSchema, body);
    const executionConfig = executionConfigFromPayload(payload.execution);
    const byokConfig = resolveServerByokConfig();
    const directProviderMode = byokConfig !== null;
    const providerMode: 'babysea' | 'byok' = byokConfig ? 'byok' : 'babysea';
    const configuredByokProviders = byokConfig?.providers ?? [];
    const parsedInput = parseSchema(
      template.inputSchema,
      payload.input,
      'invalid_chain_input',
    );
    const input = preserveInputOrder(parsedInput, payload.input);
    assertChainInputRequirements(template, input, {
      agentDownstreamInputs: executionConfig.type === 'chain_agent',
      byokMode: directProviderMode,
    });
    const selectedSteps = selectChainTemplateSteps(template, input);
    const byokProviders =
      byokConfig !== null
        ? requiredByokProvidersForInput(selectedSteps, input)
        : [];
    const runProviderConfig: ByokRunConfig | null = byokConfig
      ? { ...byokConfig, providers: byokProviders }
      : null;
    const idempotencyKey = getIdempotencyKey(request);
    const idempotencyKeyHash = idempotencyKey
      ? deriveSecretDigestHex(
          getEnv().APP_CALLBACK_SECRET,
          `${template.slug}:${idempotencyKey}`,
        )
      : null;
    // model_context (Creator Brief) is only consumed by the Chain Agent; a
    // self_control run never reads it, so drop it from stored metadata.
    const runMetadata =
      executionConfig.type === 'self_control'
        ? stripAgentOnlyMetadata(payload.metadata as JsonObject)
        : (payload.metadata as JsonObject);
    const replayRequest: IdempotentRunRequest = {
      callbackUrl: payload.webhook_url ?? null,
      byokProviders,
      executionConfig,
      input,
      metadata: runMetadata,
      providerMode,
    };

    if (idempotencyKeyHash) {
      const existing = await store.findIdempotentRun({
        chainSlug: template.slug,
        idempotencyKeyHash,
        principal,
      });

      if (existing) {
        assertIdempotentRunMatches(existing.run, replayRequest);

        return jsonAccepted(serializeRunWithSteps(existing));
      }
    }

    await assertSafeChainInputTargets(input);

    if (payload.webhook_url) {
      assertSafeCallbackUrl(payload.webhook_url);
    }

    const babysea = isBabySeaConfigured() ? createBabySeaClient() : undefined;
    const estimate = await estimateChain(template, input, babysea, {
      byokMode: byokConfig !== null,
      byokProviders: configuredByokProviders,
      steps: selectedSteps,
    });
    const record = await store.createRun({
      byokCredentials: runProviderConfig as unknown as JsonObject | null,
      byokProviders,
      callbackUrl: payload.webhook_url ?? null,
      chainSlug: template.slug,
      chainVersion: template.version,
      clientRequestId: getClientRequestId(request),
      estimate,
      executionConfig,
      idempotencyKeyHash,
      input,
      metadata: replayRequest.metadata,
      principal,
      steps: selectedSteps.map((step, stepIndex) => ({
        dependsOn: step.dependsOn,
        modelIdentifier: resolveStepModel(step.model, input),
        stepIndex,
        stepKey: step.key,
        stepKind: step.kind,
      })),
    });

    assertIdempotentRunMatches(record.run, replayRequest);

    await store.recordAuditEvent({
      action: 'run.created',
      apiKeyId: principal.apiKeyId,
      details: {
        chain_slug: template.slug,
        idempotency_replayed: record.run.status !== 'queued',
        byok_providers: byokProviders,
        provider_mode: providerMode,
        execution: executionConfig,
      },
      runId: record.run.id,
    });

    const processed = await tryProcessImmediately(record, babysea, store);

    return jsonAccepted(serializeRunWithSteps(processed));
  } catch (error) {
    return await jsonError(error);
  }
}

function executionConfigFromPayload(
  value: ReturnType<typeof CreateRunRequestSchema.parse>['execution'],
): ChainExecutionConfig {
  if (value.type !== 'chain_agent') {
    return { type: 'self_control' };
  }

  return {
    type: 'chain_agent',
    mode: value.mode ?? 'copilot',
    provider: value.provider ?? 'bedrock',
    modelIdentifier:
      value.model_identifier ?? defaultBedrockNovaModelIdentifier(),
  };
}

// model_context (Creator Brief) is only consumed by the Chain Agent, so it is
// dropped from self_control run metadata.
function stripAgentOnlyMetadata(metadata: JsonObject): JsonObject {
  if (!('model_context' in metadata)) {
    return metadata;
  }

  const { model_context: _modelContext, ...rest } = metadata;
  return rest as JsonObject;
}

function requiredByokProvidersForInput(
  steps: NonNullable<ReturnType<typeof getChainTemplate>>['steps'],
  input: Record<string, unknown>,
) {
  const providers = new Set<ByokProviderName>();

  for (const step of steps) {
    const modelIdentifier = resolveStepModel(step.model, input);
    const resolution = resolveProvider(modelIdentifier, { byokMode: true });

    if (isByokProviderName(resolution.provider)) {
      providers.add(resolution.provider);
    }
  }

  return [...providers].sort();
}

function isByokProviderName(
  provider: ProviderName,
): provider is ByokProviderName {
  return provider !== 'babysea';
}

// Immediate processing is an opportunistic optimization. The run is already
// persisted and the cron worker will advance it, so a processing failure here
// must not surface as a 5xx (which would tempt callers to retry without an
// Idempotency-Key and create duplicate runs). Fall back to the queued record.
async function tryProcessImmediately(
  record: ChainRunWithSteps,
  babysea: ReturnType<typeof createBabySeaClient> | undefined,
  store: ChainStore,
) {
  try {
    return await processRun(record, { babysea, store });
  } catch {
    return record;
  }
}
