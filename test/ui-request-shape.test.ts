import { describe, expect, it } from 'vitest';

import {
  createCancelRunCurl,
  createChainRunCurl,
  createChainRunInput,
  createExampleStepInputFromRequestSchema,
  createExampleStepInputFromValues,
  createGetRunCurl,
  createListChainsCurl,
  createModelSchemaJsonFromRequestSchema,
  createStepInputFromRequestSchema,
  createStepInputFromValues,
} from '@/lib/chains/ui-request-shape';
import { createSemanticRequestSchema } from '@/lib/models/semantic-schema';

describe('UI request shape builders', () => {
  it('serializes user values, defaults, and normalized file arrays', () => {
    const fields = [
      { name: 'generation_prompt', valueKind: 'string' as const },
      { name: 'generation_width', valueKind: 'number' as const },
      { name: 'generation_seed', valueKind: 'number' as const },
      { name: 'generation_optional_file', valueKind: 'string-array' as const },
      { name: 'generation_height', default: 768, valueKind: 'number' as const },
      {
        name: 'generation_moderation',
        default: false,
        valueKind: 'boolean' as const,
      },
      {
        name: 'generation_input_image_file',
        valueKind: 'string-array' as const,
      },
    ];

    expect(
      createStepInputFromValues({
        fields,
        values: {
          generation_input_image_file: [],
          generation_prompt: 'A product frame',
          generation_width: 1024,
        },
      }),
    ).toEqual({
      generation_height: 768,
      generation_input_image_file: [],
      generation_moderation: false,
      generation_prompt: 'A product frame',
      generation_width: 1024,
    });
  });

  it('preserves null defaults but does not invent null for nullable fields', () => {
    expect(
      createStepInputFromRequestSchema({
        schema: {
          type: 'object',
          properties: {
            generation_model_default: {
              type: ['integer', 'null'],
              default: null,
            },
            generation_nullable_without_default: {
              type: ['integer', 'null'],
            },
          },
        },
      }),
    ).toEqual({
      generation_model_default: null,
    });
  });

  it('uses manual arrays only for normalized app input file fields', () => {
    expect(
      createStepInputFromRequestSchema({
        schema: {
          type: 'object',
          properties: {
            generation_input_audio_file: { type: 'array' },
            generation_input_image_file: { type: 'array' },
            generation_input_video_file: { type: 'array' },
            generation_optional_file: { type: 'array' },
          },
        },
      }),
    ).toEqual({
      generation_input_audio_file: [],
      generation_input_image_file: [],
      generation_input_video_file: [],
    });
  });

  it('omits missing no-default fields instead of inventing empty values', () => {
    const schema = createSemanticRequestSchema('runway/gen-4-turbo', {
      chainFieldMode: 'downstream',
    });

    expect(
      createStepInputFromRequestSchema({
        schema,
        values: { generation_moderation: false },
      }),
    ).toEqual({
      generation_moderation: false,
    });
  });

  it('fills cURL examples with typed placeholders for no-default fields', () => {
    expect(
      createExampleStepInputFromRequestSchema({
        schema: {
          type: 'object',
          properties: {
            generation_prompt: { type: 'string' },
            generation_seed: { type: 'integer' },
            generation_strength: { type: 'number' },
            generation_moderation: { type: 'boolean' },
            generation_input_image_file: {
              type: 'array',
              items: { type: 'string', format: 'uri' },
            },
            generation_settings: {
              type: 'object',
              properties: {
                mode: { type: 'string' },
              },
            },
          },
        },
      }),
    ).toEqual({
      generation_input_image_file: ['<string>'],
      generation_moderation: '<boolean>',
      generation_prompt: '<string>',
      generation_seed: '<integer>',
      generation_settings: { mode: '<string>' },
      generation_strength: '<number>',
    });
  });

  it('keeps user values before defaults and cURL placeholders', () => {
    expect(
      createExampleStepInputFromValues({
        fields: [
          { name: 'generation_prompt', valueKind: 'string' },
          { name: 'generation_width', default: 1024, valueKind: 'number' },
          { name: 'generation_seed', valueKind: 'number' },
        ],
        values: {
          generation_prompt: 'A product frame',
          generation_width: 768,
        },
      }),
    ).toEqual({
      generation_prompt: 'A product frame',
      generation_seed: '<number>',
      generation_width: 768,
    });
  });

  it('builds template cURL inputs from model defaults and file arrays', () => {
    const schema = createSemanticRequestSchema('bfl/flux-1.1-pro');

    expect(createStepInputFromRequestSchema({ schema })).toEqual({
      generation_height: 768,
      generation_input_image_file: [],
      generation_moderation: false,
      generation_output_format: 'jpeg',
      generation_prompt: '',
      generation_prompt_extend: false,
      generation_width: 1024,
    });
  });

  it('builds full cURL model input examples from schema fields', () => {
    const fluxInput = createExampleStepInputFromRequestSchema({
      schema: createSemanticRequestSchema('bfl/flux-1.1-pro'),
    });
    const happyHorseInput = createExampleStepInputFromRequestSchema({
      schema: createSemanticRequestSchema('happyhorse/1.0-i2v', {
        chainFieldMode: 'downstream',
      }),
    });
    const input = createChainRunInput({
      imageModel: 'bfl/flux-1.1-pro',
      imageModelInput: fluxInput,
      videoModel: 'happyhorse/1.0-i2v',
      videoModelInput: happyHorseInput,
    });

    expect(Object.keys(fluxInput)).toEqual([
      'generation_prompt',
      'generation_width',
      'generation_height',
      'generation_output_format',
      'generation_moderation',
      'generation_input_image_file',
      'generation_prompt_extend',
      'generation_seed',
    ]);
    expect(Object.keys(happyHorseInput)).toEqual([
      'generation_prompt',
      'generation_resolution',
      'generation_duration',
      'generation_seed',
      'generation_watermark',
    ]);
    expect(fluxInput.generation_input_image_file).toEqual(['<string>']);
    expect(happyHorseInput.generation_prompt).toBe('<string>');
    expect(happyHorseInput.generation_seed).toBe('<integer>');
    expect(
      Object.keys(input.image_model_input as Record<string, unknown>),
    ).toHaveLength(8);
    expect(
      Object.keys(input.video_model_input as Record<string, unknown>),
    ).toHaveLength(5);
  });

  it('builds cURL from the same request body sent to the backend', () => {
    const input = createChainRunInput({
      imageModel: 'bfl/flux-1.1-pro',
      imageModelInput: {
        generation_prompt: "A cat's product frame",
        generation_width: 1024,
      },
      videoModel: 'runway/gen-4-turbo',
      videoModelInput: {
        generation_aspect_ratio: '1280:720',
        generation_duration: 5,
        generation_prompt: 'Animate the image',
      },
    });
    const curl = createChainRunCurl(input, {
      siteUrl: 'https://app.example/',
    });

    expect(curl).toContain('--url "https://app.example/api/v1/chains/runs"');
    expect(curl).toContain("--data '\n{");
    expect(curl).toContain("\n}\n'");
    expect(curl).not.toContain("<<'JSON'");
    expect(curl).not.toContain('\nJSON');
    expect(curl).toContain(`"generation_prompt": "A cat'\\''s product frame"`);
    expect(curl).not.toContain('https://example.com/image.png');
    expect(curl).not.toContain('client_reference_id');
    expect(curl).not.toContain('webhook_url');
  });

  it('mirrors the run mode and model_context in the cURL when provided', () => {
    const input = createChainRunInput({
      imageModel: 'bfl/flux-1.1-pro',
      imageModelInput: { generation_prompt: 'A studio portrait' },
      videoModel: 'google/veo-3.1',
      videoModelInput: { generation_prompt: 'Animate the portrait' },
    });
    const curl = createChainRunCurl(
      input,
      { siteUrl: 'https://app.example/' },
      {
        execution: {
          type: 'chain_agent',
          mode: 'autopilot',
          provider: 'bedrock',
        },
        metadata: { model_context: 'use hat with text the app' },
      },
    );

    expect(curl).toContain('"execution"');
    expect(curl).toContain('"type": "chain_agent"');
    expect(curl).toContain('"mode": "autopilot"');
    expect(curl).toContain('"model_context": "use hat with text the app"');
  });

  it('omits execution and metadata from the cURL when not provided', () => {
    const input = createChainRunInput({
      imageModel: 'bfl/flux-1.1-pro',
      imageModelInput: { generation_prompt: 'A studio portrait' },
      videoModel: 'google/veo-3.1',
      videoModelInput: { generation_prompt: 'Animate the portrait' },
    });
    const curl = createChainRunCurl(input);

    expect(curl).not.toContain('"execution"');
    expect(curl).not.toContain('"metadata"');
  });

  it('builds debugging cURL snippets for chain API routes', () => {
    const runId = 'ea233d5f-12a7-45b6-aa14-b3b33bc9e3a2';

    expect(createListChainsCurl({ siteUrl: 'https://app.example/' })).toContain(
      '--url "https://app.example/api/v1/chains"',
    );
    expect(
      createGetRunCurl({
        runId,
        siteUrl: 'https://app.example/',
      }),
    ).toContain(`https://app.example/api/v1/chains/get/${runId}`);
    expect(
      createCancelRunCurl({
        runId,
        siteUrl: 'https://app.example/',
      }),
    ).toContain(`https://app.example/api/v1/chains/cancel/${runId}`);
    expect(createGetRunCurl()).toContain('/api/v1/chains/get/$RUN_ID');
  });

  it('builds ordered JSON schema without changing schema defaults', () => {
    const schema = createSemanticRequestSchema('bfl/flux-1.1-pro');
    const uiSchema = createModelSchemaJsonFromRequestSchema({
      modelId: 'bfl/flux-1.1-pro',
      modelLabel: 'FLUX 1.1 Pro',
      schema,
    });

    expect(uiSchema).toMatchObject({
      model: 'FLUX 1.1 Pro',
      model_identifier: 'bfl/flux-1.1-pro',
      schema: {
        type: 'object',
        properties: {
          generation_seed: {
            type: 'integer',
          },
        },
      },
    });
  });
});
