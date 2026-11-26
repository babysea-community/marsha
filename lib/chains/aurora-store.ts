import 'server-only';

import type { PoolClient } from 'pg';

import type { ApiKeyLookupStore, StoredApiKey } from '@/lib/api/auth';

import {
  dbQuery as auroraQuery,
  dbTransaction as auroraTransaction,
} from '@/lib/database';
import { assertIdempotentRunMatches } from './idempotency';
import { applyInputOrder, captureInputOrder } from './input-order';
import type {
  ApproveAgentCheckpointInput,
  CreateAgentCheckpointInput,
  CreateChainRunInput,
  ChainRunPatch,
  ChainStepPatch,
  FindIdempotentRunInput,
} from './store';
import type {
  ChainAgentCheckpointRecord,
  ChainAgentCheckpointStatus,
  ChainExecutionConfig,
  ChainRunRecord,
  ChainRunStatus,
  ChainRunWithSteps,
  ChainStepKind,
  ChainStepRecord,
  ChainStepStatus,
  JsonObject,
} from './types';

type Row = Record<string, unknown>;

const SCHEMA = 'app_private';
const STALE_MS = 2 * 60 * 1000;
// A terminal-run callback is retried until it succeeds or this many attempts
// have been made, after which it stays 'failed' and is no longer reselected.
const CALLBACK_MAX_ATTEMPTS =
  Number(process.env.APP_CALLBACK_MAX_ATTEMPTS) || 8;
// A cron pass leases an active run while it advances it so overlapping passes
// do not both poll the same run. The lease is cleared after processing; a
// crashed pass's lease expires after this window so the run can be reclaimed.
const PROCESSING_CLAIM_STALE_MS = 10 * 60 * 1000;
// Audit/delivery rows older than this are pruned, in bounded batches per pass.
const AUDIT_RETENTION_MS =
  (Number(process.env.APP_AUDIT_RETENTION_DAYS) || 30) * 24 * 60 * 60 * 1000;
const AUDIT_PRUNE_BATCH = 500;

/**
 * AWS Aurora (PostgreSQL) implementation of the the app chain store.
 *
 * Implements the `ChainStore` contract consumed by `runner.ts` and the API
 * routes, talking to Aurora via `pg`. The API-key verification and the
 * callback/webhook claim operations are implemented as direct SQL since Aurora
 * connects as a privileged role.
 */
