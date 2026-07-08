import { describe, expect, it } from 'vitest';

import { runChainAgentTools } from '@/lib/agents/instructions/chain-agent-tools';
import type { ChainAgentPromptContext } from '@/lib/agents/types';
import type { JsonObject } from '@/lib/chains/types';

type Ratio = { recommended_value: unknown; recommended_field: unknown };

function resolveAspect(context: ChainAgentPromptContext): Ratio {
  const tools = runChainAgentTools(context);
  const entry = tools.find((tool) => tool.name === 'resolve_aspect_ratio');
  if (!entry) throw new Error('resolve_aspect_ratio tool missing');
  return entry.output as Ratio;
}

function context({
  previousParams,
  nextEnum,
  imageInput,
}: {
  previousParams: JsonObject | null;
  nextEnum?: readonly string[];
  imageInput?: JsonObject;
}): ChainAgentPromptContext {
  return {
    currentInput: imageInput ? { image_model_input: imageInput } : {},
    flow: { currentStepKey: 'video', mode: 'autopilot', nextStepKey: 'modify' },
    nextStep: {
      modelIdentifier: 'google/veo-3.1',
      requestParams: null,
      schema: {
        type: 'object',
        properties: nextEnum
          ? { generation_aspect_ratio: { type: 'string', enum: [...nextEnum] } }
          : { generation_width: { type: 'integer', minimum: 64 } },
      },
      stepKey: 'video',
      stepKind: 'video',
    },
    previousStep: {
      modelIdentifier: 'qwen/image-2-pro',
      outputFiles: [],
      requestParams: previousParams,
      stepKey: 'image',
      stepKind: 'image',
    },
  };
}

describe('resolve_aspect_ratio', () => {
  it('maps a 1:1 square base to the portrait option, never landscape', () => {
    const result = resolveAspect(
      context({
        previousParams: { generation_size: '1024*1024' },
        nextEnum: ['16:9', '9:16'],
      }),
    );

    expect(result.recommended_field).toBe('generation_aspect_ratio');
    expect(result.recommended_value).toBe('9:16');
  });

  it('keeps a landscape base landscape', () => {
    const result = resolveAspect(
      context({
        previousParams: { generation_aspect_ratio: '16:9' },
        nextEnum: ['16:9', '9:16'],
      }),
    );

    expect(result.recommended_value).toBe('16:9');
  });

  it('uses the previous step ratio over a same-orientation 1:1 option', () => {
    // Previous video is 9:16; the modify model also offers 1:1, but the chain
    // must stay 9:16 (the frame being continued), not jump to square.
    const result = resolveAspect(
      context({
        previousParams: { generation_aspect_ratio: '9:16' },
        nextEnum: ['16:9', '1:1', '9:16'],
      }),
    );

    expect(result.recommended_value).toBe('9:16');
  });

  it('falls back to the base image input when the previous params carry no ratio', () => {
    const result = resolveAspect(
      context({
        previousParams: { generation_prompt: 'no ratio here' },
        nextEnum: ['16:9', '9:16'],
        imageInput: { generation_size: '1024*1024' },
      }),
    );

    expect(result.recommended_value).toBe('9:16');
  });

  it('returns no recommendation for a width/height-only model', () => {
    const result = resolveAspect(
      context({
        previousParams: { generation_size: '1024*1024' },
      }),
    );

    expect(result.recommended_value).toBeNull();
    expect(result.recommended_field).toBeNull();
  });
});
