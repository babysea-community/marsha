import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { GET as listChains } from '@/app/api/v1/chains/route';
import { GET as getModelSchema } from '@/app/api/v1/models/[...model]/route';
import { GET as listModels } from '@/app/api/v1/models/route';
import { assertRunAccess, MAX_JSON_BODY_BYTES, readJsonBody } from '@/lib/api';
import { assertIdempotentRunMatches } from '@/lib/chains/idempotency';
import {
  applyInputOrder,
  captureInputOrder,
  preserveInputOrder,
} from '@/lib/chains/input-order';
import { CreateRunRequestSchema } from '@/lib/chains/schemas';
import type { ApiKeyPrincipal, ChainRunRecord } from '@/lib/chains/types';

describe('API access control', () => {
  it('isolates env-key runs by key prefix', () => {
    const run = createRun({ apiKeyId: null, apiKeyPrefix: 'bchn_alpha' });
    const principal = createPrincipal({
      apiKeyId: null,
      keyPrefix: 'bchn_beta',
    });

    expect(() => assertRunAccess(run, principal)).toThrow('not found');
  });

  it('allows database keys to access their own runs', () => {
    const run = createRun({
      apiKeyId: '4a828963-4e0a-4f12-90ab-dcb0f5dc6c0e',
      apiKeyPrefix: 'bchn_db_key',
    });
    const principal = createPrincipal({
      apiKeyId: '4a828963-4e0a-4f12-90ab-dcb0f5dc6c0e',
      keyPrefix: 'bchn_other',
    });

    expect(() => assertRunAccess(run, principal)).not.toThrow();
  });
});

