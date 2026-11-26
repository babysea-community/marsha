import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBflProvider } from '@/lib/providers/bfl';
import { createBytePlusProvider } from '@/lib/providers/byteplus';
import { createAlibabaCloudProvider } from '@/lib/providers/alibabacloud';
import { createGoogleProvider } from '@/lib/providers/google';
import { createOpenAiProvider } from '@/lib/providers/openai';
import { createRunwayProvider } from '@/lib/providers/runway';
import { resolveProvider } from '@/lib/providers';
import {
  listModelCatalog,
  listRegisteredModels,
} from '@/lib/models/model-library';
import type { Provider, ProviderCancelContext } from '@/lib/providers/types';

type ProviderContractCase = {
  cancelContext?: ProviderCancelContext;
  createProvider: () => Provider;
  modelIdentifier: string;
  name: string;
  stepKind: 'image' | 'video';
};

describe('provider adapters', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('lists model catalog entries in provider order', () => {
    const providers = listModelCatalog().map((model) => model.provider);
    const providerBlocks = [...new Set(providers)];

    expect(providerBlocks).toEqual([
      'alibaba-cloud',
      'black-forest-labs',
      'byteplus',
      'google',
      'openai',
      'runway',
    ]);
  });

  it('keeps registered models on BabySea unless BYOK mode is active', () => {
    expect(
      resolveProvider('bytedance/seedream-4.5', { byokMode: false }),
    ).toEqual({
      modelIdentifier: 'bytedance/seedream-4.5',
      provider: 'babysea',
    });

    expect(
      resolveProvider('bytedance/seedream-4.5', { byokMode: true }),
    ).toEqual({
      modelIdentifier: 'byteplus/seedream-4-5-251128',
      provider: 'byteplus',
    });

    expect(() =>
      resolveProvider('byteplus/seedream-5-0-lite-260128', {
        byokMode: false,
      }),
    ).toThrow('requires server-side BYOK mode');

    expect(() =>
      resolveProvider('bytedance/seedance-2.0-fast', { byokMode: false }),
    ).toThrow('supported by the app only in server-side BYOK mode');
  });

  describe('provider adapter contract', () => {
    const providers: ProviderContractCase[] = [
      {
        cancelContext: {
          generationId: 'dashscope_task_123',
          modelIdentifier: 'alibabacloud/wan2.7-t2v',
          providerMetadata: null,
        },
        createProvider: () =>
          createAlibabaCloudProvider({ apiKey: 'dashscope_test_key' }),
        modelIdentifier: 'alibabacloud/wan2.7-t2v',
        name: 'alibabacloud',
        stepKind: 'video',
      },
      {
        cancelContext: {
          generationId: 'bfl_task_123',
          modelIdentifier: 'bfl/flux-pro-1.1',
          providerMetadata: null,
        },
        createProvider: () => createBflProvider({ apiKey: 'bfl_test_key' }),
        modelIdentifier: 'bfl/flux-pro-1.1',
        name: 'bfl',
        stepKind: 'image',
      },
      {
        cancelContext: {
          generationId: 'byteplus_sync_image',
          modelIdentifier: 'byteplus/seedream-4-5-251128',
          providerMetadata: { kind: 'sync_image' },
        },
        createProvider: () =>
          createBytePlusProvider({ apiKey: 'byteplus_test_key' }),
        modelIdentifier: 'byteplus/seedream-4-5-251128',
        name: 'byteplus',
        stepKind: 'image',
      },
      {
        cancelContext: {
          generationId: 'openai_sync_image',
          modelIdentifier: resolveProvider('gpt/image-2', { byokMode: true })
            .modelIdentifier,
          providerMetadata: { kind: 'sync_image' },
        },
        createProvider: () =>
          createOpenAiProvider({ apiKey: 'openai_test_key' }),
        modelIdentifier: resolveProvider('gpt/image-2', { byokMode: true })
          .modelIdentifier,
        name: 'openai',
        stepKind: 'image',
      },
      {
        cancelContext: {
          generationId: 'google_sync_image',
          modelIdentifier: resolveProvider('google/nano-banana', {
            byokMode: true,
          }).modelIdentifier,
          providerMetadata: { kind: 'gemini_image' },
        },
        createProvider: () =>
          createGoogleProvider({ apiKey: 'gemini_test_key' }),
        modelIdentifier: resolveProvider('google/nano-banana', {
          byokMode: true,
        }).modelIdentifier,
        name: 'google',
        stepKind: 'image',
      },
      {
        cancelContext: {
          generationId: 'runway_task_123',
          modelIdentifier: 'runway/gen4_turbo',
          providerMetadata: { task_id: 'runway_task_123' },
        },
        createProvider: () =>
          createRunwayProvider({
            apiKey: 'runway_test_key',
            fetchImpl: vi.fn(
              async () => new Response(null, { status: 204 }),
            ) as typeof fetch,
          }),
        modelIdentifier: 'runway/gen4_turbo',
        name: 'runway',
        stepKind: 'video',
      },
    ];

    it.each(providers)(
      'returns a zero-cost estimate for $name',
      async (item) => {
        const provider = item.createProvider();
        const estimate = await provider.estimate({
          modelIdentifier: item.modelIdentifier,
          options: { count: 2 },
          stepKind: item.stepKind,
        });

        expect(estimate).toMatchObject({
          assets_count: 2,
          cost_per_generation: 0,
          cost_total_consumed: 0,
          credit_balance: null,
          credit_balance_can_afford: null,
          credit_balance_max_affordable: null,
          model_identifier: item.modelIdentifier,
          model_type: item.stepKind,
        });
      },
    );

    it.each(providers)(
      'accepts best-effort cancel contexts for $name',
      async (item) => {
        const provider = item.createProvider();

        await expect(
          provider.cancel(
            item.cancelContext ?? {
              generationId: 'generation_123',
              modelIdentifier: item.modelIdentifier,
              providerMetadata: null,
            },
          ),
        ).resolves.toBeUndefined();
      },
    );
  });

  it('accepts provider identifiers only when they exist in the catalog', () => {
    expect(
      resolveProvider('byteplus/seedream-5-0-lite-260128', {
        byokMode: true,
      }),
    ).toEqual({
      modelIdentifier: 'byteplus/seedream-5-0-lite-260128',
      provider: 'byteplus',
    });

    expect(resolveProvider('bfl/flux-pro-1.1', { byokMode: true })).toEqual({
      modelIdentifier: 'bfl/flux-pro-1.1',
      provider: 'bfl',
    });

    expect(
      resolveProvider('alibaba-cloud/wan2.7-t2v', { byokMode: true }),
    ).toEqual({
      modelIdentifier: 'alibabacloud/wan2.7-t2v',
      provider: 'alibabacloud',
    });

    expect(resolveProvider('runway/aleph2', { byokMode: true })).toEqual({
      modelIdentifier: 'runway/aleph2',
      provider: 'runway',
    });

    expect(
      resolveProvider('google/gemini-3.1-flash-image', { byokMode: true }),
    ).toEqual({
      modelIdentifier: 'google/gemini-3.1-flash-image',
      provider: 'google',
    });

    expect(() =>
      resolveProvider('byteplus/seedream-3-0-t2i-250415', {
        byokMode: true,
      }),
    ).toThrow('Semantic Lady model catalog');

    expect(() =>
      resolveProvider('bfl/not-in-raw-schema', { byokMode: true }),
    ).toThrow('Semantic Lady model catalog');

    expect(() =>
      resolveProvider('alibaba-cloud/not-in-raw-schema', { byokMode: true }),
    ).toThrow('Semantic Lady model catalog');

    expect(() =>
      resolveProvider('runway/not-in-raw-schema', { byokMode: true }),
    ).toThrow('Semantic Lady model catalog');

    // Act Two is temporarily removed from the catalog, so its provider-native
    // identifier no longer routes.
    expect(() => resolveProvider('runway/act_two', { byokMode: true })).toThrow(
      'Semantic Lady model catalog',
    );

    expect(() =>
      resolveProvider('google/not-in-raw-schema', { byokMode: true }),
    ).toThrow('Semantic Lady model catalog');

    expect(() =>
      resolveProvider('openai/not-in-raw-schema', { byokMode: true }),
    ).toThrow('Semantic Lady model catalog');

    expect(() =>
      resolveProvider('alibaba-cloud/wan2.6-t2v', { byokMode: true }),
    ).toThrow('Semantic Lady model catalog');
  });

  it('rejects public model identifiers outside the Semantic Lady catalog', () => {
    expect(() =>
      resolveProvider('bytedance/seedream-3', { byokMode: false }),
    ).toThrow('Semantic Lady model catalog');

    expect(() =>
      resolveProvider('bytedance/seedream-3', { byokMode: true }),
    ).toThrow('Semantic Lady model catalog');

    expect(() =>
      resolveProvider('openai/not-in-raw-schema', { byokMode: false }),
    ).toThrow('Semantic Lady model catalog');

    expect(() =>
      resolveProvider('wan/2.5-t2i-preview', { byokMode: true }),
    ).toThrow('Semantic Lady model catalog');
  });

  it('routes every registered BytePlus model through BYOK when enabled', () => {
    const bytePlusRoutes = [
      ['bytedance/seedream-4', 'byteplus/seedream-4-0-250828'],
      ['bytedance/seedream-4.5', 'byteplus/seedream-4-5-251128'],
      ['bytedance/seedream-5-lite', 'byteplus/seedream-5-0-lite-260128'],
      ['bytedance/seedance-1-pro', 'byteplus/seedance-1-0-pro-250528'],
      [
        'bytedance/seedance-1-pro-fast',
        'byteplus/seedance-1-0-pro-fast-251015',
      ],
      ['bytedance/seedance-1.5-pro', 'byteplus/seedance-1-5-pro-251215'],
      ['bytedance/seedance-2.0', 'byteplus/dreamina-seedance-2-0-260128'],
      [
        'bytedance/seedance-2.0-fast',
        'byteplus/dreamina-seedance-2-0-fast-260128',
      ],
    ] as const;

    for (const [publicName, providerName] of bytePlusRoutes) {
      expect(resolveProvider(publicName, { byokMode: true })).toEqual({
        modelIdentifier: providerName,
        provider: 'byteplus',
      });
    }

    const registeredBytePlusModels = listRegisteredModels()
      .filter((model) => model.startsWith('bytedance/'))
      .sort();
    const expectedBytePlusModels = bytePlusRoutes
      .map(([publicName]) => publicName)
      .sort();

    expect(registeredBytePlusModels).toEqual(expectedBytePlusModels);
  });

  it('routes every registered Runway model through BYOK when enabled', () => {
    const runwayRoutes = [
      ['runway/aleph-2', 'runway/aleph2'],
      ['runway/gen-4.5', 'runway/gen4.5'],
      ['runway/gen-4-aleph', 'runway/gen4_aleph'],
      ['runway/gen-4-image', 'runway/gen4_image'],
      ['runway/gen-4-image-turbo', 'runway/gen4_image_turbo'],
      ['runway/gen-4-turbo', 'runway/gen4_turbo'],
    ] as const;

    for (const [publicName, providerName] of runwayRoutes) {
      expect(resolveProvider(publicName, { byokMode: true })).toEqual({
        modelIdentifier: providerName,
        provider: 'runway',
      });
    }

    const registeredRunwayModels = listRegisteredModels()
      .filter((model) => model.startsWith('runway/'))
      .sort();
    const expectedRunwayModels = runwayRoutes
      .map(([publicName]) => publicName)
      .sort();

    expect(registeredRunwayModels).toEqual(expectedRunwayModels);
  });

  it('routes every registered Google model through BYOK when enabled', () => {
    const googleRoutes = [
      ['google/imagen-4', 'google/imagen-4.0-generate-001'],
      ['google/imagen-4-fast', 'google/imagen-4.0-fast-generate-001'],
      ['google/imagen-4-ultra', 'google/imagen-4.0-ultra-generate-001'],
      ['google/nano-banana', 'google/gemini-2.5-flash-image'],
      ['google/nano-banana-2', 'google/gemini-3.1-flash-image'],
      ['google/nano-banana-pro', 'google/gemini-3-pro-image'],
      ['google/veo-3.1', 'google/veo-3.1-generate-preview'],
      ['google/veo-3.1-fast', 'google/veo-3.1-fast-generate-preview'],
      ['google/veo-3.1-lite', 'google/veo-3.1-lite-generate-preview'],
    ] as const;

    for (const [publicName, providerName] of googleRoutes) {
      expect(resolveProvider(publicName, { byokMode: true })).toEqual({
        modelIdentifier: providerName,
        provider: 'google',
      });
    }

    const registeredGoogleModels = listRegisteredModels()
      .filter((model) => model.startsWith('google/'))
      .sort();
    const expectedGoogleModels = googleRoutes
      .map(([publicName]) => publicName)
      .sort();

    expect(registeredGoogleModels).toEqual(expectedGoogleModels);
  });

  it('routes only GPT Image 2 through OpenAI BYOK when enabled', () => {
    const resolution = resolveProvider('gpt/image-2', { byokMode: true });

    expect(resolution.provider).toBe('openai');
    expect(resolution.modelIdentifier.endsWith('/gpt-image-2')).toBe(true);

    expect(() => resolveProvider('gpt/image-1.5', { byokMode: true })).toThrow(
      'Semantic Lady model catalog',
    );

    const registeredOpenAiModels = listRegisteredModels()
      .filter((model) => model.startsWith('gpt/'))
      .sort();

    expect(registeredOpenAiModels).toEqual(['gpt/image-2']);
  });

  it('routes Alibaba Cloud models with BabySea-style family names', () => {
    expect(resolveProvider('qwen/image', { byokMode: false })).toEqual({
      modelIdentifier: 'qwen/image',
      provider: 'babysea',
    });

    expect(resolveProvider('qwen/image', { byokMode: true })).toEqual({
      modelIdentifier: 'alibabacloud/qwen-image',
      provider: 'alibabacloud',
    });

    expect(resolveProvider('qwen/image-2-pro', { byokMode: true })).toEqual({
      modelIdentifier: 'alibabacloud/qwen-image-2.0-pro',
      provider: 'alibabacloud',
    });

    expect(resolveProvider('wan/2.7-t2v', { byokMode: true })).toEqual({
      modelIdentifier: 'alibabacloud/wan2.7-t2v',
      provider: 'alibabacloud',
    });

    expect(() => resolveProvider('wan/2.7-t2v', { byokMode: false })).toThrow(
      'supported by the app only in server-side BYOK mode',
    );

    const alibabaCloudModels = listModelCatalog().filter(
      (model) => model.provider === 'alibaba-cloud',
    );
    const alibabaCloudModelIds = alibabaCloudModels.map(
      (model) => model.modelIdentifier,
    );

    expect(
      alibabaCloudModels.some((model) =>
        model.modelIdentifier.startsWith('alibabacloud/'),
      ),
    ).toBe(false);
    expect(alibabaCloudModelIds).toHaveLength(23);
    expect(alibabaCloudModelIds).toContain('qwen/image');
    expect(alibabaCloudModelIds).toContain('qwen/image-plus');
    expect(alibabaCloudModelIds).toEqual(
      expect.arrayContaining([
        'qwen/image',
        'qwen/image-plus',
        'qwen/image-2-pro',
        'qwen/image-edit-plus',
        'z/image-turbo',
        'wan/2.7-image-pro',
        'wan/2.7-t2v',
        'wan/2.1-imageedit',
        'happyhorse/1.0-t2v',
      ]),
    );

    for (const oldProtocolModel of [
      'wan/2.5-t2i-preview',
      'wan/2.2-t2i-flash',
      'wan/2.6-t2v',
      'wan/2.6-t2v-us',
      'wan/2.5-t2v-preview',
      'wan/2.2-t2v-plus',
      'wan/2.1-t2v-turbo',
      'wan/2.1-t2v-plus',
    ]) {
      expect(alibabaCloudModelIds).not.toContain(oldProtocolModel);
    }

    for (const model of alibabaCloudModels) {
      expect(
        resolveProvider(model.modelIdentifier, { byokMode: true }),
      ).toEqual({
        modelIdentifier: `alibabacloud/${model.rawId}`,
        provider: 'alibabacloud',
      });

      expect(
        resolveProvider(`alibaba-cloud/${model.rawId}`, { byokMode: true }),
      ).toEqual({
        modelIdentifier: `alibabacloud/${model.rawId}`,
        provider: 'alibabacloud',
      });
    }
  });

  it('supports provider routes for every Alibaba Cloud catalog model', async () => {
    const alibabaCloudModels = listModelCatalog().filter(
      (model) => model.provider === 'alibaba-cloud',
    );
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          request_id: 'dashscope_request_123',
          output: {
            task_id: 'dashscope_task_123',
            choices: [
              {
                message: {
                  content: [
                    { image: 'https://cdn.example.com/qwen-output.png' },
                  ],
                },
              },
            ],
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = createAlibabaCloudProvider({
      apiKey: 'dashscope_test_key',
      fetchImpl,
    });

    for (const model of alibabaCloudModels) {
      await expect(
        provider.submit({
          idempotencyKey: `idem_${model.key}`,
          modelIdentifier: `alibabacloud/${model.rawId}`,
          params: { generation_prompt: 'A catalog route smoke test' },
          stepKind: model.kind,
        }),
      ).resolves.toEqual(
        expect.objectContaining({ providerOrder: ['alibabacloud'] }),
      );
    }
  });

  it('allows new BytePlus registered models to use account endpoint overrides', async () => {
    vi.stubEnv('BYTEPLUS_ENDPOINT_BYTEDANCE_SEEDANCE_20_FAST', 'ep_fast_20');

    expect(
      resolveProvider('bytedance/seedance-2.0-fast', { byokMode: true }),
    ).toEqual({
      modelIdentifier: 'byteplus/ep_fast_20',
      provider: 'byteplus',
    });

    expect(() =>
      resolveProvider('bytedance/seedance-2.0-fast', { byokMode: false }),
    ).toThrow('supported by the app only in server-side BYOK mode');
  });

  describe('alibaba cloud image sizes', () => {
    async function submittedSize(model: string, size: string) {
      let body: Record<string, unknown> | null = null;
      const fetchImpl = vi.fn(async (_url: string | URL | Request, init) => {
        body = JSON.parse(String((init as RequestInit | undefined)?.body));
        return new Response(JSON.stringify({ request_id: 'req_1' }), {
          status: 200,
        });
      }) as unknown as typeof fetch;

      const provider = createAlibabaCloudProvider({
        apiKey: 'dashscope_test_key',
        fetchImpl,
      });
      // The stub response carries no output URLs, so sync routes reject it
      // after the request body (the part under test) has been captured.
      await provider
        .submit({
          idempotencyKey: 'idem_size',
          modelIdentifier: `alibabacloud/${model}`,
          params: { generation_prompt: 'a red apple', generation_size: size },
          stepKind: 'image',
        })
        .catch(() => undefined);

      const parameters = (body as Record<string, unknown> | null)
        ?.parameters as Record<string, unknown> | undefined;
      return parameters?.size;
    }

    it('passes explicit Semantic Lady size fields through to DashScope', async () => {
      expect(await submittedSize('qwen-image-plus', '1664*928')).toBe(
        '1664*928',
      );
      expect(await submittedSize('qwen-image-max', '2048*1152')).toBe(
        '2048*1152',
      );
      expect(await submittedSize('wan2.7-image', '3536*1168')).toBe(
        '3536*1168',
      );
    });
  });

  describe('chain handoff media role', () => {
    async function submittedFirstMediaType(params: Record<string, unknown>) {
      let body: { input?: { media?: Array<{ type?: string }> } } | null = null;
      const fetchImpl = vi.fn(async (_url: string | URL | Request, init) => {
        body = JSON.parse(String((init as RequestInit | undefined)?.body));
        return new Response(JSON.stringify({ request_id: 'req_ref' }), {
          status: 200,
        });
      }) as unknown as typeof fetch;

      const provider = createAlibabaCloudProvider({
        apiKey: 'dashscope_test_key',
        fetchImpl,
      });

      // The stub omits output URLs, so the async route rejects after the
      // request body (the part under test) has already been captured.
      await provider
        .submit({
          idempotencyKey: 'idem_ref',
          modelIdentifier: 'alibabacloud/wan2.7-i2v-2026-04-25',
          params: { generation_prompt: 'animate the portrait', ...params },
          stepKind: 'video',
        })
        .catch(() => undefined);

      return (body as { input?: { media?: Array<{ type?: string }> } } | null)
        ?.input?.media?.[0]?.type;
    }

    it('pins the auto chain handoff image as the first frame by default', async () => {
      expect(
        await submittedFirstMediaType({
          generation_input_file: ['https://cdn.example.com/previous.png'],
        }),
      ).toBe('first_frame');
    });

    it('pins a caller-provided first image as the first frame', async () => {
      expect(
        await submittedFirstMediaType({
          generation_input_image_file: ['https://cdn.example.com/start.png'],
        }),
      ).toBe('first_frame');
    });
  });

  it('normalizes BFL jpg output format to jpeg', async () => {
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init) => {
      submittedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({
          id: 'bfl_task_123',
          polling_url: 'https://api.bfl.ai/v1/get_result?id=bfl_task_123',
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const provider = createBflProvider({ apiKey: 'bfl_test_key', fetchImpl });

    await provider.submit({
      idempotencyKey: 'idem_bfl',
      modelIdentifier: 'bfl/flux-2-pro',
      params: {
        generation_output_format: 'jpg',
        generation_prompt: 'A clean product render',
      },
      stepKind: 'image',
    });

    expect(submittedBody.output_format).toBe('jpeg');
  });

  it('passes BFL Semantic Lady width and height fields directly', async () => {
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init) => {
      submittedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({
          id: 'bfl_task_123',
          polling_url: 'https://api.bfl.ai/v1/get_result?id=bfl_task_123',
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const provider = createBflProvider({ apiKey: 'bfl_test_key', fetchImpl });

    await provider.submit({
      idempotencyKey: 'idem_bfl_size',
      modelIdentifier: 'bfl/flux-2-pro',
      params: {
        generation_prompt: 'A clean product render',
        generation_height: 1600,
        generation_width: 2848,
      },
      stepKind: 'image',
    });

    expect(submittedBody).toMatchObject({
      height: 1600,
      width: 2848,
    });
    expect(submittedBody).not.toHaveProperty('aspect_ratio');
    expect(submittedBody).not.toHaveProperty('resolution');
    expect(submittedBody).not.toHaveProperty('size');
  });

  it('snaps off-grid FLUX 1.x width/height to the nearest multiple of 32', async () => {
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init) => {
      submittedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({
          id: 'bfl_task_123',
          polling_url: 'https://api.bfl.ai/v1/get_result?id=bfl_task_123',
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const provider = createBflProvider({ apiKey: 'bfl_test_key', fetchImpl });

    await provider.submit({
      idempotencyKey: 'idem_bfl_snap',
      modelIdentifier: 'bfl/flux-1.1-pro',
      params: {
        generation_prompt: 'A clean product render',
        generation_width: 1152,
        generation_height: 720,
      },
      stepKind: 'image',
    });

    // FLUX 1.x [pro] rejects a height of 720 with a 422 (not a multiple of 32);
    // it snaps up to 736. 1152 is already a multiple of 32 and is unchanged.
    expect(submittedBody).toMatchObject({ width: 1152, height: 736 });
  });

  it('leaves FLUX 2 width/height untouched (no multiple-of-32 grid)', async () => {
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init) => {
      submittedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({
          id: 'bfl_task_123',
          polling_url: 'https://api.bfl.ai/v1/get_result?id=bfl_task_123',
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const provider = createBflProvider({ apiKey: 'bfl_test_key', fetchImpl });

    await provider.submit({
      idempotencyKey: 'idem_bfl_flux2_nosnap',
      modelIdentifier: 'bfl/flux-2-pro',
      params: {
        generation_prompt: 'A clean product render',
        generation_width: 1000,
        generation_height: 1000,
      },
      stepKind: 'image',
    });

    // FLUX 2 only requires >= 64 with no multiple-of-32 step, so off-grid
    // dimensions pass through unchanged.
    expect(submittedBody).toMatchObject({ width: 1000, height: 1000 });
  });

  it('does not synthesize BFL dimensions from generation_size', async () => {
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init) => {
      submittedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({
          id: 'bfl_task_123',
          polling_url: 'https://api.bfl.ai/v1/get_result?id=bfl_task_123',
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const provider = createBflProvider({ apiKey: 'bfl_test_key', fetchImpl });

    await provider.submit({
      idempotencyKey: 'idem_bfl_explicit_size',
      modelIdentifier: 'bfl/flux-2-pro',
      params: {
        generation_prompt: 'A clean product render',
        generation_size: '1024x1024',
      },
      stepKind: 'image',
    });

    expect(submittedBody).not.toHaveProperty('height');
    expect(submittedBody).not.toHaveProperty('width');
    expect(submittedBody).not.toHaveProperty('size');
  });

  it('keeps BFL Ultra aspect-ratio driven without width or height fields', async () => {
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init) => {
      submittedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({
          id: 'bfl_task_123',
          polling_url: 'https://api.bfl.ai/v1/get_result?id=bfl_task_123',
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const provider = createBflProvider({ apiKey: 'bfl_test_key', fetchImpl });

    await provider.submit({
      idempotencyKey: 'idem_bfl_ultra',
      modelIdentifier: 'bfl/flux-1.1-pro-ultra',
      params: {
        generation_prompt: 'A clean product render',
        generation_aspect_ratio: '21:9',
      },
      stepKind: 'image',
    });

    expect(submittedBody.aspect_ratio).toBe('21:9');
    expect(submittedBody).not.toHaveProperty('height');
    expect(submittedBody).not.toHaveProperty('width');
  });

  it('maps Flux 2 chained images to documented BFL input_image fields', async () => {
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init) => {
      submittedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({
          id: 'bfl_task_123',
          polling_url: 'https://api.bfl.ai/v1/get_result?id=bfl_task_123',
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const provider = createBflProvider({ apiKey: 'bfl_test_key', fetchImpl });

    await provider.submit({
      idempotencyKey: 'idem_bfl',
      modelIdentifier: 'bfl/flux-2-max',
      params: {
        generation_prompt: 'Enhance this product render',
        generation_input_image_file: [
          'https://cdn.example.com/input-a.png',
          'https://cdn.example.com/input-b.png',
        ],
      },
      stepKind: 'image',
    });

    expect(submittedBody.input_image).toBe(
      'https://cdn.example.com/input-a.png',
    );
    expect(submittedBody.input_image_2).toBe(
      'https://cdn.example.com/input-b.png',
    );
    expect(submittedBody).not.toHaveProperty('input_images');
    expect(submittedBody).not.toHaveProperty('images');
  });

  it('maps provider-generated data URL images to BFL base64 input fields', async () => {
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init) => {
      submittedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({
          id: 'bfl_task_123',
          polling_url: 'https://api.bfl.ai/v1/get_result?id=bfl_task_123',
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const provider = createBflProvider({ apiKey: 'bfl_test_key', fetchImpl });

    await provider.submit({
      idempotencyKey: 'idem_bfl_data_url',
      modelIdentifier: 'bfl/flux-2-pro',
      params: {
        generation_prompt: 'Enhance this generated image',
        generation_input_file: ['data:image/png;base64,aW1hZ2U='],
      },
      stepKind: 'image',
    });

    expect(submittedBody.input_image).toBe('aW1hZ2U=');
  });

  it('caps Flux 2 Klein chained images at four documented inputs', async () => {
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init) => {
      submittedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({
          id: 'bfl_task_123',
          polling_url: 'https://api.bfl.ai/v1/get_result?id=bfl_task_123',
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const provider = createBflProvider({ apiKey: 'bfl_test_key', fetchImpl });

    await provider.submit({
      idempotencyKey: 'idem_bfl',
      modelIdentifier: 'bfl/flux-2-klein-9b',
      params: {
        generation_prompt: 'Enhance this product render',
        generation_input_file: [
          'https://cdn.example.com/input-1.png',
          'https://cdn.example.com/input-2.png',
          'https://cdn.example.com/input-3.png',
          'https://cdn.example.com/input-4.png',
          'https://cdn.example.com/input-5.png',
        ],
      },
      stepKind: 'image',
    });

    expect(submittedBody.input_image).toBe(
      'https://cdn.example.com/input-1.png',
    );
    expect(submittedBody.input_image_4).toBe(
      'https://cdn.example.com/input-4.png',
    );
    expect(submittedBody).not.toHaveProperty('input_image_5');
  });

  it('rejects nested BFL endpoint paths', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}')) as typeof fetch;
    const provider = createBflProvider({ apiKey: 'bfl_test_key', fetchImpl });

    await expect(
      provider.submit({
        idempotencyKey: 'idem_bfl',
        modelIdentifier: 'bfl/../flux-2-pro',
        params: {
          prompt: 'A clean product render',
        },
        stepKind: 'image',
      }),
    ).rejects.toThrow('BFL endpoint slug contains invalid characters.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('normalizes BytePlus jpg output format to jpeg', async () => {
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init) => {
      submittedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({
          data: [{ url: 'https://cdn.example.com/output.jpeg' }],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const provider = createBytePlusProvider({
      apiKey: 'byteplus_test_key',
      fetchImpl,
    });

    await provider.submit({
      idempotencyKey: 'idem_byteplus',
      modelIdentifier: 'byteplus/seedream-5-0-lite-260128',
      params: {
        generation_output_format: 'jpg',
        generation_prompt: 'A clean product render',
      },
      stepKind: 'image',
    });

    expect(submittedBody.output_format).toBe('jpeg');
  });

  it('maps BytePlus chained images to singular image arrays and keeps the resolved model', async () => {
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init) => {
      submittedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({
          data: [{ url: 'https://cdn.example.com/output.jpeg' }],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const provider = createBytePlusProvider({
      apiKey: 'byteplus_test_key',
      fetchImpl,
    });

    await provider.submit({
      idempotencyKey: 'idem_byteplus_multi_image',
      modelIdentifier: 'byteplus/seedream-4-5-251128',
      params: {
        callback_url: 'https://callbacks.example.com/provider',
        generation_callback_url: 'https://callbacks.example.com/generated',
        generation_input_file: [
          'https://cdn.example.com/input-a.png',
          'https://cdn.example.com/input-b.png',
        ],
        generation_model: 'untrusted-generation-model',
        generation_prompt: 'Refine these inputs.',
        generation_size: '2560x1440',
        model: 'untrusted-model',
      },
      stepKind: 'image',
    });

    expect(submittedBody.model).toBe('seedream-4-5-251128');
    expect(submittedBody.image).toEqual([
      'https://cdn.example.com/input-a.png',
      'https://cdn.example.com/input-b.png',
    ]);
    expect(submittedBody.size).toBe('2560x1440');
    expect(submittedBody).not.toHaveProperty('images');
    expect(submittedBody).not.toHaveProperty('callback_url');
    expect(submittedBody).not.toHaveProperty('generation_callback_url');
  });

  it('rejects BytePlus sync image responses with only blank output URLs', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ url: '   ' }] }), {
          status: 200,
        }),
    ) as typeof fetch;
    const provider = createBytePlusProvider({
      apiKey: 'byteplus_test_key',
      fetchImpl,
    });

    await expect(
      provider.submit({
        idempotencyKey: 'idem_byteplus_blank_image',
        modelIdentifier: 'byteplus/seedream-4-5-251128',
        params: { generation_prompt: 'A product render' },
        stepKind: 'image',
      }),
    ).rejects.toThrow('BytePlus image response contained no URLs.');
  });

  it('rejects BytePlus image b64_json responses before submit', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}')) as typeof fetch;
    const provider = createBytePlusProvider({
      apiKey: 'byteplus_test_key',
      fetchImpl,
    });

    await expect(
      provider.submit({
        idempotencyKey: 'idem_byteplus',
        modelIdentifier: 'byteplus/seedream-5-0-lite-260128',
        params: {
          generation_prompt: 'A clean product render',
          generation_response_format: 'b64_json',
        },
        stepKind: 'image',
      }),
    ).rejects.toThrow('response_format must be "url"');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('merges BytePlus prompt content with chained first and last frames', async () => {
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init) => {
      submittedBody = JSON.parse(String(init?.body));

      return new Response(JSON.stringify({ id: 'byteplus_task_123' }), {
        status: 200,
      });
    }) as typeof fetch;

    const provider = createBytePlusProvider({
      apiKey: 'byteplus_test_key',
      fetchImpl,
    });

    await provider.submit({
      idempotencyKey: 'idem_byteplus',
      modelIdentifier: 'byteplus/seedance-1-0-pro-250528',
      params: {
        generation_output_format: 'mp4',
        generation_prompt: 'Do not duplicate this prompt.',
        generation_input_file: ['https://cdn.example.com/first.png'],
        generation_last_frame: 'https://cdn.example.com/last.png',
        model: 'untrusted-model',
        output_format: 'mp4',
      },
      stepKind: 'video',
    });

    expect(submittedBody.model).toBe('seedance-1-0-pro-250528');
    expect(submittedBody.content).toEqual([
      { type: 'text', text: 'Do not duplicate this prompt.' },
      {
        type: 'image_url',
        image_url: { url: 'https://cdn.example.com/first.png' },
        role: 'first_frame',
      },
      {
        type: 'image_url',
        image_url: { url: 'https://cdn.example.com/last.png' },
        role: 'last_frame',
      },
    ]);
    expect(submittedBody).not.toHaveProperty('callback_url');
    expect(submittedBody).not.toHaveProperty('output_format');
  });

  it('maps BytePlus multimodal normalized media to documented reference roles', async () => {
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init) => {
      submittedBody = JSON.parse(String(init?.body));

      return new Response(JSON.stringify({ id: 'byteplus_task_roles' }), {
        status: 200,
      });
    }) as typeof fetch;

    const provider = createBytePlusProvider({
      apiKey: 'byteplus_test_key',
      fetchImpl,
    });

    await provider.submit({
      idempotencyKey: 'idem_byteplus_roles',
      modelIdentifier: 'byteplus/dreamina-seedance-2-0-260128',
      params: {
        generation_input_audio_file: ['https://cdn.example.com/dialogue.wav'],
        generation_input_file: [
          'https://cdn.example.com/reference.png',
          'https://cdn.example.com/source.mp4',
        ],
        generation_media_role: 'reference_image',
        generation_prompt: 'Restyle this source video.',
      },
      stepKind: 'video',
    });

    expect(submittedBody.content).toEqual([
      { type: 'text', text: 'Restyle this source video.' },
      {
        type: 'video_url',
        video_url: { url: 'https://cdn.example.com/source.mp4' },
        role: 'reference_video',
      },
      {
        type: 'image_url',
        image_url: { url: 'https://cdn.example.com/reference.png' },
        role: 'reference_image',
      },
      {
        type: 'audio_url',
        audio_url: { url: 'https://cdn.example.com/dialogue.wav' },
        role: 'reference_audio',
      },
    ]);
    expect(submittedBody).not.toHaveProperty('input_audio_file');
    expect(submittedBody).not.toHaveProperty('media_role');
  });

  it('honors explicit BytePlus media roles for canonical image inputs', async () => {
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init) => {
      submittedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({ id: 'byteplus_task_role_override' }),
        {
          status: 200,
        },
      );
    }) as typeof fetch;

    const provider = createBytePlusProvider({
      apiKey: 'byteplus_test_key',
      fetchImpl,
    });

    await provider.submit({
      idempotencyKey: 'idem_byteplus_role_override',
      modelIdentifier: 'byteplus/dreamina-seedance-2-0-260128',
      params: {
        generation_input_image_file: ['https://cdn.example.com/style.png'],
        generation_last_frame: 'https://cdn.example.com/end.png',
        generation_media_role: 'reference_image',
        generation_prompt: 'Use this as a visual reference.',
      },
      stepKind: 'video',
    });

    expect(submittedBody.content).toEqual([
      { type: 'text', text: 'Use this as a visual reference.' },
      {
        type: 'image_url',
        image_url: { url: 'https://cdn.example.com/style.png' },
        role: 'reference_image',
      },
      {
        type: 'image_url',
        image_url: { url: 'https://cdn.example.com/end.png' },
        role: 'last_frame',
      },
    ]);
  });

  it('keeps BytePlus last-frame URLs in metadata instead of output files', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            completed_at: 1_800_000_000,
            content: {
              last_frame_url: 'https://cdn.example.com/last-frame.png',
              video_url: 'https://cdn.example.com/output.mp4',
            },
            id: 'byteplus_task_123',
            status: 'succeeded',
          }),
          { status: 200 },
        ),
    ) as typeof fetch;

    const provider = createBytePlusProvider({
      apiKey: 'byteplus_test_key',
      fetchImpl,
    });

    const status = await provider.poll({
      generationId: 'byteplus_task_123',
      modelIdentifier: 'byteplus/seedance-1-0-pro-250528',
      providerMetadata: {
        kind: 'video_task',
        task_id: 'byteplus_task_123',
      },
    });

    expect(status).toMatchObject({
      generation_output_file: ['https://cdn.example.com/output.mp4'],
      generation_status: 'succeeded',
      provider_metadata: {
        last_frame_url: 'https://cdn.example.com/last-frame.png',
      },
    });
  });

  it('fails BytePlus succeeded video tasks that have no output URLs', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: { last_frame_url: 'https://cdn.example.com/last.png' },
            id: 'byteplus_task_empty',
            status: 'succeeded',
          }),
          { status: 200 },
        ),
    ) as typeof fetch;

    const provider = createBytePlusProvider({
      apiKey: 'byteplus_test_key',
      fetchImpl,
    });

    const status = await provider.poll({
      generationId: 'byteplus_task_empty',
      modelIdentifier: 'byteplus/seedance-1-0-pro-250528',
      providerMetadata: {
        kind: 'video_task',
        task_id: 'byteplus_task_empty',
      },
    });

    expect(status).toMatchObject({
      generation_error_code: 'provider_unexpected_response',
      generation_status: 'failed',
      provider_metadata: {
        last_frame_url: 'https://cdn.example.com/last.png',
      },
    });
  });

  it('fails BytePlus succeeded video tasks that only have blank output URLs', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: {
              image_url: '',
              last_frame_url: 'https://cdn.example.com/last.png',
              video_url: '   ',
            },
            id: 'byteplus_task_blank_outputs',
            status: 'succeeded',
          }),
          { status: 200 },
        ),
    ) as typeof fetch;

    const provider = createBytePlusProvider({
      apiKey: 'byteplus_test_key',
      fetchImpl,
    });

    const status = await provider.poll({
      generationId: 'byteplus_task_blank_outputs',
      modelIdentifier: 'byteplus/seedance-1-0-pro-250528',
      providerMetadata: {
        kind: 'video_task',
        task_id: 'byteplus_task_blank_outputs',
      },
    });

    expect(status).toMatchObject({
      generation_error_code: 'provider_unexpected_response',
      generation_status: 'failed',
      provider_metadata: {
        last_frame_url: 'https://cdn.example.com/last.png',
      },
    });
  });

  it('submits Alibaba Cloud sync image models with multimodal content', async () => {
    let submittedUrl = '';
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (url: string | URL | Request, init) => {
      submittedUrl = String(url);
      submittedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({
          request_id: 'dashscope_request_123',
          output: {
            choices: [
              {
                message: {
                  content: [
                    { image: 'https://cdn.example.com/qwen-output.png' },
                  ],
                },
              },
            ],
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const provider = createAlibabaCloudProvider({
      apiKey: 'dashscope_test_key',
      fetchImpl,
    });

    const result = await provider.submit({
      idempotencyKey: 'idem_alibaba_sync',
      modelIdentifier: 'alibabacloud/qwen-image-plus',
      params: {
        generation_prompt: 'A clean product render',
        generation_input_file: ['https://cdn.example.com/source.png'],
        generation_size: '1664*928',
        generation_output_number: 1,
      },
      stepKind: 'image',
    });

    expect(submittedUrl).toContain('/multimodal-generation/generation');
    expect(submittedBody).toMatchObject({
      model: 'qwen-image-plus',
      input: {
        messages: [
          {
            role: 'user',
            content: [
              { text: 'A clean product render' },
              { image: 'https://cdn.example.com/source.png' },
            ],
          },
        ],
      },
      parameters: {
        n: 1,
        size: '1664*928',
      },
    });
    expect(result).toMatchObject({
      kind: 'completed',
      outputFiles: ['https://cdn.example.com/qwen-output.png'],
      providerUsed: 'alibabacloud',
    });
  });

  it('submits Alibaba Cloud async image-to-image models with task headers', async () => {
    let submittedUrl = '';
    let submittedHeaders: HeadersInit | undefined;
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (url: string | URL | Request, init) => {
      submittedUrl = String(url);
      submittedHeaders = init?.headers;
      submittedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({
          output: { task_id: 'dashscope_task_image_123' },
          request_id: 'dashscope_request_123',
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const provider = createAlibabaCloudProvider({
      apiKey: 'dashscope_test_key',
      fetchImpl,
    });

    const result = await provider.submit({
      idempotencyKey: 'idem_alibaba_image',
      modelIdentifier: 'alibabacloud/wan2.5-i2i-preview',
      params: {
        input: {},
        generation_input_file: ['https://cdn.example.com/source.png'],
      },
      stepKind: 'image',
    });

    expect(submittedUrl).toContain('/image2image/image-synthesis');
    expect(submittedHeaders).toMatchObject({ 'x-dashscope-async': 'enable' });
    expect(submittedBody).toMatchObject({
      model: 'wan2.5-i2i-preview',
      input: {
        images: ['https://cdn.example.com/source.png'],
      },
    });
    expect(result).toMatchObject({
      kind: 'async',
      generationId: 'dashscope_task_image_123',
      providerOrder: ['alibabacloud'],
    });
  });

  it('submits Alibaba Cloud animate image-to-video models to the image2video endpoint', async () => {
    for (const rawModel of ['wan2.2-animate-mix', 'wan2.2-animate-move']) {
      let submittedUrl = '';
      let submittedHeaders: HeadersInit | undefined;
      let submittedBody: Record<string, unknown> = {};
      const fetchImpl = vi.fn(async (url: string | URL | Request, init) => {
        submittedUrl = String(url);
        submittedHeaders = init?.headers;
        submittedBody = JSON.parse(String(init?.body));

        return new Response(
          JSON.stringify({
            output: { task_id: `dashscope_task_${rawModel}` },
            request_id: 'dashscope_request_123',
          }),
          { status: 200 },
        );
      }) as typeof fetch;

      const provider = createAlibabaCloudProvider({
        apiKey: 'dashscope_test_key',
        fetchImpl,
      });

      const result = await provider.submit({
        idempotencyKey: `idem_alibaba_${rawModel}`,
        modelIdentifier: `alibabacloud/${rawModel}`,
        params: {
          generation_input_file: [
            'https://cdn.example.com/source.png',
            'https://cdn.example.com/reference.mp4',
          ],
          generation_mode: 'wan-std',
        },
        stepKind: 'video',
      });

      expect(submittedUrl).toContain('/image2video/video-synthesis');
      expect(submittedHeaders).toMatchObject({
        'x-dashscope-async': 'enable',
      });
      expect(submittedBody).toEqual({
        model: rawModel,
        input: {
          image_url: 'https://cdn.example.com/source.png',
          video_url: 'https://cdn.example.com/reference.mp4',
        },
        parameters: { mode: 'wan-std' },
      });
      expect(result).toMatchObject({
        kind: 'async',
        generationId: `dashscope_task_${rawModel}`,
        providerOrder: ['alibabacloud'],
      });
    }
  });

  it('submits Alibaba Cloud video-edit models with chained video media', async () => {
    let submittedUrl = '';
    let submittedHeaders: HeadersInit | undefined;
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (url: string | URL | Request, init) => {
      submittedUrl = String(url);
      submittedHeaders = init?.headers;
      submittedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({
          output: { task_id: 'dashscope_videoedit_task_123' },
          request_id: 'dashscope_request_123',
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = createAlibabaCloudProvider({
      apiKey: 'dashscope_test_key',
      fetchImpl,
    });

    const result = await provider.submit({
      idempotencyKey: 'idem_alibaba_videoedit',
      modelIdentifier: 'alibabacloud/wan2.7-videoedit',
      params: {
        generation_input_image_file: ['https://cdn.example.com/style.png'],
        generation_input_file: ['https://cdn.example.com/source-video.mp4'],
        generation_audio: 'origin',
        generation_duration: 0,
        generation_prompt: 'Polish the generated product video.',
        generation_watermark: false,
      },
      stepKind: 'video',
    });

    expect(submittedUrl).toContain('/video-generation/video-synthesis');
    expect(submittedHeaders).toMatchObject({
      'x-dashscope-async': 'enable',
    });
    expect(submittedBody).toEqual({
      model: 'wan2.7-videoedit',
      input: {
        prompt: 'Polish the generated product video.',
        media: [
          {
            type: 'video',
            url: 'https://cdn.example.com/source-video.mp4',
          },
          {
            type: 'reference_image',
            url: 'https://cdn.example.com/style.png',
          },
        ],
      },
      parameters: {
        audio_setting: 'origin',
        duration: 0,
        watermark: false,
      },
    });
    expect(result).toMatchObject({
      kind: 'async',
      generationId: 'dashscope_videoedit_task_123',
      providerOrder: ['alibabacloud'],
    });
  });

  it('maps Alibaba Cloud canonical R2V media and negative prompt fields', async () => {
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init) => {
      submittedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({
          output: { task_id: 'dashscope_r2v_task_123' },
          request_id: 'dashscope_request_123',
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = createAlibabaCloudProvider({
      apiKey: 'dashscope_test_key',
      fetchImpl,
    });

    await provider.submit({
      idempotencyKey: 'idem_alibaba_r2v',
      modelIdentifier: 'alibabacloud/wan2.7-r2v',
      params: {
        generation_prompt_extend: true,
        generation_input_image_file: ['https://cdn.example.com/ref.png'],
        generation_input_video_file: ['https://cdn.example.com/ref.mp4'],
        generation_negative_prompt: 'No text overlays',
        generation_prompt: 'Combine the reference subjects.',
        generation_aspect_ratio: '16:9',
        generation_reference_voice_file: 'https://cdn.example.com/voice.wav',
      },
      stepKind: 'video',
    });

    expect(submittedBody).toMatchObject({
      model: 'wan2.7-r2v',
      input: {
        prompt: 'Combine the reference subjects.',
        negative_prompt: 'No text overlays',
        media: [
          {
            type: 'reference_image',
            url: 'https://cdn.example.com/ref.png',
          },
          {
            type: 'reference_video',
            url: 'https://cdn.example.com/ref.mp4',
            reference_voice: 'https://cdn.example.com/voice.wav',
          },
        ],
      },
      parameters: {
        prompt_extend: true,
        ratio: '16:9',
      },
    });
  });

  it('submits Runway video-to-video tasks with the previous video output', async () => {
    let submittedUrl = '';
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (url: string | URL | Request, init) => {
      submittedUrl = String(url);
      submittedBody = JSON.parse(String(init?.body));

      return new Response(JSON.stringify({ id: 'runway_task_v2v_123' }), {
        status: 200,
      });
    }) as typeof fetch;
    const provider = createRunwayProvider({
      apiKey: 'runway_test_key',
      fetchImpl,
    });

    const result = await provider.submit({
      idempotencyKey: 'idem_runway_v2v',
      modelIdentifier: 'runway/gen4_aleph',
      params: {
        generation_input_file: ['https://cdn.example.com/video.mp4'],
        generation_prompt: 'Add a dramatic camera move',
      },
      stepKind: 'video',
    });

    expect(submittedUrl).toContain('/v1/video_to_video');
    expect(submittedBody).toMatchObject({
      model: 'gen4_aleph',
      promptText: 'Add a dramatic camera move',
      videoUri: 'https://cdn.example.com/video.mp4',
    });
    expect(submittedBody).not.toHaveProperty('promptImage');
    expect(result).toMatchObject({
      generationId: 'runway_task_v2v_123',
      kind: 'async',
      providerOrder: ['runway'],
    });
  });

  it('submits Runway image-to-video tasks with documented request fields', async () => {
    let submittedUrl = '';
    let submittedHeaders: HeadersInit | undefined;
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (url: string | URL | Request, init) => {
      submittedUrl = String(url);
      submittedHeaders = init?.headers;
      submittedBody = JSON.parse(String(init?.body));

      return new Response(JSON.stringify({ id: 'runway_task_i2v_123' }), {
        status: 200,
      });
    }) as typeof fetch;
    const provider = createRunwayProvider({
      apiKey: 'runway_test_key',
      fetchImpl,
    });

    const result = await provider.submit({
      idempotencyKey: 'idem_runway_i2v',
      modelIdentifier: 'runway/gen4_turbo',
      params: {
        generation_duration: 7,
        generation_input_file: ['https://cdn.example.com/image.png'],
        generation_prompt: 'Animate the generated image',
        generation_aspect_ratio: '1584:672',
      },
      stepKind: 'video',
    });

    expect(submittedUrl).toContain('/v1/image_to_video');
    expect(submittedHeaders).toMatchObject({
      authorization: 'Bearer runway_test_key',
      'x-runway-version': '2024-11-06',
    });
    expect(submittedBody).toMatchObject({
      duration: 7,
      model: 'gen4_turbo',
      promptImage: 'https://cdn.example.com/image.png',
      promptText: 'Animate the generated image',
      ratio: '1584:672',
    });
    expect(result).toMatchObject({
      generationId: 'runway_task_i2v_123',
      kind: 'async',
      providerOrder: ['runway'],
    });
  });

  it('keeps Runway Aleph models on video-to-video request fields', async () => {
    let submittedUrl = '';
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (url: string | URL | Request, init) => {
      submittedUrl = String(url);
      submittedBody = JSON.parse(String(init?.body));

      return new Response(JSON.stringify({ id: 'runway_task_aleph_v2v' }), {
        status: 200,
      });
    }) as typeof fetch;
    const provider = createRunwayProvider({
      apiKey: 'runway_test_key',
      fetchImpl,
    });

    await provider.submit({
      idempotencyKey: 'idem_runway_aleph_v2v',
      modelIdentifier: 'runway/aleph2',
      params: {
        generation_input_file: ['https://cdn.example.com/video.mp4'],
        generation_input_image_file: ['https://cdn.example.com/reference.png'],
        generation_prompt: 'Re-style the generated video',
        generation_aspect_ratio: '1280:720',
      },
      stepKey: 'modify',
      stepKind: 'video',
    });

    expect(submittedUrl).toContain('/v1/video_to_video');
    expect(submittedBody).toMatchObject({
      model: 'aleph2',
      promptText: 'Re-style the generated video',
      videoUri: 'https://cdn.example.com/video.mp4',
    });
    expect(submittedBody).not.toHaveProperty('promptImage');
  });

  it('submits GPT Image 2 generations with documented request fields', async () => {
    let submittedUrl = '';
    let submittedHeaders: HeadersInit | undefined;
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (url: string | URL | Request, init) => {
      submittedUrl = String(url);
      submittedHeaders = init?.headers;
      submittedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({
          data: [
            {
              b64_json: 'b3BlbmFpLWltYWdl',
              revised_prompt: 'A sharper product image',
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = createOpenAiProvider({
      apiKey: 'openai_test_key',
      fetchImpl,
    });
    const resolution = resolveProvider('gpt/image-2', { byokMode: true });

    const result = await provider.submit({
      idempotencyKey: 'idem_openai_image',
      modelIdentifier: resolution.modelIdentifier,
      params: {
        generation_output_format: 'webp',
        generation_output_number: 1,
        generation_prompt: 'A clean product image',
        generation_size: '1024x1024',
        generation_quality: 'high',
      },
      stepKind: 'image',
    });

    expect(submittedUrl).toBe('https://api.openai.com/v1/images/generations');
    expect(submittedHeaders).toMatchObject({
      authorization: 'Bearer openai_test_key',
    });
    expect(submittedBody).toMatchObject({
      model: 'gpt-image-2',
      n: 1,
      output_format: 'webp',
      prompt: 'A clean product image',
      quality: 'high',
      size: '1024x1024',
    });
    expect(result).toMatchObject({
      generationId: 'openai_idem_openai_image',
      kind: 'completed',
      outputFiles: ['data:image/webp;base64,b3BlbmFpLWltYWdl'],
      providerOrder: ['openai'],
      providerUsed: 'openai',
    });
  });

  it('classifies permanent OpenAI quota 429s as non-retryable', async () => {
    const quotaBody = JSON.stringify({
      error: {
        message:
          'Request too large for gpt-image-2 (for limit gpt-image) in organization org-x on input-images per min: Limit 0, Requested 1. You can increase your rate limit by adding a payment method to your account.',
        code: 'rate_limit_exceeded',
      },
    });
    const fetchImpl = vi.fn(
      async () => new Response(quotaBody, { status: 429 }),
    ) as typeof fetch;
    const provider = createOpenAiProvider({
      apiKey: 'openai_test_key',
      fetchImpl,
    });
    const quotaResolution = resolveProvider('gpt/image-2', { byokMode: true });

    await expect(
      provider.submit({
        idempotencyKey: 'idem_openai_quota',
        modelIdentifier: quotaResolution.modelIdentifier,
        params: { generation_prompt: 'A clean product image' },
        stepKind: 'image',
      }),
    ).rejects.toMatchObject({ code: 'provider_quota_exceeded' });

    const transientBody = JSON.stringify({
      error: { message: 'Rate limit reached, retry after 2s.' },
    });
    const transientFetch = vi.fn(
      async () => new Response(transientBody, { status: 429 }),
    ) as typeof fetch;
    const transientProvider = createOpenAiProvider({
      apiKey: 'openai_test_key',
      fetchImpl: transientFetch,
    });
    const transientResolution = resolveProvider('gpt/image-2', {
      byokMode: true,
    });

    await expect(
      transientProvider.submit({
        idempotencyKey: 'idem_openai_rate',
        modelIdentifier: transientResolution.modelIdentifier,
        params: { generation_prompt: 'A clean product image' },
        stepKind: 'image',
      }),
    ).rejects.toMatchObject({ code: 'provider_rate_limited' });
  });

  it('submits GPT Image 2 edits when the app supplies image input', async () => {
    let submittedUrl = '';
    let submittedHeaders: HeadersInit | undefined;
    let submittedBody: BodyInit | null | undefined;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init) => {
      submittedUrl = String(url);
      submittedHeaders = init?.headers;
      submittedBody = init?.body;

      return new Response(
        JSON.stringify({
          data: [
            {
              b64_json: 'ZWRpdGVkLWltYWdl',
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = createOpenAiProvider({
      apiKey: 'openai_test_key',
      fetchImpl,
    });
    const resolution = resolveProvider('gpt/image-2', { byokMode: true });

    const result = await provider.submit({
      idempotencyKey: 'idem_openai_edit',
      modelIdentifier: resolution.modelIdentifier,
      params: {
        generation_input_file: ['data:image/png;base64,aW1hZ2U='],
        generation_output_format: 'png',
        generation_prompt: 'Refine this generated frame',
      },
      stepKind: 'image',
    });

    expect(submittedUrl).toBe('https://api.openai.com/v1/images/edits');
    expect(submittedHeaders).toMatchObject({
      authorization: 'Bearer openai_test_key',
    });
    expect(submittedHeaders).not.toHaveProperty('content-type');
    expect(submittedBody).toBeInstanceOf(FormData);
    const form = submittedBody as FormData;
    expect(form.get('model')).toBe('gpt-image-2');
    expect(form.get('prompt')).toBe('Refine this generated frame');
    expect(form.get('input_fidelity')).toBeNull();
    expect(form.getAll('image[]')).toHaveLength(1);
    expect(result).toMatchObject({
      generationId: 'openai_idem_openai_edit',
      kind: 'completed',
      outputFiles: ['data:image/png;base64,ZWRpdGVkLWltYWdl'],
      providerUsed: 'openai',
    });
  });

  it('maps GPT Image 2 generation_mask_file to the multipart mask field', async () => {
    let submittedBody: BodyInit | null | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init) => {
      submittedBody = init?.body;

      return new Response(
        JSON.stringify({ data: [{ b64_json: 'bWFza2VkLWltYWdl' }] }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = createOpenAiProvider({
      apiKey: 'openai_test_key',
      fetchImpl,
    });
    const resolution = resolveProvider('gpt/image-2', { byokMode: true });

    await provider.submit({
      idempotencyKey: 'idem_openai_mask',
      modelIdentifier: resolution.modelIdentifier,
      params: {
        generation_input_image_file: ['data:image/png;base64,aW1hZ2U='],
        generation_mask_file: 'data:image/png;base64,bWFzaw==',
        generation_prompt: 'Replace the masked area.',
      },
      stepKind: 'image',
    });

    expect(submittedBody).toBeInstanceOf(FormData);
    const form = submittedBody as FormData;
    expect(form.get('mask')).toBeInstanceOf(File);
    expect(form.get('mask_file')).toBeNull();
  });

  it('submits GPT Image 2 edits with canonical image data URL input', async () => {
    let submittedBody: BodyInit | null | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init) => {
      submittedBody = init?.body;

      return new Response(
        JSON.stringify({ data: [{ b64_json: 'cmF3LWVkaXQ=' }] }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = createOpenAiProvider({
      apiKey: 'openai_test_key',
      fetchImpl,
    });

    await provider.submit({
      idempotencyKey: 'idem_openai_raw_edit',
      modelIdentifier: resolveProvider('gpt/image-2', { byokMode: true })
        .modelIdentifier,
      params: {
        generation_input_image_file: ['data:image/png;base64,aW1hZ2U='],
        generation_prompt: 'Refine this image',
      },
      stepKind: 'image',
    });

    const form = submittedBody as FormData;
    expect(form.get('prompt')).toBe('Refine this image');
    expect(form.getAll('image[]')).toHaveLength(1);
  });

  it('downloads HTTPS GPT Image 2 edit inputs through network guards', async () => {
    let submittedBody: BodyInit | null | undefined;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init) => {
      if (String(url) === 'https://8.8.8.8/source.png') {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: {
            'content-length': '3',
            'content-type': 'image/png',
          },
        });
      }

      submittedBody = init?.body;

      return new Response(
        JSON.stringify({ data: [{ b64_json: 'aHR0cHMtZWRpdA==' }] }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = createOpenAiProvider({
      apiKey: 'openai_test_key',
      fetchImpl,
    });

    await provider.submit({
      idempotencyKey: 'idem_openai_https_edit',
      modelIdentifier: resolveProvider('gpt/image-2', { byokMode: true })
        .modelIdentifier,
      params: {
        generation_input_image_file: ['https://8.8.8.8/source.png'],
        generation_prompt: 'Refine this image',
      },
      stepKind: 'image',
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://8.8.8.8/source.png',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(submittedBody).toBeInstanceOf(FormData);
  });

  it('rejects blocked GPT Image 2 edit input hosts before download', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}')) as typeof fetch;
    const provider = createOpenAiProvider({
      apiKey: 'openai_test_key',
      fetchImpl,
    });

    await expect(
      provider.submit({
        idempotencyKey: 'idem_openai_blocked_edit',
        modelIdentifier: resolveProvider('gpt/image-2', { byokMode: true })
          .modelIdentifier,
        params: {
          generation_input_image_file: ['https://127.0.0.1/source.png'],
          generation_prompt: 'Refine this image',
        },
        stepKind: 'image',
      }),
    ).rejects.toThrow('resolves to a blocked address');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects malformed GPT Image 2 edit input URLs as provider params', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}')) as typeof fetch;
    const provider = createOpenAiProvider({
      apiKey: 'openai_test_key',
      fetchImpl,
    });

    await expect(
      provider.submit({
        idempotencyKey: 'idem_openai_malformed_edit',
        modelIdentifier: resolveProvider('gpt/image-2', { byokMode: true })
          .modelIdentifier,
        params: {
          generation_input_image_file: ['not-a-url'],
          generation_prompt: 'Refine this image',
        },
        stepKind: 'image',
      }),
    ).rejects.toMatchObject({ code: 'invalid_provider_params' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects malformed GPT Image 2 edit input arrays', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}')) as typeof fetch;
    const provider = createOpenAiProvider({
      apiKey: 'openai_test_key',
      fetchImpl,
    });

    await expect(
      provider.submit({
        idempotencyKey: 'idem_openai_malformed_array_edit',
        modelIdentifier: resolveProvider('gpt/image-2', { byokMode: true })
          .modelIdentifier,
        params: {
          generation_input_image_file: [123],
          generation_prompt: 'Refine this image',
        },
        stepKind: 'image',
      }),
    ).rejects.toMatchObject({ code: 'invalid_provider_params' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects malformed GPT Image 2 edit mask arrays', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}')) as typeof fetch;
    const provider = createOpenAiProvider({
      apiKey: 'openai_test_key',
      fetchImpl,
    });

    await expect(
      provider.submit({
        idempotencyKey: 'idem_openai_malformed_mask_edit',
        modelIdentifier: resolveProvider('gpt/image-2', { byokMode: true })
          .modelIdentifier,
        params: {
          generation_input_image_file: ['data:image/png;base64,aW1hZ2U='],
          generation_mask_file: ['data:image/png;base64,bWFzaw=='],
          generation_prompt: 'Refine this image',
        },
        stepKind: 'image',
      }),
    ).rejects.toMatchObject({ code: 'invalid_provider_params' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects invalid GPT Image 2 edit input data URLs before submit', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}')) as typeof fetch;
    const provider = createOpenAiProvider({
      apiKey: 'openai_test_key',
      fetchImpl,
    });

    await expect(
      provider.submit({
        idempotencyKey: 'idem_openai_invalid_data_url_edit',
        modelIdentifier: resolveProvider('gpt/image-2', { byokMode: true })
          .modelIdentifier,
        params: {
          generation_input_image_file: ['data:image/png;base64,@@@='],
          generation_prompt: 'Refine this image',
        },
        stepKind: 'image',
      }),
    ).rejects.toMatchObject({ code: 'invalid_provider_params' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects redirected GPT Image 2 edit input downloads', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === 'https://8.8.8.8/redirect.png') {
        return new Response(null, {
          status: 302,
          headers: {
            location: 'http://127.0.0.1/private.png',
          },
        });
      }

      return new Response('{}');
    }) as typeof fetch;
    const provider = createOpenAiProvider({
      apiKey: 'openai_test_key',
      fetchImpl,
    });

    await expect(
      provider.submit({
        idempotencyKey: 'idem_openai_redirect_edit',
        modelIdentifier: resolveProvider('gpt/image-2', { byokMode: true })
          .modelIdentifier,
        params: {
          generation_input_image_file: ['https://8.8.8.8/redirect.png'],
          generation_prompt: 'Refine this image',
        },
        stepKind: 'image',
      }),
    ).rejects.toThrow('redirects are not allowed');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized streamed GPT Image 2 edit inputs before submit', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === 'https://8.8.8.8/large.png') {
        const chunk = new Uint8Array(1024 * 1024);
        return new Response(
          new ReadableStream({
            start(controller) {
              for (let index = 0; index < 51; index += 1) {
                controller.enqueue(chunk);
              }
              controller.close();
            },
          }),
          {
            status: 200,
            headers: {
              'content-length': '1',
              'content-type': 'image/png',
            },
          },
        );
      }

      return new Response('{}');
    }) as typeof fetch;
    const provider = createOpenAiProvider({
      apiKey: 'openai_test_key',
      fetchImpl,
    });

    await expect(
      provider.submit({
        idempotencyKey: 'idem_openai_large_edit',
        modelIdentifier: resolveProvider('gpt/image-2', { byokMode: true })
          .modelIdentifier,
        params: {
          generation_input_image_file: ['https://8.8.8.8/large.png'],
          generation_prompt: 'Refine this image',
        },
        stepKind: 'image',
      }),
    ).rejects.toThrow('exceeds');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('submits Google Nano Banana image generations with generateContent fields', async () => {
    let submittedUrl = '';
    let submittedHeaders: HeadersInit | undefined;
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (url: string | URL | Request, init) => {
      submittedUrl = String(url);
      submittedHeaders = init?.headers;
      submittedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      data: 'Z29vZ2xlLWltYWdl',
                      mimeType: 'image/png',
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = createGoogleProvider({
      apiKey: 'gemini_test_key',
      fetchImpl,
    });
    const resolution = resolveProvider('google/nano-banana-2', {
      byokMode: true,
    });

    const result = await provider.submit({
      idempotencyKey: 'idem_google_image',
      modelIdentifier: resolution.modelIdentifier,
      params: {
        generation_prompt: 'A clean product image',
        generation_input_file: ['data:image/png;base64,aW5wdXQ='],
        generation_aspect_ratio: '1:8',
        generation_resolution: '4K',
      },
      stepKind: 'image',
    });

    expect(submittedUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent',
    );
    expect(submittedHeaders).toMatchObject({
      'x-goog-api-key': 'gemini_test_key',
    });
    expect(submittedBody).toMatchObject({
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'A clean product image' },
            {
              inlineData: {
                mimeType: 'image/png',
                data: 'aW5wdXQ=',
              },
            },
          ],
        },
      ],
      generationConfig: { responseModalities: ['IMAGE'] },
    });
    expect(submittedBody.generationConfig).toEqual({
      imageConfig: {
        aspectRatio: '1:8',
        imageSize: '4K',
      },
      responseModalities: ['IMAGE'],
    });
    expect(result).toMatchObject({
      generationId: 'google_idem_google_image',
      kind: 'completed',
      outputFiles: ['data:image/png;base64,Z29vZ2xlLWltYWdl'],
      providerOrder: ['google'],
      providerUsed: 'google',
    });
  });

  it('submits Google Nano Banana Pro canonical fields', async () => {
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init) => {
      submittedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      data: 'cmF3LWdvb2dsZS1pbWFnZQ==',
                      mimeType: 'image/webp',
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = createGoogleProvider({
      apiKey: 'gemini_test_key',
      fetchImpl,
    });
    const resolution = resolveProvider('google/nano-banana-pro', {
      byokMode: true,
    });

    const result = await provider.submit({
      idempotencyKey: 'idem_google_raw_image',
      modelIdentifier: resolution.modelIdentifier,
      params: {
        generation_aspect_ratio: '1:1',
        generation_prompt: 'Render this Google request.',
        generation_resolution: '2K',
      },
      stepKind: 'image',
    });

    expect(submittedBody).toMatchObject({
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Render this Google request.' }],
        },
      ],
      generationConfig: {
        imageConfig: { aspectRatio: '1:1', imageSize: '2K' },
        responseModalities: ['IMAGE'],
      },
    });
    expect(result).toMatchObject({
      generationId: 'google_idem_google_raw_image',
      outputFiles: ['data:image/webp;base64,cmF3LWdvb2dsZS1pbWFnZQ=='],
    });
  });

  it('submits Google Imagen generations with documented request fields', async () => {
    let submittedUrl = '';
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (url: string | URL | Request, init) => {
      submittedUrl = String(url);
      submittedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({
          predictions: [
            {
              bytesBase64Encoded: 'aW1hZ2VuLWltYWdl',
              mimeType: 'image/png',
            },
            {
              bytesBase64Encoded: 'aW1hZ2VuLXNlY29uZA==',
              mimeType: 'image/png',
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = createGoogleProvider({
      apiKey: 'gemini_test_key',
      fetchImpl,
    });
    const resolution = resolveProvider('google/imagen-4', { byokMode: true });

    const result = await provider.submit({
      idempotencyKey: 'idem_google_imagen',
      modelIdentifier: resolution.modelIdentifier,
      params: {
        generation_output_number: 2,
        generation_prompt: 'A clean product image',
        generation_aspect_ratio: '16:9',
        generation_resolution: '2K',
      },
      stepKind: 'image',
    });

    expect(submittedUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict',
    );
    expect(submittedBody).toEqual({
      instances: [{ prompt: 'A clean product image' }],
      parameters: {
        aspectRatio: '16:9',
        imageSize: '2K',
        sampleCount: 2,
      },
    });
    expect(result).toMatchObject({
      generationId: 'google_idem_google_imagen',
      kind: 'completed',
      outputFiles: [
        'data:image/png;base64,aW1hZ2VuLWltYWdl',
        'data:image/png;base64,aW1hZ2VuLXNlY29uZA==',
      ],
      providerOrder: ['google'],
      providerUsed: 'google',
    });
  });

  it('submits and polls Google Veo video operations', async () => {
    let submittedUrl = '';
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (url: string | URL | Request, init) => {
      if (String(url).includes('/operations/')) {
        return new Response(
          JSON.stringify({
            done: true,
            response: {
              generateVideoResponse: {
                generatedSamples: [
                  {
                    video: {
                      uri: 'https://generativelanguage.googleapis.com/v1beta/files/video-output',
                    },
                  },
                ],
              },
            },
          }),
          { status: 200 },
        );
      }

      if (String(url).includes('/files/video-output')) {
        return new Response('google-video-bytes', {
          status: 200,
          headers: { 'content-type': 'video/mp4' },
        });
      }

      submittedUrl = String(url);
      submittedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({ name: 'operations/google_video_123' }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = createGoogleProvider({
      apiKey: 'gemini_test_key',
      fetchImpl,
    });
    const resolution = resolveProvider('google/veo-3.1', { byokMode: true });

    const submitted = await provider.submit({
      idempotencyKey: 'idem_google_video',
      modelIdentifier: resolution.modelIdentifier,
      params: {
        generation_duration: 8,
        generation_audio: false,
        generation_input_file: ['data:image/png;base64,aW1hZ2U='],
        generation_prompt: 'Slow product camera orbit',
        generation_aspect_ratio: '9:16',
        generation_resolution: '1080p',
        generation_seed: 1234,
      },
      stepKind: 'video',
    });

    expect(submittedUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning',
    );
    expect(submittedBody).toMatchObject({
      instances: [
        {
          prompt: 'Slow product camera orbit',
          image: {
            bytesBase64Encoded: 'aW1hZ2U=',
            mimeType: 'image/png',
          },
        },
      ],
      parameters: {
        aspectRatio: '9:16',
        durationSeconds: 8,
        resolution: '1080p',
        seed: 1234,
      },
    });
    expect(submittedBody.parameters).not.toHaveProperty('generateAudio');
    expect(submittedBody.parameters).not.toHaveProperty('negativePrompt');
    expect(submittedBody.parameters).not.toHaveProperty('numberOfVideos');
    expect(submitted).toMatchObject({
      kind: 'async',
      generationId: 'operations/google_video_123',
      providerOrder: ['google'],
    });

    const polled = await provider.poll({
      generationId: 'operations/google_video_123',
      modelIdentifier: resolution.modelIdentifier,
      providerMetadata:
        submitted.kind === 'async'
          ? (submitted.providerMetadata ?? null)
          : null,
    });

    expect(polled).toMatchObject({
      generation_status: 'succeeded',
      generation_provider_used: 'google',
      generation_output_file: [
        'data:video/mp4;base64,Z29vZ2xlLXZpZGVvLWJ5dGVz',
      ],
    });
  });

  it('surfaces Google Veo Responsible AI filter reasons when no video is returned', async () => {
    const filterReason =
      "Veo could not generate this video because it violates Google's Responsible AI policy on depicting real people.";
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('/operations/')) {
        return new Response(
          JSON.stringify({
            done: true,
            response: {
              generateVideoResponse: {
                raiMediaFilteredCount: 1,
                raiMediaFilteredReasons: [filterReason],
              },
            },
          }),
          { status: 200 },
        );
      }

      throw new Error(`Unexpected request: ${String(url)}`);
    }) as typeof fetch;
    const provider = createGoogleProvider({
      apiKey: 'gemini_test_key',
      fetchImpl,
    });
    const resolution = resolveProvider('google/veo-3.1', { byokMode: true });

    const polled = await provider.poll({
      generationId: 'operations/google_video_filtered',
      modelIdentifier: resolution.modelIdentifier,
      providerMetadata: null,
    });

    expect(polled).toMatchObject({
      generation_status: 'failed',
      generation_provider_used: 'google',
      generation_error_code: 'provider_content_filtered',
      generation_error: expect.stringContaining('Responsible AI policy'),
      provider_metadata: {
        rai_media_filtered_reasons: [filterReason],
      },
    });
  });

  it('does not send unsupported negative prompts to Google Veo 3.1 models', async () => {
    const submittedBodies: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init) => {
      submittedBodies.push(
        JSON.parse(String(init?.body)) as Record<string, unknown>,
      );

      return new Response(
        JSON.stringify({
          name: `operations/google_video_${submittedBodies.length}`,
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = createGoogleProvider({
      apiKey: 'gemini_test_key',
      fetchImpl,
    });
    for (const modelIdentifier of [
      'google/veo-3.1',
      'google/veo-3.1-fast',
      'google/veo-3.1-lite',
    ]) {
      const resolution = resolveProvider(modelIdentifier, { byokMode: true });

      await provider.submit({
        idempotencyKey: `idem_${modelIdentifier.replaceAll('/', '_')}`,
        modelIdentifier: resolution.modelIdentifier,
        params: {
          generation_aspect_ratio: '16:9',
          generation_duration: 8,
          generation_negative_prompt: 'No text overlays',
          generation_prompt: 'Slow product camera orbit',
          generation_resolution: '720p',
          generation_seed: 1234,
        },
        stepKind: 'video',
      });
    }

    expect(submittedBodies).toHaveLength(3);
    for (const submittedBody of submittedBodies) {
      expect(submittedBody.parameters).toMatchObject({
        aspectRatio: '16:9',
        durationSeconds: 8,
        resolution: '720p',
        seed: 1234,
      });
      expect(submittedBody.parameters).not.toHaveProperty('negativePrompt');
    }
  });

  it('downloads HTTPS Veo image handoffs and inlines them as bytes', async () => {
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (url: string | URL | Request, init) => {
      if (String(url) === 'https://8.8.8.8/image.png') {
        return new Response(Buffer.from('chain-image'), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        });
      }

      submittedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({ name: 'operations/google_video_handoff' }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = createGoogleProvider({
      apiKey: 'gemini_test_key',
      fetchImpl,
    });
    const resolution = resolveProvider('google/veo-3.1-fast', {
      byokMode: true,
    });

    const submitted = await provider.submit({
      idempotencyKey: 'idem_google_video_handoff',
      modelIdentifier: resolution.modelIdentifier,
      params: {
        generation_audio: false,
        generation_input_image_file: ['https://8.8.8.8/image.png'],
        generation_prompt: 'Waves roll in slowly',
      },
      stepKind: 'video',
    });

    expect(submittedBody).toMatchObject({
      instances: [
        {
          prompt: 'Waves roll in slowly',
          image: {
            bytesBase64Encoded: Buffer.from('chain-image').toString('base64'),
            mimeType: 'image/png',
          },
        },
      ],
    });
    expect(submittedBody).not.toHaveProperty('parameters');
    expect(submitted).toMatchObject({
      kind: 'async',
      generationId: 'operations/google_video_handoff',
    });
  });

  it('normalizes Google Veo canonical media and parameters', async () => {
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init) => {
      submittedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({ name: 'operations/google_raw_video_123' }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = createGoogleProvider({
      apiKey: 'gemini_test_key',
      fetchImpl,
    });
    const resolution = resolveProvider('google/veo-3.1-fast', {
      byokMode: true,
    });

    await provider.submit({
      idempotencyKey: 'idem_google_raw_video',
      modelIdentifier: resolution.modelIdentifier,
      params: {
        generation_duration: 4,
        generation_input_image_file: ['data:image/png;base64,aW1hZ2U='],
        generation_last_frame: 'data:image/png;base64,bGFzdA==',
        generation_prompt: 'A slow cinematic push in',
        generation_resolution: '4K',
      },
      stepKind: 'video',
    });

    expect(submittedBody).toEqual({
      instances: [
        {
          image: {
            bytesBase64Encoded: 'aW1hZ2U=',
            mimeType: 'image/png',
          },
          lastFrame: {
            bytesBase64Encoded: 'bGFzdA==',
            mimeType: 'image/png',
          },
          prompt: 'A slow cinematic push in',
        },
      ],
      parameters: {
        durationSeconds: 4,
        resolution: '4K',
      },
    });
  });

  it('rejects Google Veo durations outside provider enum values', async () => {
    const provider = createGoogleProvider({
      apiKey: 'gemini_test_key',
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    const resolution = resolveProvider('google/veo-3.1-fast', {
      byokMode: true,
    });

    await expect(
      provider.submit({
        idempotencyKey: 'idem_google_bad_duration',
        modelIdentifier: resolution.modelIdentifier,
        params: {
          generation_duration: 5,
          generation_prompt: 'A slow cinematic push in',
        },
        stepKind: 'video',
      }),
    ).rejects.toThrow('Google generation_duration must be one of');
  });

  it('submits Google Veo Fast canonical payloads', async () => {
    let submittedUrl = '';
    let submittedBody: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (url: string | URL | Request, init) => {
      submittedUrl = String(url);
      submittedBody = JSON.parse(String(init?.body));

      return new Response(
        JSON.stringify({ name: 'operations/google_fast_video_123' }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = createGoogleProvider({
      apiKey: 'gemini_test_key',
      fetchImpl,
    });
    const resolution = resolveProvider('google/veo-3.1-fast', {
      byokMode: true,
    });

    const submitted = await provider.submit({
      idempotencyKey: 'idem_google_fast_video',
      modelIdentifier: resolution.modelIdentifier,
      params: {
        generation_prompt: 'Extend the previous shot.',
        generation_resolution: '720p',
      },
      stepKind: 'video',
    });

    expect(submittedUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning',
    );
    expect(submittedBody).toEqual({
      instances: [
        {
          prompt: 'Extend the previous shot.',
        },
      ],
      parameters: {
        resolution: '720p',
      },
    });
    expect(submitted).toMatchObject({
      kind: 'async',
      generationId: 'operations/google_fast_video_123',
      providerOrder: ['google'],
    });
  });

  it('submits and polls Alibaba Cloud video tasks', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init) => {
      if (String(url).includes('/api/v1/tasks/')) {
        return new Response(
          JSON.stringify({
            output: {
              task_status: 'SUCCEEDED',
              video_url: 'https://cdn.example.com/wan-output.mp4',
            },
            request_id: 'dashscope_poll_123',
          }),
          { status: 200 },
        );
      }

      expect(String(url)).toContain('/video-generation/video-synthesis');
      const submittedBody = JSON.parse(String(init?.body));
      expect(submittedBody).toMatchObject({
        model: 'wan2.7-i2v-2026-04-25',
        input: {
          prompt: 'Move the product camera slowly',
          media: [
            {
              type: 'first_frame',
              url: 'https://cdn.example.com/first.png',
            },
            {
              type: 'last_frame',
              url: 'https://cdn.example.com/last.png',
            },
          ],
        },
      });
      expect(submittedBody.parameters).toEqual({
        duration: 5,
        resolution: '720P',
      });
      expect(submittedBody.parameters).not.toHaveProperty('size');

      return new Response(
        JSON.stringify({
          output: { task_id: 'dashscope_task_video_123' },
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const provider = createAlibabaCloudProvider({
      apiKey: 'dashscope_test_key',
      fetchImpl,
    });

    const submitted = await provider.submit({
      idempotencyKey: 'idem_alibaba_video',
      modelIdentifier: 'alibabacloud/wan2.7-i2v-2026-04-25',
      params: {
        generation_prompt: 'Move the product camera slowly',
        generation_input_image_file: ['https://cdn.example.com/first.png'],
        generation_last_frame: 'https://cdn.example.com/last.png',
        generation_duration: 5,
        generation_output_number: 3,
        generation_aspect_ratio: '16:9',
        generation_resolution: '720p',
        generation_size: '1024x1024',
        parameters: { n: 9 },
      },
      stepKind: 'video',
    });

    expect(submitted).toMatchObject({
      kind: 'async',
      generationId: 'dashscope_task_video_123',
    });

    const polled = await provider.poll({
      generationId: 'dashscope_task_video_123',
      modelIdentifier: 'alibabacloud/wan2.7-i2v-2026-04-25',
      providerMetadata:
        submitted.kind === 'async'
          ? (submitted.providerMetadata ?? null)
          : null,
    });

    expect(polled).toMatchObject({
      generation_status: 'succeeded',
      generation_provider_used: 'alibabacloud',
      generation_output_file: ['https://cdn.example.com/wan-output.mp4'],
    });
  });

  describe('runway ratio mapping', () => {
    const RUNWAY_IMAGE_RATIOS = new Set([
      '1024:1024',
      '1080:1080',
      '1168:880',
      '1360:768',
      '1440:1080',
      '1080:1440',
      '1808:768',
      '1920:1080',
      '1080:1920',
      '2112:912',
      '1280:720',
      '720:1280',
      '720:720',
      '960:720',
      '720:960',
      '1680:720',
    ]);
    const RUNWAY_VIDEO_RATIOS = new Set([
      '1280:720',
      '720:1280',
      '1104:832',
      '960:960',
      '832:1104',
      '1584:672',
    ]);

    async function submitRatio(args: {
      modelIdentifier: string;
      ratio: string;
      stepKind: 'image' | 'video';
    }) {
      let capturedBody: Record<string, unknown> | null = null;
      const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body ?? '{}'));
        return new Response(JSON.stringify({ id: 'task_ratio_test' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as unknown as typeof fetch;
      const provider = createRunwayProvider({
        apiKey: 'runway_test_key',
        fetchImpl,
      });

      await provider.submit({
        idempotencyKey: 'idem_ratio_test',
        modelIdentifier: args.modelIdentifier,
        params: {
          generation_prompt: 'Ratio mapping test',
          generation_aspect_ratio: args.ratio,
          ...(args.stepKind === 'video'
            ? {
                generation_duration: 5,
                generation_input_file: ['https://example.com/image.png'],
              }
            : {}),
        },
        stepKind: args.stepKind,
      });

      return capturedBody!;
    }

    it('maps every semantic aspect ratio to a documented runway image ratio', async () => {
      const { getModel } = await import('semantic-lady');
      const ratioField = getModel('runway/gen-4-image')!.schema.find(
        (field) => field.name === 'generation_aspect_ratio',
      );

      expect(ratioField?.enum?.length).toBeGreaterThan(0);

      for (const ratioValue of ratioField!.enum!) {
        const ratio = String(ratioValue);
        const body = await submitRatio({
          modelIdentifier: 'runway/gen4_image',
          ratio,
          stepKind: 'image',
        });

        expect(RUNWAY_IMAGE_RATIOS.has(String(body.ratio)), ratio).toBe(true);
      }
    });

    it('maps every semantic aspect ratio to a documented runway video ratio', async () => {
      const { getModel } = await import('semantic-lady');
      const ratioField = getModel('runway/gen-4-turbo')!.schema.find(
        (field) => field.name === 'generation_aspect_ratio',
      );

      expect(ratioField?.enum?.length).toBeGreaterThan(0);

      for (const ratioValue of ratioField!.enum!) {
        const ratio = String(ratioValue);
        const body = await submitRatio({
          modelIdentifier: 'runway/gen4_turbo',
          ratio,
          stepKind: 'video',
        });

        expect(RUNWAY_VIDEO_RATIOS.has(String(body.ratio)), ratio).toBe(true);
      }
    });

    it('passes provider-native pixel ratios and prototype keys through safely', async () => {
      const native = await submitRatio({
        modelIdentifier: 'runway/gen4_turbo',
        ratio: '1280:720',
        stepKind: 'video',
      });

      expect(native.ratio).toBe('1280:720');

      const proto = await submitRatio({
        modelIdentifier: 'runway/gen4_turbo',
        ratio: 'constructor',
        stepKind: 'video',
      });

      expect(proto.ratio).toBe('constructor');
    });
  });
});
