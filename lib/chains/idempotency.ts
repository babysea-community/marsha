import { readByokRunConfig } from '@/lib/providers';
import { AppError } from '@/lib/utils/errors';

import type {
  ChainExecutionConfig,
  ChainInput,
  ChainRunRecord,
  JsonObject,
} from './types';

export type IdempotentRunRequest = {
  byokProviders?: string[];
  callbackUrl: string | null;
  input: ChainInput;
  executionConfig?: ChainExecutionConfig;
  metadata: JsonObject;
  providerMode?: 'babysea' | 'byok';
};

export function assertIdempotentRunMatches(
  run: ChainRunRecord,
  request: IdempotentRunRequest,
) {
  const conflicts = idempotencyConflictFields(run, request);

  if (conflicts.length === 0) {
    return;
  }

  throw new AppError(
    'idempotency_conflict',
    'Idempotency-Key was already used with different run input, metadata, execution, webhook_url, or provider mode.',
    409,
    { conflicts },
  );
}

function idempotencyConflictFields(
  run: ChainRunRecord,
  request: IdempotentRunRequest,
) {
  const conflicts: string[] = [];

  if (!sameJsonValue(run.input, request.input)) {
    conflicts.push('input');
  }

  if (!sameJsonValue(run.metadata, request.metadata)) {
    conflicts.push('metadata');
  }

  if (!sameJsonValue(run.executionConfig, normalizedExecution(request))) {
    conflicts.push('execution');
  }

  if (run.callbackUrl !== request.callbackUrl) {
    conflicts.push('webhook_url');
  }

  if (!sameJsonValue(byokProvidersForRun(run), normalizedProviders(request))) {
    conflicts.push('byok_providers');
  }

  if (providerModeForRun(run) !== (request.providerMode ?? 'babysea')) {
    conflicts.push('provider_mode');
  }

  return conflicts;
}

function providerModeForRun(run: ChainRunRecord) {
  if (readByokRunConfig(run.byokCredentials)) {
    return 'byok';
  }

  return 'babysea';
}

function byokProvidersForRun(run: ChainRunRecord) {
  return [...(readByokRunConfig(run.byokCredentials)?.providers ?? [])].sort();
}

function normalizedProviders(request: IdempotentRunRequest) {
  return [...(request.byokProviders ?? [])].sort();
}

function normalizedExecution(request: IdempotentRunRequest) {
  return request.executionConfig ?? { type: 'self_control' };
}

function sameJsonValue(left: unknown, right: unknown) {
  return stableJsonStringify(left) === stableJsonStringify(right);
}

function stableJsonStringify(value: unknown) {
  return JSON.stringify(toStableJson(value));
}

function toStableJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toStableJson);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [
        key,
        toStableJson((value as Record<string, unknown>)[key]),
      ]),
  );
}