describe('API request validation', () => {
  it('rejects oversized JSON request bodies before parsing', async () => {
    const request = new NextRequest('https://app.test/api', {
      body: JSON.stringify({ value: 'x'.repeat(MAX_JSON_BODY_BYTES) }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    await expect(readJsonBody(request)).rejects.toMatchObject({
      code: 'payload_too_large',
      status: 413,
    });
  });

  it('rejects oversized run input and metadata objects', () => {
    const oversizedInput = CreateRunRequestSchema.safeParse({
      input: { prompt: 'x'.repeat(65 * 1024) },
      metadata: {},
    });
    const oversizedMetadata = CreateRunRequestSchema.safeParse({
      input: {},
      metadata: { trace: 'x'.repeat(17 * 1024) },
    });

    expect(oversizedInput.success).toBe(false);
    expect(oversizedMetadata.success).toBe(false);
  });

  it('rejects deeply nested run input objects', () => {
    let nested: Record<string, unknown> = { value: 'bottom' };

    for (let depth = 0; depth < 13; depth += 1) {
      nested = { nested };
    }

    const result = CreateRunRequestSchema.safeParse({
      input: nested,
      metadata: {},
    });

    expect(result.success).toBe(false);
  });

  it('preserves caller input key order after schema validation', () => {
    const rawInput = {
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
    };
    const parsedInput = {
      image_model: 'bfl/flux-1.1-pro',
      video_model: 'bytedance/seedance-1-pro-fast',
      image_model_input: {
        seed: 42,
        width: 1024,
        height: 1024,
        prompt: 'A product render',
      },
      video_model_input: {
        ratio: '16:9',
        content: [{ type: 'text', text: 'move' }],
        duration: 2,
      },
    };

    const ordered = preserveInputOrder(parsedInput, rawInput);

    expect(Object.keys(ordered)).toEqual([
      'video_model_input',
      'image_model',
      'image_model_input',
      'video_model',
    ]);
    expect(Object.keys(ordered.image_model_input as object)).toEqual([
      'prompt',
      'width',
      'height',
      'seed',
    ]);

    expect(applyInputOrder(parsedInput, captureInputOrder(rawInput))).toEqual(
      ordered,
    );
  });
});

describe('API response presentation', () => {
  it('returns chain summaries as a direct list object', async () => {
    const response = await listChains();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      object: 'list',
      has_more: false,
      url: '/api/v1/chains',
    });
    expect(body.data.map((chain: { slug: string }) => chain.slug)).toEqual([
      'chain',
    ]);
    expect(
      body.data.every(
        (chain: { object?: string }) => chain.object === 'chain_template',
      ),
    ).toBe(true);
    expect(body).not.toHaveProperty('status');
    expect(body).not.toHaveProperty('timestamp');
  });

  it('returns Semantic Lady model summaries separately from chains', async () => {
    const response = await listModels();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      object: 'list',
      has_more: false,
      url: '/api/v1/models',
    });
    expect(body.data).toContainEqual(
      expect.objectContaining({
        object: 'model',
        id: 'bfl/flux-2-max',
        provider: 'black-forest-labs',
        raw_id: 'flux-2-max',
        has_byok_schema: true,
        schema_url: '/api/v1/models/bfl/flux-2-max',
      }),
    );
    expect(body.data).toContainEqual(
      expect.objectContaining({
        id: 'bytedance/seedream-4.5',
        has_byok_schema: true,
      }),
    );
    expect(body.data).toContainEqual(
      expect.objectContaining({
        id: 'bytedance/seedance-2.0-fast',
        raw_id: 'dreamina-seedance-2-0-fast-260128',
        modes: ['byok'],
      }),
    );
    expect(body.data).toContainEqual(
      expect.objectContaining({
        id: 'qwen/image',
        provider: 'alibaba-cloud',
        raw_id: 'qwen-image',
        modes: ['babysea', 'byok'],
      }),
    );
    expect(body.data).toContainEqual(
      expect.objectContaining({
        id: 'wan/2.7-t2v',
        provider: 'alibaba-cloud',
        raw_id: 'wan2.7-t2v',
        modes: ['byok'],
      }),
    );
    expect(body.data).toContainEqual(
      expect.objectContaining({
        id: 'gpt/image-2',
        provider: 'openai',
        raw_id: 'gpt-image-2',
        modes: ['byok'],
      }),
    );
    expect(body.data).toContainEqual(
      expect.objectContaining({
        id: 'google/nano-banana-2',
        provider: 'google',
        raw_id: 'gemini-3.1-flash-image',
        modes: ['byok'],
      }),
    );
    expect(body.data).toContainEqual(
      expect.objectContaining({
        id: 'google/veo-3.1',
        provider: 'google',
        raw_id: 'veo-3.1-generate-preview',
        modes: ['byok'],
      }),
    );
  });

  it('returns Semantic Lady schema by model identifier path', async () => {
    const response = await getModelSchema(
      new Request('https://app.test/api/v1/models/bfl/flux-2-max'),
      { params: { model: ['bfl', 'flux-2-max'] } },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      object: 'model_schema',
      id: 'bfl/flux-2-max',
      provider: 'black-forest-labs',
      raw_id: 'flux-2-max',
      byok_schema: {
        source: 'semantic-lady',
        provider_model: 'flux-2-max',
        workflows: expect.arrayContaining(['image-to-image', 'text-to-image']),
      },
    });
    expect(body.byok_schema.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'generation_prompt' }),
        expect.objectContaining({ name: 'generation_width' }),
        expect.objectContaining({ name: 'generation_height' }),
        expect.objectContaining({ name: 'generation_seed' }),
        expect.objectContaining({ name: 'generation_input_image_file' }),
      ]),
    );
  });

  it('returns Semantic Lady Alibaba Cloud schemas under family-style model identifiers', async () => {
    const response = await getModelSchema(
      new Request('https://app.test/api/v1/models/qwen/image-2-pro'),
      { params: { model: ['qwen', 'image-2-pro'] } },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      object: 'model_schema',
      id: 'qwen/image-2-pro',
      provider: 'alibaba-cloud',
      raw_id: 'qwen-image-2.0-pro',
      modes: ['byok'],
      byok_schema: {
        source: 'semantic-lady',
        provider_model: 'qwen-image-2.0-pro',
      },
    });
    expect(body.byok_schema.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'generation_prompt' }),
        expect.objectContaining({ name: 'generation_size' }),
      ]),
    );

    const happyHorseResponse = await getModelSchema(
      new Request('https://app.test/api/v1/models/happyhorse/1.0-i2v'),
      { params: { model: ['happyhorse', '1.0-i2v'] } },
    );
    const happyHorseBody = await happyHorseResponse.json();

    expect(happyHorseResponse.status).toBe(200);
    expect(happyHorseBody.byok_schema.provider_model).toBe(
      'happyhorse-1.0-i2v',
    );
    expect(happyHorseBody.byok_schema.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'generation_duration' }),
        expect.objectContaining({ name: 'generation_input_image_file' }),
      ]),
    );

    const wanReferenceResponse = await getModelSchema(
      new Request('https://app.test/api/v1/models/wan/2.7-r2v'),
      { params: { model: ['wan', '2.7-r2v'] } },
    );
    const wanReferenceBody = await wanReferenceResponse.json();

    expect(wanReferenceResponse.status).toBe(200);
    expect(wanReferenceBody.byok_schema.provider_model).toBe('wan2.7-r2v');
    expect(wanReferenceBody.byok_schema.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'generation_duration' }),
        expect.objectContaining({ name: 'generation_input_image_file' }),
      ]),
    );
  });

  it('returns Runway image-to-video Semantic Lady schema', async () => {
    const response = await getModelSchema(
      new Request('https://app.test/api/v1/models/runway/gen-4-turbo'),
      { params: { model: ['runway', 'gen-4-turbo'] } },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      object: 'model_schema',
      id: 'runway/gen-4-turbo',
      provider: 'runway',
      raw_id: 'gen4_turbo',
      modes: ['byok'],
      byok_schema: {
        source: 'semantic-lady',
        provider_model: 'gen4_turbo',
      },
    });
    expect(body.byok_schema.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'generation_prompt' }),
        expect.objectContaining({ name: 'generation_aspect_ratio' }),
        expect.objectContaining({ name: 'generation_duration' }),
        expect.objectContaining({ name: 'generation_input_image_file' }),
      ]),
    );
  });

  it('returns GPT Image 2 Semantic Lady schema', async () => {
    const response = await getModelSchema(
      new Request('https://app.test/api/v1/models/gpt/image-2'),
      { params: { model: ['gpt', 'image-2'] } },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      object: 'model_schema',
      id: 'gpt/image-2',
      provider: 'openai',
      raw_id: 'gpt-image-2',
      modes: ['byok'],
      byok_schema: {
        source: 'semantic-lady',
        provider_model: 'gpt-image-2',
      },
    });
    expect(body.byok_schema.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'generation_prompt' }),
        expect.objectContaining({ name: 'generation_size' }),
        expect.objectContaining({ name: 'generation_output_format' }),
        expect.objectContaining({ name: 'generation_input_image_file' }),
      ]),
    );
  });

  it('returns Google generative media Semantic Lady schemas', async () => {
    const imageResponse = await getModelSchema(
      new Request('https://app.test/api/v1/models/google/nano-banana-2'),
      { params: { model: ['google', 'nano-banana-2'] } },
    );
    const imageBody = await imageResponse.json();

    expect(imageResponse.status).toBe(200);
    expect(imageBody).toMatchObject({
      object: 'model_schema',
      id: 'google/nano-banana-2',
      provider: 'google',
      raw_id: 'gemini-3.1-flash-image',
      byok_schema: {
        source: 'semantic-lady',
        provider_model: 'gemini-3.1-flash-image',
      },
    });

    expect(imageBody.byok_schema.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'generation_aspect_ratio' }),
        expect.objectContaining({ name: 'generation_resolution' }),
        expect.objectContaining({ name: 'generation_input_image_file' }),
      ]),
    );
    const videoResponse = await getModelSchema(
      new Request('https://app.test/api/v1/models/google/veo-3.1'),
      { params: { model: ['google', 'veo-3.1'] } },
    );
    const videoBody = await videoResponse.json();

    expect(videoResponse.status).toBe(200);
    expect(videoBody).toMatchObject({
      object: 'model_schema',
      id: 'google/veo-3.1',
      provider: 'google',
      raw_id: 'veo-3.1-generate-preview',
      byok_schema: {
        source: 'semantic-lady',
        provider_model: 'veo-3.1-generate-preview',
      },
    });
    expect(videoBody.byok_schema.fields).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'generation_negative_prompt' }),
      ]),
    );

    const fastVideoResponse = await getModelSchema(
      new Request('https://app.test/api/v1/models/google/veo-3.1-fast'),
      { params: { model: ['google', 'veo-3.1-fast'] } },
    );
    const fastVideoBody = await fastVideoResponse.json();

    expect(fastVideoResponse.status).toBe(200);
    expect(fastVideoBody).toMatchObject({
      object: 'model_schema',
      id: 'google/veo-3.1-fast',
      provider: 'google',
      raw_id: 'veo-3.1-fast-generate-preview',
      byok_schema: {
        source: 'semantic-lady',
        provider_model: 'veo-3.1-fast-generate-preview',
      },
    });
    expect(fastVideoBody.byok_schema.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'generation_duration' }),
        expect.objectContaining({ name: 'generation_resolution' }),
        expect.objectContaining({ name: 'generation_input_image_file' }),
      ]),
    );
    expect(fastVideoBody.byok_schema.fields).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'generation_negative_prompt' }),
      ]),
    );

    const liteVideoResponse = await getModelSchema(
      new Request('https://app.test/api/v1/models/google/veo-3.1-lite'),
      { params: { model: ['google', 'veo-3.1-lite'] } },
    );
    const liteVideoBody = await liteVideoResponse.json();

    expect(liteVideoResponse.status).toBe(200);
    expect(liteVideoBody.byok_schema.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'generation_duration' }),
        expect.objectContaining({ name: 'generation_resolution' }),
      ]),
    );
    expect(liteVideoBody.byok_schema.fields).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'generation_negative_prompt' }),
        expect.objectContaining({ name: 'generation_input_video_file' }),
      ]),
    );
  });
});

