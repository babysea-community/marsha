import { describe, expect, it } from 'vitest';

import {
  assertByokGenerationFields,
  createSemanticRequestSchema,
  findByokGenerationFieldIssue,
  getSemanticModel,
  getSemanticModelSchemaFields,
  semanticFieldJsonSchema,
} from '@/lib/models/semantic-schema';
import { listRegisteredModels } from '@/lib/models/model-library';
import { AppError } from '@/lib/utils/errors';

describe('semantic-lady BYOK schema core', () => {
  it('covers every registered the app model', () => {
    const models = listRegisteredModels();

    expect(models).toHaveLength(54);

    for (const modelIdentifier of models) {
      expect(getSemanticModel(modelIdentifier), modelIdentifier).not.toBeNull();
    }
  });

  it('exposes generation_* schema fields per model', () => {
    const fields = getSemanticModelSchemaFields('bfl/flux-2-pro');

    expect(fields).not.toBeNull();
    expect(fields!.map((field) => field.name)).toContain('generation_prompt');
    expect(fields!.every((field) => field.name.startsWith('generation_'))).toBe(
      true,
    );
  });

  it('builds request schemas from the shared field schema helper', () => {
    const fields = getSemanticModelSchemaFields('bfl/flux-2-pro');
    const schema = createSemanticRequestSchema('bfl/flux-2-pro');
    const properties = schema.properties as Record<string, unknown>;

    expect(fields).not.toBeNull();
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(
      fields!.filter((field) => field.required).map((field) => field.name),
    );

    for (const field of fields!) {
      expect(properties[field.name]).toEqual(semanticFieldJsonSchema(field));
    }
  });

  it('keeps audio reference fields in downstream chain schemas', () => {
    const fields = getSemanticModelSchemaFields('wan/2.7-i2v-2026-04-25', {
      chainFieldMode: 'downstream',
    });
    const fieldNames = fields?.map((field) => field.name) ?? [];

    expect(fieldNames).toContain('generation_input_audio_file');
    expect(fieldNames).not.toContain('generation_input_image_file');
    expect(fieldNames).not.toContain('generation_input_video_file');
    expect(fieldNames).not.toContain('generation_last_frame');
  });

  it('never exposes a schema field name as its own default value', () => {
    for (const modelIdentifier of listRegisteredModels()) {
      const fields = getSemanticModelSchemaFields(modelIdentifier);

      expect(fields, modelIdentifier).not.toBeNull();

      for (const field of fields!) {
        expect(field.default, `${modelIdentifier}.${field.name}`).not.toBe(
          field.name,
        );
        expect(
          semanticFieldJsonSchema(field).default,
          `${modelIdentifier}.${field.name}`,
        ).not.toBe(field.name);
      }
    }
  });

  it('preserves Semantic Lady defaults in JSON request schemas', () => {
    const schema = createSemanticRequestSchema('bfl/flux-1.1-pro');
    const properties = schema.properties as Record<
      string,
      Record<string, unknown>
    >;

    expect(properties.generation_seed).toMatchObject({ type: 'integer' });
    expect(properties.generation_seed?.default).toBeUndefined();
    expect(properties.generation_prompt_extend).toMatchObject({
      default: false,
      type: 'boolean',
    });
  });

  it('accepts valid generation_* fields', () => {
    expect(
      findByokGenerationFieldIssue('bfl/flux-2-pro', {
        generation_prompt: 'A glass lighthouse at sunrise',
        generation_width: 1024,
        generation_height: 768,
        generation_seed: 42,
        generation_output_format: 'png',
      }),
    ).toBeNull();
  });

  it('accepts chain-level generation keys', () => {
    expect(
      findByokGenerationFieldIssue('bytedance/seedream-5-lite', {
        generation_prompt: 'A product photo',
        generation_provider_order: ['byteplus'],
      }),
    ).toBeNull();
  });

  it('accepts canonical media input fields only', () => {
    expect(
      findByokGenerationFieldIssue('runway/aleph-2', {
        generation_prompt: 'Make the scene snowier',
        generation_input_video_file: ['https://example.com/video.mp4'],
      }),
    ).toBeNull();

    expect(
      findByokGenerationFieldIssue('runway/aleph-2', {
        generation_prompt: 'Make the scene snowier',
        generation_input_file: ['https://example.com/video.mp4'],
      }),
    ).toMatchObject({ path: ['generation_input_file'] });

    expect(
      findByokGenerationFieldIssue('google/imagen-4', {
        generation_prompt: 'A skyline at dusk',
        generation_input_file: ['https://example.com/image.png'],
      }),
    ).toMatchObject({ path: ['generation_input_file'] });

    expect(
      findByokGenerationFieldIssue('google/imagen-4', {
        generation_prompt: 'A skyline at dusk',
        generation_last_frame: 'https://example.com/image.png',
      }),
    ).toMatchObject({ path: ['generation_last_frame'] });

    expect(
      findByokGenerationFieldIssue('bytedance/seedance-2.0', {
        generation_prompt: 'A slow pan',
        generation_last_frame: 'https://example.com/image.png',
      }),
    ).toBeNull();
  });

  it('rejects unknown generation_* fields with the supported list', () => {
    const issue = findByokGenerationFieldIssue('bfl/flux-2-pro', {
      generation_prompt: 'A photo',
      generation_stepz: 20,
    });

    expect(issue).not.toBeNull();
    expect(issue!.path).toEqual(['generation_stepz']);
    expect(issue!.message).toContain('Unknown generation field');
    expect(issue!.message).toContain('generation_prompt');
  });

  it('rejects out-of-range and wrong-typed values', () => {
    expect(
      findByokGenerationFieldIssue('bfl/flux-2-flex', {
        generation_prompt: 'A photo',
        generation_guidance_scale: 99,
      }),
    ).toMatchObject({ path: ['generation_guidance_scale'] });

    expect(
      findByokGenerationFieldIssue('bfl/flux-2-pro', {
        generation_prompt: 'A photo',
        generation_seed: 'not-a-number',
      }),
    ).toMatchObject({ path: ['generation_seed'] });

    expect(
      findByokGenerationFieldIssue('gpt/image-2', {
        generation_prompt: 'A photo',
        generation_quality: 'ultra',
      }),
    ).toMatchObject({ path: ['generation_quality'] });
  });

  it('rejects fields the provider docs exclude for a model', () => {
    // gpt-image-2 has no seed parameter.
    expect(
      findByokGenerationFieldIssue('gpt/image-2', {
        generation_prompt: 'A photo',
        generation_seed: 7,
      }),
    ).toMatchObject({ path: ['generation_seed'] });

    // FLUX.2 Pro does not accept guidance (Flex only).
    expect(
      findByokGenerationFieldIssue('bfl/flux-2-pro', {
        generation_prompt: 'A photo',
        generation_guidance_scale: 5,
      }),
    ).toMatchObject({ path: ['generation_guidance_scale'] });
  });

  it('accepts provider-native ratio and size values', () => {
    expect(
      findByokGenerationFieldIssue('runway/gen-4-turbo', {
        generation_prompt: 'A slow dolly forward',
        generation_aspect_ratio: '1280:720',
        generation_duration: 5,
        generation_input_image_file: ['https://example.com/image.png'],
      }),
    ).toBeNull();

    expect(
      findByokGenerationFieldIssue('qwen/image-2-pro', {
        generation_prompt: 'A poster',
        generation_size: '1664*928',
      }),
    ).toBeNull();
  });

  it('enforces Semantic Lady numeric enum and seed constraints', () => {
    const issue = findByokGenerationFieldIssue('google/veo-3.1-fast', {
      generation_duration: 5,
      generation_prompt: 'A slow push in',
    });

    expect(issue).toMatchObject({ path: ['generation_duration'] });
  });

  it('rejects unsupported Google Veo negative prompts across the family', () => {
    for (const modelIdentifier of [
      'google/veo-3.1',
      'google/veo-3.1-fast',
      'google/veo-3.1-lite',
    ]) {
      expect(
        findByokGenerationFieldIssue(modelIdentifier, {
          generation_negative_prompt: 'No text overlays',
          generation_prompt: 'A slow push in',
        }),
      ).toMatchObject({ path: ['generation_negative_prompt'] });
    }
  });

  it('throws AppError with a prefixed path through the assert helper', () => {
    try {
      assertByokGenerationFields(
        'bfl/flux-2-pro',
        { generation_zoom: 2 },
        'image_model_input',
      );
      expect.unreachable('expected assertByokGenerationFields to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const chainError = error as AppError;
      expect(chainError.code).toBe('invalid_chain_input');
      expect(chainError.status).toBe(400);
      expect(chainError.details).toMatchObject({
        path: ['image_model_input', 'generation_zoom'],
      });
    }
  });

  it('enforces required fields and ignores unknown models', () => {
    expect(
      findByokGenerationFieldIssue('bfl/flux-2-pro', {
        prompt: 'provider prompt',
        steps: 28,
      }),
    ).toMatchObject({ path: ['generation_prompt'] });
    expect(findByokGenerationFieldIssue('unknown/model', {})).toBeNull();
    expect(findByokGenerationFieldIssue('bfl/flux-2-pro', null)).toBeNull();
  });
});