export class AuroraChainStore implements ApiKeyLookupStore {
  async verifyApiKey(apiKey: string): Promise<StoredApiKey | null> {
    if (!apiKey || apiKey.length < 12) {
      return null;
    }

    const prefix = apiKey.slice(0, 12);
    const result = await auroraQuery<Row>(
      `select id, name, key_prefix, scopes, expires_at
         from ${SCHEMA}.api_key
        where key_prefix = $1
          and is_active = true
          and crypt($2, key_hash) = key_hash
        limit 1`,
      [prefix, apiKey],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    if (row.expires_at && new Date(row.expires_at as string) < new Date()) {
      return null;
    }

    await auroraQuery(
      `update ${SCHEMA}.api_key set last_used_at = now() where id = $1`,
      [row.id],
    );

    return {
      id: row.id as string,
      keyPrefix: row.key_prefix as string,
      name: row.name as string,
      scopes: arr(row.scopes),
    };
  }

  async createRun(input: CreateChainRunInput): Promise<ChainRunWithSteps> {
    if (input.idempotencyKeyHash) {
      const existing = await this.findIdempotentRun({
        chainSlug: input.chainSlug,
        idempotencyKeyHash: input.idempotencyKeyHash,
        principal: input.principal,
      });

      if (existing) {
        assertIdempotentRunMatches(existing.run, input);
        return existing;
      }
    }

    try {
      return await auroraTransaction(async (client) => {
        const runResult = await client.query<Row>(
          `insert into ${SCHEMA}.chain_run (
             api_key_id, api_key_prefix, byok_credentials, callback_url,
             chain_slug, chain_version, client_request_id, estimate,
             execution_config, idempotency_key_hash, input, input_order,
             metadata, status
           ) values (
             $1, $2, $3::jsonb, $4, $5, $6, $7, $8::jsonb, $9::jsonb,
             $10, $11::jsonb, $12::jsonb, $13::jsonb, 'queued'
           ) returning *`,
          [
            input.principal.apiKeyId,
            input.principal.keyPrefix,
            jsonParam(input.byokCredentials),
            input.callbackUrl,
            input.chainSlug,
            input.chainVersion,
            input.clientRequestId,
            jsonParam(input.estimate as JsonObject | null),
            jsonParam(input.executionConfig as unknown as JsonObject),
            input.idempotencyKeyHash,
            jsonParam(input.input as JsonObject),
            jsonParam(captureInputOrder(input.input) as JsonObject),
            jsonParam(input.metadata),
          ],
        );

        const run = toRunRecord(runResult.rows[0]!);
        const steps = await insertSteps(client, run.id, input.steps);

        return { run, steps, agentCheckpoints: [] };
      });
    } catch (error) {
      if (isUniqueViolation(error) && input.idempotencyKeyHash) {
        const existing = await this.findIdempotentRun({
          chainSlug: input.chainSlug,
          idempotencyKeyHash: input.idempotencyKeyHash,
          principal: input.principal,
        });

        if (existing) {
          assertIdempotentRunMatches(existing.run, input);
          return existing;
        }
      }

      throw error;
    }
  }

  async getRunWithSteps(runId: string): Promise<ChainRunWithSteps | null> {
    const runResult = await auroraQuery<Row>(
      `select * from ${SCHEMA}.chain_run where id = $1`,
      [runId],
    );
    const runRow = runResult.rows[0];
    if (!runRow) {
      return null;
    }

    const steps = await this.fetchSteps(runId);
    const agentCheckpoints = await this.fetchAgentCheckpoints(runId);
    return { run: toRunRecord(runRow), steps, agentCheckpoints };
  }

  private async fetchSteps(runId: string): Promise<ChainStepRecord[]> {
    const result = await auroraQuery<Row>(
      `select * from ${SCHEMA}.chain_step where run_id = $1 order by step_index asc`,
      [runId],
    );
    return result.rows.map(toStepRecord);
  }

  private async fetchAgentCheckpoints(
    runId: string,
  ): Promise<ChainAgentCheckpointRecord[]> {
    const result = await auroraQuery<Row>(
      `select * from ${SCHEMA}.chain_agent_checkpoint
        where run_id = $1
        order by created_at asc`,
      [runId],
    );
    return result.rows.map(toAgentCheckpointRecord);
  }

  async claimCallbackDelivery(runId: string): Promise<boolean> {
    const staleBefore = new Date(Date.now() - STALE_MS).toISOString();
    const result = await auroraQuery(
      `update ${SCHEMA}.chain_run
          set callback_status = 'delivering',
              callback_claimed_at = now(),
              callback_attempts = callback_attempts + 1
        where id = $1
          and callback_attempts < $3
          and (
            callback_status is null
            or callback_status = 'failed'
            or (callback_status = 'delivering'
                and (callback_claimed_at is null or callback_claimed_at < $2))
          )`,
      [runId, staleBefore, CALLBACK_MAX_ATTEMPTS],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async findStepByBabySeaGenerationId(
    generationId: string,
  ): Promise<ChainStepRecord | null> {
    const result = await auroraQuery<Row>(
      `select * from ${SCHEMA}.chain_step
        where babysea_generation_id = $1 limit 1`,
      [generationId],
    );
    const row = result.rows[0];
    return row ? toStepRecord(row) : null;
  }

  async updateRun(
    runId: string,
    patch: ChainRunPatch,
  ): Promise<ChainRunRecord> {
    const built = buildSet(patch, RUN_PATCH_COLUMNS, 1);
    if (built.fragments.length === 0) {
      const current = await this.getRunWithSteps(runId);
      if (!current) {
        throw new Error(`Run ${runId} not found.`);
      }
      return current.run;
    }

    const result = await auroraQuery<Row>(
      `update ${SCHEMA}.chain_run set ${built.fragments.join(', ')}
        where id = $${built.values.length + 1} returning *`,
      [...built.values, runId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(`Run ${runId} not found.`);
    }
    return toRunRecord(row);
  }

  async updateActiveRun(
    runId: string,
    patch: ChainRunPatch,
  ): Promise<ChainRunRecord | null> {
    const built = buildSet(patch, RUN_PATCH_COLUMNS, 1);
    if (built.fragments.length === 0) {
      return null;
    }

    const result = await auroraQuery<Row>(
      `update ${SCHEMA}.chain_run set ${built.fragments.join(', ')}
        where id = $${built.values.length + 1}
          and status in ('queued','running','awaiting_agent')
        returning *`,
      [...built.values, runId],
    );
    const row = result.rows[0];
    return row ? toRunRecord(row) : null;
  }

  async updateStep(
    stepId: string,
    patch: ChainStepPatch,
  ): Promise<ChainStepRecord> {
    const row = await this.updateStepWhere(stepId, patch, null);
    if (!row) {
      throw new Error(`Step ${stepId} not found.`);
    }
    return row;
  }

  async updateRunningStep(
    stepId: string,
    patch: ChainStepPatch,
  ): Promise<ChainStepRecord | null> {
    return this.updateStepWhere(stepId, patch, 'running');
  }

  async updateQueuedStep(
    stepId: string,
    patch: ChainStepPatch,
  ): Promise<ChainStepRecord | null> {
    return this.updateStepWhere(stepId, patch, 'queued');
  }

  async claimQueuedStep(
    stepId: string,
    patch: ChainStepPatch,
  ): Promise<ChainStepRecord | null> {
    return this.updateStepWhere(stepId, patch, 'queued');
  }

  private async updateStepWhere(
    stepId: string,
    patch: ChainStepPatch,
    requiredStatus: ChainStepStatus | null,
  ): Promise<ChainStepRecord | null> {
    const built = buildSet(patch, STEP_PATCH_COLUMNS, 1);
    if (built.fragments.length === 0) {
      return null;
    }

    const params = [...built.values, stepId];
    let where = `id = $${params.length}`;
    if (requiredStatus) {
      params.push(requiredStatus);
      where += ` and status = $${params.length}`;
    }

    const result = await auroraQuery<Row>(
      `update ${SCHEMA}.chain_step set ${built.fragments.join(', ')}
        where ${where} returning *`,
      params,
    );
    const row = result.rows[0];
    return row ? toStepRecord(row) : null;
  }

  async findIdempotentRun(
    input: FindIdempotentRunInput,
  ): Promise<ChainRunWithSteps | null> {
    const params: unknown[] = [input.chainSlug, input.idempotencyKeyHash];
    let where = 'chain_slug = $1 and idempotency_key_hash = $2';

    if (input.principal.apiKeyId) {
      params.push(input.principal.apiKeyId);
      where += ` and api_key_id = $${params.length}`;
    } else {
      params.push(input.principal.keyPrefix);
      where += ` and api_key_id is null and api_key_prefix = $${params.length}`;
    }

    const result = await auroraQuery<Row>(
      `select id from ${SCHEMA}.chain_run where ${where} limit 1`,
      params,
    );
    const row = result.rows[0];
    return row ? this.getRunWithSteps(row.id as string) : null;
  }

  async findRunsToProcess(limit: number): Promise<ChainRunWithSteps[]> {
    if (limit <= 0) {
      return [];
    }

    const ids: string[] = [];
    const seen = new Set<string>();
    const pushId = (id: string) => {
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    };

    // Atomically lease active runs so two overlapping cron passes never both
    // poll the same run. `for update skip locked` makes concurrent claimers
    // take disjoint rows; the persisted lease excludes the run from later
    // passes until releaseRunClaim clears it (or the stale window elapses).
    const claimStaleBefore = new Date(
      Date.now() - PROCESSING_CLAIM_STALE_MS,
    ).toISOString();
    const claimed = await auroraQuery<Row>(
      `update ${SCHEMA}.chain_run as r
          set processing_claimed_at = now()
        where r.id in (
          select id from ${SCHEMA}.chain_run
            where status in ('queued','running')
              and (processing_claimed_at is null or processing_claimed_at < $1)
            order by created_at asc
            for update skip locked
            limit $2
        )
        returning r.id`,
      [claimStaleBefore, limit],
    );

    for (const row of claimed.rows) {
      pushId(row.id as string);
    }

    if (ids.length < limit) {
      await this.appendCallbackRunIds(pushId, seen, limit - ids.length);
    }

    return this.getRunsWithSteps(ids);
  }

  private async appendCallbackRunIds(
    pushId: (id: string) => void,
    seen: Set<string>,
    remaining: number,
  ) {
    let left = remaining;
    if (left <= 0) {
      return;
    }

    const staleBefore = new Date(Date.now() - STALE_MS).toISOString();

    const selectCallbackRuns = (extra: string, params: unknown[]) =>
      auroraQuery<Row>(
        `select id from ${SCHEMA}.chain_run
          where status in ('succeeded','failed','canceled')
            and callback_url is not null
            and callback_attempts < $${params.length + 1}
            and ${extra}
          order by updated_at asc
          limit $${params.length + 2}`,
        [...params, CALLBACK_MAX_ATTEMPTS, left],
      );

    const take = (rows: Row[]) => {
      for (const row of rows) {
        if (left <= 0) {
          return;
        }
        const id = row.id as string;
        if (seen.has(id)) {
          continue;
        }
        pushId(id);
        left -= 1;
      }
    };

    take((await selectCallbackRuns('callback_status is null', [])).rows);

    if (left > 0) {
      take((await selectCallbackRuns("callback_status = 'failed'", [])).rows);
    }

    if (left > 0) {
      take(
        (
          await selectCallbackRuns(
            "callback_status = 'delivering' and callback_claimed_at < $1",
            [staleBefore],
          )
        ).rows,
      );
    }
  }

  /**
   * Batch-load runs + their steps + agent checkpoints in three queries instead
   * of one-plus-N-per-run, preserving the order of `ids`.
   */
  private async getRunsWithSteps(ids: string[]): Promise<ChainRunWithSteps[]> {
    if (ids.length === 0) {
      return [];
    }

    const [runResult, stepResult, checkpointResult] = await Promise.all([
      auroraQuery<Row>(
        `select * from ${SCHEMA}.chain_run where id = any($1::uuid[])`,
        [ids],
      ),
      auroraQuery<Row>(
        `select * from ${SCHEMA}.chain_step
          where run_id = any($1::uuid[])
          order by step_index asc`,
        [ids],
      ),
      auroraQuery<Row>(
        `select * from ${SCHEMA}.chain_agent_checkpoint
          where run_id = any($1::uuid[])
          order by created_at asc`,
        [ids],
      ),
    ]);

    const stepsByRun = new Map<string, ChainStepRecord[]>();
    for (const row of stepResult.rows) {
      const step = toStepRecord(row);
      const list = stepsByRun.get(step.runId);
      if (list) {
        list.push(step);
      } else {
        stepsByRun.set(step.runId, [step]);
      }
    }

    const checkpointsByRun = new Map<string, ChainAgentCheckpointRecord[]>();
    for (const row of checkpointResult.rows) {
      const checkpoint = toAgentCheckpointRecord(row);
      const list = checkpointsByRun.get(checkpoint.runId);
      if (list) {
        list.push(checkpoint);
      } else {
        checkpointsByRun.set(checkpoint.runId, [checkpoint]);
      }
    }

    const runsById = new Map<string, ChainRunWithSteps>();
    for (const row of runResult.rows) {
      const run = toRunRecord(row);
      runsById.set(run.id, {
        run,
        steps: stepsByRun.get(run.id) ?? [],
        agentCheckpoints: checkpointsByRun.get(run.id) ?? [],
      });
    }

    const ordered: ChainRunWithSteps[] = [];
    for (const id of ids) {
      const record = runsById.get(id);
      if (record) {
        ordered.push(record);
      }
    }
    return ordered;
  }

  /** Clear an active run's processing lease so the next pass can advance it. */
  async releaseRunClaim(runId: string): Promise<void> {
    await auroraQuery(
      `update ${SCHEMA}.chain_run set processing_claimed_at = null
        where id = $1 and processing_claimed_at is not null`,
      [runId],
    );
  }

  /** Best-effort, bounded retention pruning of audit/delivery history. */
  async pruneExpiredRecords(): Promise<void> {
    const cutoff = new Date(Date.now() - AUDIT_RETENTION_MS).toISOString();

    const pruneTable = (
      table: 'audit_event' | 'callback_delivery' | 'babysea_webhook_delivery',
    ) =>
      auroraQuery(
        `delete from ${SCHEMA}.${table}
          where ctid in (
            select ctid from ${SCHEMA}.${table}
              where created_at < $1
              limit $2
          )`,
        [cutoff, AUDIT_PRUNE_BATCH],
      );

    await pruneTable('audit_event');
    await pruneTable('callback_delivery');
    await pruneTable('babysea_webhook_delivery');
  }

  async recordWebhookDelivery(input: {
    deliveryId: string;
    eventType: string;
    generationId: string | null;
    payload: JsonObject;
  }): Promise<boolean> {
    const inserted = await auroraQuery(
      `insert into ${SCHEMA}.babysea_webhook_delivery
         (id, event_type, generation_id, payload, status, claimed_at)
       values ($1, $2, $3, $4::jsonb, 'processing', now())
       on conflict (id) do nothing
       returning id`,
      [
        input.deliveryId,
        input.eventType,
        input.generationId ?? '',
        jsonParam(input.payload),
      ],
    );

    if ((inserted.rowCount ?? 0) > 0) {
      return true;
    }

    const staleBefore = new Date(Date.now() - STALE_MS).toISOString();
    const reclaimed = await auroraQuery(
      `update ${SCHEMA}.babysea_webhook_delivery
          set status = 'processing', claimed_at = now(), error = null, payload = $2::jsonb
        where id = $1
          and (status = 'failed' or (status = 'processing' and claimed_at < $3))
        returning id`,
      [input.deliveryId, jsonParam(input.payload), staleBefore],
    );

    return (reclaimed.rowCount ?? 0) > 0;
  }

  async markWebhookDelivery(input: {
    deliveryId: string;
    status: 'processed' | 'failed';
    error?: string;
  }): Promise<void> {
    const processedAt =
      input.status === 'processed' ? new Date().toISOString() : null;
    const guard = input.status === 'failed' ? " and status <> 'processed'" : '';

    await auroraQuery(
      `update ${SCHEMA}.babysea_webhook_delivery
          set error = $2, processed_at = $3, status = $4
        where id = $1${guard}`,
      [input.deliveryId, input.error ?? null, processedAt, input.status],
    );
  }

  async recordCallbackDelivery(input: {
    runId: string;
    status: string;
    statusCode: number | null;
    responseText: string | null;
  }): Promise<void> {
    await auroraQuery(
      `insert into ${SCHEMA}.callback_delivery
         (run_id, status, status_code, response_text)
       values ($1, $2, $3, $4)`,
      [input.runId, input.status, input.statusCode, input.responseText],
    );
  }

  async recordAuditEvent(input: {
    apiKeyId: string | null;
    action: string;
    details: JsonObject;
    runId?: string;
  }): Promise<void> {
    await auroraQuery(
      `insert into ${SCHEMA}.audit_event (action, api_key_id, details, run_id)
       values ($1, $2, $3::jsonb, $4)`,
      [
        input.action,
        input.apiKeyId,
        jsonParam(input.details),
        input.runId ?? null,
      ],
    );
  }

  async getAgentCheckpointForStep(
    runId: string,
    stepKey: string,
  ): Promise<ChainAgentCheckpointRecord | null> {
    const result = await auroraQuery<Row>(
      `select * from ${SCHEMA}.chain_agent_checkpoint
        where run_id = $1 and step_key = $2
        limit 1`,
      [runId, stepKey],
    );
    const row = result.rows[0];
    return row ? toAgentCheckpointRecord(row) : null;
  }

  async createAgentCheckpoint(
    input: CreateAgentCheckpointInput,
  ): Promise<ChainAgentCheckpointRecord> {
    const result = await auroraQuery<Row>(
      `insert into ${SCHEMA}.chain_agent_checkpoint (
         run_id, step_key, previous_step_key, mode, provider,
         model_identifier, status, input_snapshot, output,
         selected_prompt, selected_params, approved_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb,
         $10, $11::jsonb, case when $7 = 'approved' then now() else null end
       )
       on conflict (run_id, step_key) do nothing
       returning *`,
      [
        input.runId,
        input.stepKey,
        input.previousStepKey,
        input.mode,
        input.provider,
        input.modelIdentifier,
        input.status,
        jsonParam(input.inputSnapshot),
        jsonParam(input.output),
        input.selectedPrompt ?? null,
        jsonParam(input.selectedParams ?? null),
      ],
    );
    const row = result.rows[0];

    if (row) {
      return toAgentCheckpointRecord(row);
    }

    const existing = await this.getAgentCheckpointForStep(
      input.runId,
      input.stepKey,
    );

    if (!existing) {
      throw new Error('Agent checkpoint insert failed.');
    }

    return existing;
  }

  async approveAgentCheckpoint(
    input: ApproveAgentCheckpointInput,
  ): Promise<ChainAgentCheckpointRecord | null> {
    const result = await auroraQuery<Row>(
      `update ${SCHEMA}.chain_agent_checkpoint
          set status = 'approved',
              selected_prompt = $2,
              selected_params = $3::jsonb,
              approved_at = now(),
              error_code = null,
              error_message = null
        where id = $1 and status = 'suggested'
        returning *`,
      [
        input.checkpointId,
        input.selectedPrompt,
        jsonParam(input.selectedParams),
      ],
    );
    const row = result.rows[0];
    return row ? toAgentCheckpointRecord(row) : null;
  }

  async markAgentCheckpointApplied(
    checkpointId: string,
  ): Promise<ChainAgentCheckpointRecord | null> {
    const result = await auroraQuery<Row>(
      `update ${SCHEMA}.chain_agent_checkpoint
          set status = 'applied', applied_at = coalesce(applied_at, now())
        where id = $1 and status in ('approved','applied')
        returning *`,
      [checkpointId],
    );
    const row = result.rows[0];
    return row ? toAgentCheckpointRecord(row) : null;
  }

  async markAgentCheckpointFailed(
    checkpointId: string,
    input: { errorCode: string; errorMessage: string },
  ): Promise<ChainAgentCheckpointRecord | null> {
    const result = await auroraQuery<Row>(
      `update ${SCHEMA}.chain_agent_checkpoint
          set status = 'failed', error_code = $2, error_message = $3
        where id = $1 and status <> 'applied'
        returning *`,
      [checkpointId, input.errorCode, input.errorMessage],
    );
    const row = result.rows[0];
    return row ? toAgentCheckpointRecord(row) : null;
  }
}

// ----------------------------------------------------------------------------
// Step insert
// ----------------------------------------------------------------------------

async function insertSteps(
  client: PoolClient,
  runId: string,
  steps: CreateChainRunInput['steps'],
): Promise<ChainStepRecord[]> {
  const rows: ChainStepRecord[] = [];

  for (const step of steps) {
    const result = await client.query<Row>(
      `insert into ${SCHEMA}.chain_step (
         run_id, step_index, step_key, step_kind, model_identifier,
         status, depends_on, provider_order, output_files
       ) values ($1, $2, $3, $4, $5, 'queued', $6, '{}', '{}')
       returning *`,
      [
        runId,
        step.stepIndex,
        step.stepKey,
        step.stepKind,
        step.modelIdentifier,
        step.dependsOn,
      ],
    );
    rows.push(toStepRecord(result.rows[0]!));
  }

  return rows;
}

// ----------------------------------------------------------------------------
// Dynamic patch builders
// ----------------------------------------------------------------------------

type ColumnSpec = { column: string; json?: boolean };

const RUN_PATCH_COLUMNS: Record<string, ColumnSpec> = {
  callbackClaimedAt: { column: 'callback_claimed_at' },
  callbackStatus: { column: 'callback_status' },
  completedAt: { column: 'completed_at' },
  currentStepKey: { column: 'current_step_key' },
  errorCode: { column: 'error_code' },
  errorMessage: { column: 'error_message' },
  output: { column: 'output', json: true },
  status: { column: 'status' },
};

const STEP_PATCH_COLUMNS: Record<string, ColumnSpec> = {
  babyseaGenerationId: { column: 'babysea_generation_id' },
  babyseaIdempotencyReplayed: { column: 'babysea_idempotency_replayed' },
  babyseaPredictionId: { column: 'babysea_prediction_id' },
  babyseaRequestId: { column: 'babysea_request_id' },
  completedAt: { column: 'completed_at' },
  errorCode: { column: 'error_code' },
  errorMessage: { column: 'error_message' },
  outputFiles: { column: 'output_files' },
  providerMetadata: { column: 'provider_metadata', json: true },
  providerOrder: { column: 'provider_order' },
  providerUsed: { column: 'provider_used' },
  requestParams: { column: 'request_params', json: true },
  startedAt: { column: 'started_at' },
  status: { column: 'status' },
};

function buildSet(
  patch: Record<string, unknown>,
  columns: Record<string, ColumnSpec>,
  startIndex: number,
): { fragments: string[]; values: unknown[] } {
  const fragments: string[] = [];
  const values: unknown[] = [];
  let index = startIndex;

  for (const [key, spec] of Object.entries(columns)) {
    const value = patch[key];
    if (value === undefined) {
      continue;
    }

    if (spec.json) {
      fragments.push(`${spec.column} = $${index}::jsonb`);
      values.push(value === null ? null : JSON.stringify(value));
    } else {
      fragments.push(`${spec.column} = $${index}`);
      values.push(value);
    }
    index += 1;
  }

  return { fragments, values };
}

function jsonParam(value: JsonObject | null): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

// ----------------------------------------------------------------------------
// Row mappers (snake_case rows -> camelCase records)
// ----------------------------------------------------------------------------

function toRunRecord(row: Row): ChainRunRecord {
  return {
    id: row.id as string,
    apiKeyId: (row.api_key_id as string | null) ?? null,
    apiKeyPrefix: row.api_key_prefix as string,
    chainSlug: row.chain_slug as string,
    chainVersion: row.chain_version as string,
    status: row.status as ChainRunStatus,
    input: applyInputOrder(obj(row.input), objOrNull(row.input_order)),
    output: objOrNull(row.output),
    errorCode: (row.error_code as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    currentStepKey: (row.current_step_key as string | null) ?? null,
    callbackUrl: (row.callback_url as string | null) ?? null,
    callbackStatus: (row.callback_status as string | null) ?? null,
    callbackClaimedAt: isoOrNull(row.callback_claimed_at),
    clientRequestId: (row.client_request_id as string | null) ?? null,
    idempotencyKeyHash: (row.idempotency_key_hash as string | null) ?? null,
    estimate: objOrNull(row.estimate),
    metadata: obj(row.metadata),
    executionConfig: executionConfig(row.execution_config),
    byokCredentials: objOrNull(row.byok_credentials),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    completedAt: isoOrNull(row.completed_at),
  };
}

function toStepRecord(row: Row): ChainStepRecord {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    stepIndex: Number(row.step_index),
    stepKey: row.step_key as string,
    stepKind: row.step_kind as ChainStepKind,
    modelIdentifier: row.model_identifier as string,
    status: row.status as ChainStepStatus,
    dependsOn: arr(row.depends_on),
    requestParams: objOrNull(row.request_params),
    babyseaGenerationId: (row.babysea_generation_id as string | null) ?? null,
    babyseaPredictionId: (row.babysea_prediction_id as string | null) ?? null,
    babyseaRequestId: (row.babysea_request_id as string | null) ?? null,
    babyseaIdempotencyReplayed:
      (row.babysea_idempotency_replayed as boolean | null) ?? null,
    providerOrder: arr(row.provider_order),
    providerUsed: (row.provider_used as string | null) ?? null,
    outputFiles: arr(row.output_files),
    providerMetadata: objOrNull(row.provider_metadata),
    errorCode: (row.error_code as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    startedAt: isoOrNull(row.started_at),
    completedAt: isoOrNull(row.completed_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function toAgentCheckpointRecord(row: Row): ChainAgentCheckpointRecord {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    stepKey: row.step_key as string,
    previousStepKey: row.previous_step_key as string,
    mode: row.mode as 'copilot' | 'autopilot',
    provider: row.provider as 'bedrock',
    modelIdentifier: row.model_identifier as string,
    status: row.status as ChainAgentCheckpointStatus,
    inputSnapshot: obj(row.input_snapshot),
    output: obj(row.output),
    selectedPrompt: (row.selected_prompt as string | null) ?? null,
    selectedParams: objOrNull(row.selected_params),
    errorCode: (row.error_code as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    approvedAt: isoOrNull(row.approved_at),
    appliedAt: isoOrNull(row.applied_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function executionConfig(value: unknown): ChainExecutionConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { type: 'self_control' };
  }

  const config = value as Record<string, unknown>;

  if (
    config.type === 'chain_agent' &&
    (config.mode === 'copilot' || config.mode === 'autopilot') &&
    config.provider === 'bedrock' &&
    typeof config.modelIdentifier === 'string' &&
    config.modelIdentifier.length > 0
  ) {
    return {
      type: 'chain_agent',
      mode: config.mode,
      provider: 'bedrock',
      modelIdentifier: config.modelIdentifier,
    };
  }

  return { type: 'self_control' };
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function isoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}

function obj(value: unknown): JsonObject {
  return (value ?? {}) as JsonObject;
}

function objOrNull(value: unknown): JsonObject | null {
  return value === null || value === undefined ? null : (value as JsonObject);
}

function arr(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}