describe('API idempotency', () => {
  it('allows replay when the same idempotency key uses the same request fields', () => {
    const run = createRun({
      callbackUrl: 'https://api.example.com/callback',
      input: {
        video_model_input: { generation_duration: 4 },
        image_model_input: { generation_prompt: 'A product render' },
      },
      metadata: { trace: 'run-1' },
    });

    expect(() =>
      assertIdempotentRunMatches(run, {
        callbackUrl: 'https://api.example.com/callback',
        input: {
          image_model_input: { generation_prompt: 'A product render' },
          video_model_input: { generation_duration: 4 },
        },
        metadata: { trace: 'run-1' },
      }),
    ).not.toThrow();
  });

  it('rejects replay when the same idempotency key changes the request fields', () => {
    const run = createRun({
      callbackUrl: 'https://api.example.com/callback',
      input: { video_model_input: { generation_duration: 4 } },
      metadata: { trace: 'run-1' },
    });

    expect(() =>
      assertIdempotentRunMatches(run, {
        callbackUrl: 'https://api.example.com/other-callback',
        input: { video_model_input: { generation_duration: 8 } },
        metadata: { trace: 'run-2' },
      }),
    ).toThrow('Idempotency-Key was already used');
  });

  it('rejects replay when the same idempotency key changes provider mode', () => {
    const run = createRun({
      input: { video_model_input: { generation_duration: 4 } },
      metadata: { trace: 'run-1' },
    });

    expect(() =>
      assertIdempotentRunMatches(run, {
        byokProviders: ['byteplus'],
        callbackUrl: null,
        input: { video_model_input: { generation_duration: 4 } },
        metadata: { trace: 'run-1' },
        providerMode: 'byok',
      }),
    ).toThrow('Idempotency-Key was already used');
  });
});

