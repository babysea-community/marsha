import { describe, expect, it, vi } from 'vitest';

import type { ApiKeyPrincipal } from '@/lib/chains/types';

const transactionMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/database', () => ({
  dbQuery: vi.fn(),
  dbTransaction: transactionMock,
}));

import { AuroraChainStore } from '@/lib/chains/aurora-store';

describe('AuroraChainStore', () => {
  it('reconstructs caller input order after a jsonb insert/select round trip', async () => {
    transactionMock.mockImplementation(
      async (handler: (client: unknown) => unknown) =>
        handler(createFakeClient()),
    );

    const store = new AuroraChainStore();
    const record = await store.createRun({
      byokCredentials: { mode: 'server_env' },
      byokProviders: ['bfl', 'byteplus'],
      callbackUrl: null,
      chainSlug: 'chain',
      chainVersion: '2026-05-23',
      clientRequestId: null,
      estimate: null,
      executionConfig: { type: 'self_control' },
      idempotencyKeyHash: null,
      input: {
        video_model_input: {
          content: [{ type: 'text', text: 'move' }],
          ratio: '16:9',
          duration: 2,
        },
        image_model: 'bfl/flux-1.1-pro',
        image_model_input: {
          prompt: 'A product render',
          width: 1024,
          height: 1024,
          seed: 42,
        },
        video_model: 'bytedance/seedance-1-pro-fast',
      },
      metadata: {},
      principal: createPrincipal(),
      steps: [
        {
          dependsOn: [],
          modelIdentifier: 'bfl/flux-1.1-pro',
          stepIndex: 0,
          stepKey: 'image',
          stepKind: 'image',
        },
      ],
    });

    expect(Object.keys(record.run.input)).toEqual([
      'video_model_input',
      'image_model',
      'image_model_input',
      'video_model',
    ]);
    expect(Object.keys(record.run.input.image_model_input as object)).toEqual([
      'prompt',
      'width',
      'height',
      'seed',
    ]);
  });
});

function createPrincipal(): ApiKeyPrincipal {
  return {
    apiKeyId: null,
    keyPrefix: 'bchn_alpha',
    name: 'test-key',
    scopes: ['chains:run', 'chains:read'],
  };
}

/**
 * Minimal `pg` client that echoes inserted rows. The chain_run insert returns
 * the `input` jsonb with keys canonicalized (sorted) to simulate Postgres jsonb
 * reordering, plus the `input_order` sidecar, proving the store restores caller
 * order from the sidecar rather than relying on jsonb order.
 */
function createFakeClient() {
  return {
    query: async (sql: string, values: unknown[]) => {
      if (sql.includes('insert into app_private.chain_run')) {
        const executionConfig = JSON.parse(values[8] as string);
        const input = canonicalizeJsonb(JSON.parse(values[10] as string));
        const inputOrder = JSON.parse(values[11] as string);

        return {
          rows: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              api_key_id: values[0],
              api_key_prefix: values[1],
              byok_credentials: JSON.parse(values[2] as string),
              callback_url: null,
              chain_slug: values[4],
              chain_version: values[5],
              client_request_id: null,
              estimate: null,
              execution_config: executionConfig,
              idempotency_key_hash: null,
              input,
              input_order: inputOrder,
              metadata: {},
              status: 'queued',
              output: null,
              error_code: null,
              error_message: null,
              current_step_key: null,
              callback_status: null,
              callback_claimed_at: null,
              completed_at: null,
              created_at: now(),
              updated_at: now(),
            },
          ],
        };
      }

      // chain_step insert
      return {
        rows: [
          {
            id: '22222222-2222-4222-8222-222222222220',
            run_id: values[0],
            step_index: values[1],
            step_key: values[2],
            step_kind: values[3],
            model_identifier: values[4],
            status: 'queued',
            depends_on: values[5],
            request_params: null,
            babysea_generation_id: null,
            babysea_prediction_id: null,
            babysea_request_id: null,
            babysea_idempotency_replayed: null,
            provider_order: [],
            provider_used: null,
            output_files: [],
            provider_metadata: null,
            error_code: null,
            error_message: null,
            started_at: null,
            completed_at: null,
            created_at: now(),
            updated_at: now(),
          },
        ],
      };
    },
  };
}

function canonicalizeJsonb(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonb);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalizeJsonb((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function now() {
  return new Date('2026-06-08T00:00:00.000Z');
}
