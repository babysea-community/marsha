import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

const SAMPLE_PROMPT =
  'A gentle handheld dolly follows her through the crosswalk as neon reflections slide across her hoodie, with small head turns and natural walking rhythm.';

// Match on the exact host so a full URL such as https://evil.example/cdn.example.com
// cannot satisfy the check the way an includes() substring match would.
function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

describe('Bedrock Nova Chain Agent media download', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.doUnmock('node:dns/promises');
    vi.resetModules();
  });

  it('sends a User-Agent header when downloading previous step media', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      APP_API_KEY: 'bchn_test_key',
      APP_CALLBACK_SECRET: 'callback_test_secret',
      APP_CRON_SECRET: 'cron_test_secret',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/postgres',
      NEXT_PUBLIC_SITE_URL: 'https://your-domain.example.com',
    };

    // Pin DNS to a safe public address so the download takes the network path
    // without performing a real lookup.
    vi.doMock('node:dns/promises', () => ({
      lookup: vi.fn(async () => [{ address: '8.8.8.8', family: 4 }]),
    }));

    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      if (hostnameOf(url) === 'cdn.example.com') {
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          headers: { 'content-type': 'image/png' },
        });
      }

      return Response.json({
        output: {
          message: {
            content: [
              {
                text: JSON.stringify({
                  observations: {},
                  suggestions: [
                    { title: 'Dolly Drift', prompt: SAMPLE_PROMPT },
                    { title: 'Street Pulse', prompt: SAMPLE_PROMPT },
                    { title: 'Quiet Turn', prompt: SAMPLE_PROMPT },
                  ],
                  selected_prompt: SAMPLE_PROMPT,
                  selected_params: {
                    generation_duration: 4,
                    generation_prompt: SAMPLE_PROMPT,
                  },
                }),
              },
            ],
          },
        },
        usage: { inputTokens: 10, outputTokens: 20 },
      });
    });

    const { createBedrockNovaAgent } = await import('@/lib/agents/amazon-nova');
    const agent = createBedrockNovaAgent({
      apiKey: 'bedrock_test_key_12345678',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      modelIdentifier: 'us.amazon.nova-2-lite-v1:0',
      region: 'us-east-1',
    });

    // The header is what matters here; ignore any downstream validation outcome.
    await agent
      .suggestNextStep({
        currentInput: {},
        flow: {
          currentStepKey: 'image',
          mode: 'autopilot',
          nextStepKey: 'video',
        },
        nextStep: {
          modelIdentifier: 'google/veo-3.1-lite',
          requestParams: null,
          schema: {
            type: 'object',
            required: ['generation_prompt', 'generation_duration'],
            properties: {
              generation_prompt: { type: 'string' },
              generation_duration: { type: 'number', minimum: 1, maximum: 8 },
            },
          },
          stepKey: 'video',
          stepKind: 'video',
        },
        previousStep: {
          modelIdentifier: 'bfl/flux-1.1-pro',
          outputFiles: ['https://cdn.example.com/output-0.png'],
          requestParams: { generation_prompt: 'A portrait' },
          stepKey: 'image',
          stepKind: 'image',
        },
      })
      .catch(() => undefined);

    const downloadCall = fetchImpl.mock.calls.find(
      ([url]) =>
        typeof url === 'string' && hostnameOf(url) === 'cdn.example.com',
    );

    expect(downloadCall).toBeDefined();

    const headers = (downloadCall?.[1] as RequestInit | undefined)?.headers as
      Record<string, string> | undefined;

    expect(headers?.['user-agent']).toBe('Marsha/0.1');
  });
});
