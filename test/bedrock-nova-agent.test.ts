import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

describe('Bedrock Nova Chain Agent', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it('defaults to a Nova inference profile model id', async () => {
    setMinimalEnv();

    const { defaultBedrockNovaModelIdentifier } =
      await import('@/lib/agents/amazon-nova');

    expect(defaultBedrockNovaModelIdentifier()).toBe(
      'us.amazon.nova-2-lite-v1:0',
    );
  });

  it('includes the Bedrock validation message when Converse fails', async () => {
    setMinimalEnv();
    const fetchImpl = vi.fn(async () =>
      Response.json(
        {
          message:
            'Invocation of model ID amazon.nova-premier-v1:0 with on-demand throughput is not supported. Retry your request with the ID or ARN of an inference profile that contains this model.',
        },
        { status: 400 },
      ),
    ) as unknown as typeof fetch;

    const { createBedrockNovaAgent } = await import('@/lib/agents/amazon-nova');
    const agent = createBedrockNovaAgent({
      apiKey: 'bedrock_test_key_12345678',
      fetchImpl,
      modelIdentifier: 'amazon.nova-premier-v1:0',
      region: 'us-east-1',
    });

    await expect(
      agent.suggestNextStep({
        currentInput: {},
        flow: {
          currentStepKey: 'image',
          mode: 'copilot',
          nextStepKey: 'video',
        },
        nextStep: {
          modelIdentifier: 'google/veo-3.1-lite',
          requestParams: null,
          stepKey: 'video',
          stepKind: 'video',
        },
        previousStep: {
          modelIdentifier: 'bfl/flux-1.1-pro',
          outputFiles: [],
          requestParams: { generation_prompt: 'A product render' },
          stepKey: 'image',
          stepKind: 'image',
        },
      }),
    ).rejects.toMatchObject({
      code: 'chain_agent_failed',
      message: expect.stringContaining('inference profile'),
      status: 502,
    });
  });

  it('uses Amazon Nova 2 output limit and sends downstream schema once', async () => {
    setMinimalEnv();
    const requestBodies: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (_url, init) => {
      requestBodies.push(
        JSON.parse(String(init?.body)) as Record<string, unknown>,
      );

      return Response.json({
        output: {
          message: {
            content: [
              {
                text: JSON.stringify({
                  observations: {},
                  suggestions: [
                    {
                      title: 'Dolly Drift',
                      prompt:
                        'A gentle dolly-in continues the product shot with soft studio reflections and a controlled focus pull.',
                      params: {},
                    },
                    {
                      title: 'Light Sweep',
                      prompt:
                        'A slow light sweep moves across the product surface while the camera glides slightly to reveal depth.',
                      params: {},
                    },
                    {
                      title: 'Subtle Orbit',
                      prompt:
                        'The camera makes a restrained micro-orbit around the product, preserving the studio setup and polished highlights.',
                      params: {},
                    },
                  ],
                  selected_prompt:
                    'A gentle dolly-in continues the product shot with soft studio reflections and a controlled focus pull.',
                  selected_params: {
                    generation_duration: 4,
                    generation_prompt:
                      'A gentle dolly-in continues the product shot with soft studio reflections and a controlled focus pull.',
                  },
                }),
              },
            ],
          },
        },
        usage: { inputTokens: 100, outputTokens: 80 },
      });
    });

    const { createBedrockNovaAgent } = await import('@/lib/agents/amazon-nova');
    const agent = createBedrockNovaAgent({
      apiKey: 'bedrock_test_key_12345678',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      modelIdentifier: 'us.amazon.nova-2-lite-v1:0',
      region: 'us-east-1',
    });

    await agent.suggestNextStep({
      currentInput: {},
      flow: {
        currentStepKey: 'image',
        mode: 'autopilot',
        nextStepKey: 'video',
      },
      nextStep: {
        modelIdentifier: 'google/veo-3.1-fast',
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
        outputFiles: [],
        requestParams: { generation_prompt: 'A product render' },
        stepKey: 'image',
        stepKind: 'image',
      },
    });

    const requestBody = requestBodies[0];
    expect(requestBody?.inferenceConfig).toMatchObject({ maxTokens: 10000 });

    const requestText = JSON.stringify(requestBody);
    expect(requestText.match(/Downstream schema JSON/g)).toHaveLength(1);
    expect(agentPromptText(requestBody)).toContain(
      '"schema_location":"runtime_context.downstream_schema"',
    );
  });

  it('puts stable behavior in the system role and run context in the user role', async () => {
    setMinimalEnv();
    const requestBodies: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (_url, init) => {
      requestBodies.push(
        JSON.parse(String(init?.body)) as Record<string, unknown>,
      );

      return Response.json({
        output: {
          message: {
            content: [
              {
                text: JSON.stringify({
                  observations: {},
                  suggestions: [
                    {
                      title: 'Dolly Drift',
                      prompt:
                        'A gentle dolly-in continues the product shot with soft studio reflections and a controlled focus pull.',
                    },
                    {
                      title: 'Light Sweep',
                      prompt:
                        'A slow light sweep moves across the product surface while the camera glides slightly to reveal depth.',
                    },
                    {
                      title: 'Subtle Orbit',
                      prompt:
                        'The camera makes a restrained micro-orbit around the product, preserving the studio setup and polished highlights.',
                    },
                  ],
                  selected_prompt:
                    'A gentle dolly-in continues the product shot with soft studio reflections and a controlled focus pull.',
                  selected_params: {
                    generation_duration: 4,
                    generation_prompt:
                      'A gentle dolly-in continues the product shot with soft studio reflections and a controlled focus pull.',
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

    await agent.suggestNextStep({
      currentInput: {},
      flow: {
        currentStepKey: 'image',
        mode: 'autopilot',
        nextStepKey: 'video',
      },
      nextStep: {
        modelIdentifier: 'google/veo-3.1-fast',
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
        outputFiles: [],
        requestParams: { generation_prompt: 'A product render' },
        stepKey: 'image',
        stepKind: 'image',
      },
    });

    const requestBody = requestBodies[0];
    const systemText = agentSystemText(requestBody);
    const userText = agentPromptText(requestBody);

    // Stable behavioral parameters belong in the Nova system role.
    expect(systemText).toContain('## Persona');
    expect(systemText).toContain('## Reasoning Method');
    expect(systemText).toContain('## Model Instructions');
    expect(systemText).toContain('## Scope And Trust Boundary');
    expect(systemText).toContain('Output JSON schema:');

    // Per-run context belongs in the user role, not the system role.
    expect(userText).toContain('## Runtime Context');
    expect(userText).toContain('Downstream schema JSON');
    expect(systemText).not.toContain('Downstream schema JSON');
  });

  it('repairs invalid selected params once and records observability', async () => {
    setMinimalEnv();
    const responses = [
      {
        output: {
          message: {
            content: [
              {
                text: JSON.stringify({
                  observations: {},
                  suggestions: [
                    { title: 'Bad', prompt: 'Move too long.', params: {} },
                  ],
                  selected_prompt: 'Animate the frame.',
                  selected_params: {
                    generation_duration: 99,
                    generation_prompt: 'Animate the frame.',
                  },
                }),
              },
            ],
          },
        },
        usage: { inputTokens: 10, outputTokens: 20 },
      },
      {
        output: {
          message: {
            content: [
              {
                text: JSON.stringify({
                  observations: {},
                  suggestions: [
                    {
                      title: 'Dolly Drift',
                      prompt:
                        'A gentle handheld dolly follows her through the crosswalk as neon reflections slide across her hoodie, with small head turns and natural walking rhythm.',
                      params: {},
                    },
                    {
                      title: 'Street Pulse',
                      prompt:
                        'She moves past storefronts in a slow documentary tracking shot, background lights stretching into soft bokeh while her shoulders subtly shift with each step.',
                      params: {},
                    },
                    {
                      title: 'Quiet Turn',
                      prompt:
                        'The camera trails behind, then arcs slightly as she glances toward passing traffic, keeping the city alive with layered motion and shallow focus.',
                      params: {},
                    },
                  ],
                  selected_prompt:
                    'A gentle handheld dolly follows her through the crosswalk as neon reflections slide across her hoodie, with small head turns and natural walking rhythm.',
                  selected_params: {
                    generation_duration: 4,
                    generation_prompt:
                      'A gentle handheld dolly follows her through the crosswalk as neon reflections slide across her hoodie, with small head turns and natural walking rhythm.',
                  },
                }),
              },
            ],
          },
        },
        usage: { inputTokens: 11, outputTokens: 21 },
      },
    ];
    const fetchImpl = vi.fn(async () => Response.json(responses.shift()));

    const { createBedrockNovaAgent } = await import('@/lib/agents/amazon-nova');
    const agent = createBedrockNovaAgent({
      apiKey: 'bedrock_test_key_12345678',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      modelIdentifier: 'us.amazon.nova-2-lite-v1:0',
      region: 'us-east-1',
    });
    const result = await agent.suggestNextStep({
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
        outputFiles: [],
        requestParams: { generation_prompt: 'A product render' },
        stepKey: 'image',
        stepKind: 'image',
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.selectedParams).toMatchObject({
      generation_duration: 4,
      generation_prompt:
        'A gentle handheld dolly follows her through the crosswalk as neon reflections slide across her hoodie, with small head turns and natural walking rhythm.',
    });
    expect(result.observability).toMatchObject({
      model_identifier: 'us.amazon.nova-2-lite-v1:0',
      repair_attempted: true,
      request_count: 2,
      token_usage: { inputTokens: 21, outputTokens: 41 },
      validation: { ok: true },
    });
  });

  it('repairs a malformed-JSON first pass via the greedy repair pass', async () => {
    setMinimalEnv();
    const responses = [
      {
        output: {
          message: {
            content: [
              { text: 'Sorry, here is the plan but not valid JSON {[' },
            ],
          },
        },
        usage: { inputTokens: 9, outputTokens: 9 },
      },
      {
        output: {
          message: {
            content: [
              {
                text: JSON.stringify({
                  observations: {},
                  suggestions: [
                    {
                      title: 'Dolly Drift',
                      prompt:
                        'A gentle handheld dolly follows her through the crosswalk as neon reflections slide across her hoodie, with small head turns and natural walking rhythm.',
                      params: {},
                    },
                    {
                      title: 'Street Pulse',
                      prompt:
                        'She moves past storefronts in a slow documentary tracking shot, background lights stretching into soft bokeh while her shoulders subtly shift with each step.',
                      params: {},
                    },
                    {
                      title: 'Quiet Turn',
                      prompt:
                        'The camera trails behind, then arcs slightly as she glances toward passing traffic, keeping the city alive with layered motion and shallow focus.',
                      params: {},
                    },
                  ],
                  selected_prompt:
                    'A gentle handheld dolly follows her through the crosswalk as neon reflections slide across her hoodie, with small head turns and natural walking rhythm.',
                  selected_params: {
                    generation_duration: 4,
                    generation_prompt:
                      'A gentle handheld dolly follows her through the crosswalk as neon reflections slide across her hoodie, with small head turns and natural walking rhythm.',
                  },
                }),
              },
            ],
          },
        },
        usage: { inputTokens: 12, outputTokens: 22 },
      },
    ];
    const fetchImpl = vi.fn(async () => Response.json(responses.shift()));

    const { createBedrockNovaAgent } = await import('@/lib/agents/amazon-nova');
    const agent = createBedrockNovaAgent({
      apiKey: 'bedrock_test_key_12345678',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      modelIdentifier: 'us.amazon.nova-2-lite-v1:0',
      region: 'us-east-1',
    });
    const result = await agent.suggestNextStep({
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
        outputFiles: [],
        requestParams: { generation_prompt: 'A product render' },
        stepKey: 'image',
        stepKind: 'image',
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.selectedPrompt).toContain('handheld dolly');
    expect(result.observability).toMatchObject({
      repair_attempted: true,
      request_count: 2,
      token_usage: { inputTokens: 12, outputTokens: 22 },
      validation: { ok: true },
    });
  });

  it('completes omitted optional schema fields before validation', async () => {
    setMinimalEnv();
    const fetchImpl = vi.fn(async () =>
      Response.json({
        output: {
          message: {
            content: [
              {
                text: JSON.stringify({
                  observations: {},
                  suggestions: [
                    {
                      title: 'Dolly Drift',
                      prompt:
                        'A gentle dolly-in keeps the portrait in place while soft bokeh moves behind her and the light breathes naturally.',
                    },
                    {
                      title: 'Still Breath',
                      prompt:
                        'The same portrait subtly comes alive with a small head turn, natural blink, and slow focus breathing.',
                    },
                    {
                      title: 'Quiet Push',
                      prompt:
                        'The camera eases closer to the portrait while preserving her expression, film grain, and blurred background.',
                    },
                  ],
                  selected_prompt:
                    'A gentle dolly-in keeps the portrait in place while soft bokeh moves behind her and the light breathes naturally.',
                  selected_params: {
                    generation_duration: 4,
                    generation_prompt:
                      'A gentle dolly-in keeps the portrait in place while soft bokeh moves behind her and the light breathes naturally.',
                  },
                }),
              },
            ],
          },
        },
        usage: { inputTokens: 10, outputTokens: 20 },
      }),
    );

    const { createBedrockNovaAgent } = await import('@/lib/agents/amazon-nova');
    const agent = createBedrockNovaAgent({
      apiKey: 'bedrock_test_key_12345678',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      modelIdentifier: 'us.amazon.nova-2-lite-v1:0',
      region: 'us-east-1',
    });

    const result = await agent.suggestNextStep({
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
            generation_negative_prompt: { type: 'string' },
            generation_seed: {
              type: 'integer',
              minimum: 0,
              maximum: 2147483647,
            },
          },
        },
        stepKey: 'video',
        stepKind: 'video',
      },
      previousStep: {
        modelIdentifier: 'bfl/flux-1.1-pro',
        outputFiles: [],
        requestParams: { generation_prompt: 'A portrait render' },
        stepKey: 'image',
        stepKind: 'image',
      },
    });

    expect(result.selectedParams).toMatchObject({
      generation_negative_prompt: '',
      generation_seed: 0,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps full selected params prompt instead of selected prompt title', async () => {
    setMinimalEnv();
    const fullPrompt =
      'The portrait remains in the same shallow-focus setting as she subtly turns her head, with soft bokeh breathing behind her and a slow controlled push-in.';
    const fetchImpl = vi.fn(async () =>
      Response.json({
        output: {
          message: {
            content: [
              {
                text: JSON.stringify({
                  observations: {},
                  suggestions: [
                    { title: 'Subtle Head Turn', prompt: fullPrompt },
                    {
                      title: 'Soft Push',
                      prompt: `${fullPrompt} The focus breathes gently.`,
                    },
                    {
                      title: 'Bokeh Shift',
                      prompt: `${fullPrompt} The background moves slightly.`,
                    },
                  ],
                  selected_prompt: 'Subtle Head Turn',
                  selected_params: {
                    generation_duration: 4,
                    generation_prompt: fullPrompt,
                  },
                }),
              },
            ],
          },
        },
        usage: { inputTokens: 20, outputTokens: 30 },
      }),
    );

    const { createBedrockNovaAgent } = await import('@/lib/agents/amazon-nova');
    const agent = createBedrockNovaAgent({
      apiKey: 'bedrock_test_key_12345678',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      modelIdentifier: 'us.amazon.nova-2-lite-v1:0',
      region: 'us-east-1',
    });

    const result = await agent.suggestNextStep({
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
        outputFiles: [],
        requestParams: { generation_prompt: 'A portrait' },
        stepKey: 'image',
        stepKind: 'image',
      },
    });

    expect(result.selectedPrompt).toBe(fullPrompt);
    expect(result.selectedParams.generation_prompt).toBe(fullPrompt);
  });

  it('does not download previous video outputs for Nova context', async () => {
    setMinimalEnv();
    const fetchImpl = vi.fn(async (_url, init) => {
      if (!init) {
        throw new Error('Unexpected media download.');
      }

      return Response.json({
        output: {
          message: {
            content: [
              {
                text: JSON.stringify({
                  observations: {},
                  suggestions: [
                    {
                      title: 'Motion Polish',
                      prompt:
                        'The existing video is refined with smoother motion, steadier camera rhythm, and preserved subject continuity.',
                    },
                    {
                      title: 'Focus Smooth',
                      prompt:
                        'The video keeps the same scene while improving focus breathing and reducing abrupt motion.',
                    },
                    {
                      title: 'Light Balance',
                      prompt:
                        'The edit preserves the same video content while balancing highlights and smoothing movement.',
                    },
                  ],
                  selected_prompt:
                    'The existing video is refined with smoother motion, steadier camera rhythm, and preserved subject continuity.',
                  selected_params: {
                    generation_prompt:
                      'The existing video is refined with smoother motion, steadier camera rhythm, and preserved subject continuity.',
                  },
                }),
              },
            ],
          },
        },
        usage: { inputTokens: 20, outputTokens: 30 },
      });
    });

    const { createBedrockNovaAgent } = await import('@/lib/agents/amazon-nova');
    const agent = createBedrockNovaAgent({
      apiKey: 'bedrock_test_key_12345678',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      modelIdentifier: 'us.amazon.nova-2-lite-v1:0',
      region: 'us-east-1',
    });

    await agent.suggestNextStep({
      currentInput: {},
      flow: {
        currentStepKey: 'video',
        mode: 'autopilot',
        nextStepKey: 'modify',
      },
      nextStep: {
        modelIdentifier: 'runway/aleph-2',
        requestParams: null,
        schema: {
          type: 'object',
          required: ['generation_prompt'],
          properties: {
            generation_prompt: { type: 'string' },
          },
        },
        stepKey: 'modify',
        stepKind: 'video',
      },
      previousStep: {
        modelIdentifier: 'google/veo-3.1-lite',
        outputFiles: ['https://cdn.example.com/generated-video.mp4'],
        requestParams: { generation_prompt: 'A portrait moves naturally.' },
        stepKey: 'video',
        stepKind: 'video',
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('parses a JSON object that Nova wraps in a fence and prose', async () => {
    setMinimalEnv();
    const agentJson = JSON.stringify({
      observations: {},
      suggestions: [
        {
          title: 'Dolly Drift',
          prompt:
            'A gentle dolly-in continues the product shot with soft studio reflections and a controlled focus pull.',
        },
      ],
      selected_prompt:
        'A gentle dolly-in continues the product shot with soft studio reflections and a controlled focus pull.',
      selected_params: {
        generation_duration: 4,
        generation_prompt:
          'A gentle dolly-in continues the product shot with soft studio reflections and a controlled focus pull.',
      },
    });
    const fetchImpl = vi.fn(async () =>
      Response.json({
        output: {
          message: {
            content: [
              {
                text: `Sure, here is the plan:\n\n\`\`\`json\n${agentJson}\n\`\`\`\n\nLet me know if you want changes.`,
              },
            ],
          },
        },
        usage: { inputTokens: 10, outputTokens: 20 },
      }),
    );

    const { createBedrockNovaAgent } = await import('@/lib/agents/amazon-nova');
    const agent = createBedrockNovaAgent({
      apiKey: 'bedrock_test_key_12345678',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      modelIdentifier: 'us.amazon.nova-2-lite-v1:0',
      region: 'us-east-1',
    });

    const result = await agent.suggestNextStep({
      currentInput: {},
      flow: {
        currentStepKey: 'image',
        mode: 'autopilot',
        nextStepKey: 'video',
      },
      nextStep: {
        modelIdentifier: 'google/veo-3.1-fast',
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
        outputFiles: [],
        requestParams: { generation_prompt: 'A product render' },
        stepKey: 'image',
        stepKind: 'image',
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.selectedParams).toMatchObject({
      generation_duration: 4,
      generation_prompt:
        'A gentle dolly-in continues the product shot with soft studio reflections and a controlled focus pull.',
    });
  });
});

function agentSystemText(requestBody: Record<string, unknown> | undefined) {
  const system = requestBody?.system;
  if (!Array.isArray(system)) return '';

  return system
    .map((part) =>
      part && typeof part === 'object' && 'text' in part
        ? String(part.text)
        : '',
    )
    .join('\n');
}

function agentPromptText(requestBody: Record<string, unknown> | undefined) {
  const messages = requestBody?.messages;
  if (!Array.isArray(messages)) return '';

  return messages
    .flatMap((message) =>
      message &&
      typeof message === 'object' &&
      'content' in message &&
      Array.isArray(message.content)
        ? message.content
        : [],
    )
    .map((part) =>
      part && typeof part === 'object' && 'text' in part
        ? String(part.text)
        : '',
    )
    .join('\n');
}

function setMinimalEnv() {
  process.env = {
    ...ORIGINAL_ENV,
    APP_API_KEY: 'bchn_test_key',
    APP_CALLBACK_SECRET: 'callback_test_secret',
    APP_CRON_SECRET: 'cron_test_secret',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/postgres',
    NEXT_PUBLIC_SITE_URL: 'https://your-domain.example.com',
  };
}