function createPrincipal(
  overrides: Partial<ApiKeyPrincipal> = {},
): ApiKeyPrincipal {
  return {
    apiKeyId: null,
    keyPrefix: 'bchn_alpha',
    name: 'test-key',
    scopes: ['chains:run', 'chains:read', 'runs:cancel'],
    ...overrides,
  };
}

function createRun(overrides: Partial<ChainRunRecord> = {}): ChainRunRecord {
  return {
    apiKeyId: null,
    apiKeyPrefix: 'bchn_alpha',
    callbackClaimedAt: null,
    callbackStatus: null,
    callbackUrl: null,
    chainSlug: 'chain',
    chainVersion: '2026-05-23',
    clientRequestId: null,
    completedAt: null,
    createdAt: new Date().toISOString(),
    currentStepKey: null,
    errorCode: null,
    errorMessage: null,
    estimate: null,
    executionConfig: { type: 'self_control' },
    id: 'af252a34-977d-4fc5-81ac-502d2fb94421',
    idempotencyKeyHash: null,
    input: {
      image_model_input: {
        generation_prompt: 'A product render',
      },
    },
    metadata: {},
    output: null,
    status: 'queued',
    updatedAt: new Date().toISOString(),
    byokCredentials: null,
    ...overrides,
  };
}
