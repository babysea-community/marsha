import { describe, expect, it } from 'vitest';

import {
  completeChainAgentSelectedParams,
  validateChainAgentResult,
} from '@/lib/agents/validation';
import type {
  ChainAgentPromptContext,
  ChainAgentResult,
} from '@/lib/agents/types';

describe('validateChainAgentResult', () => {
  it('allows brief-driven scene transformation via model_context', () => {
    const result = validateChainAgentResult(
      resultWithPrompt({
        selectedPrompt:
          'A young Japanese woman relaxing in a sunlit garden with flowers and greenery, same face and gaze.',
        generationPrompt:
          'A young Japanese woman relaxing in a sunlit garden with flowers and greenery, same face and gaze.',
      }),
      {
        ...contextWithCurrentInput({}),
        modelContext:
          'Transform the scene: move her into a sunlit garden, keep the same person and face, breezy summer vibe.',
      },
    );

    expect(result).toMatchObject({ ok: true });
  });

  it('allows an explicitly requested scene relocation', () => {
    const result = validateChainAgentResult(
      resultWithPrompt({
        selectedPrompt:
          'Move her into a quiet garden while preserving her face, color-film texture, and shallow portrait focus.',
        generationPrompt:
          'Move her into a quiet garden while preserving her face, color-film texture, and shallow portrait focus.',
      }),
      contextWithCurrentInput({
        generation_prompt:
          'Move her into a quiet garden while preserving the portrait subject identity.',
      }),
    );

    expect(result).toMatchObject({ ok: true });
  });

  it('does not treat words like sparkling as park scene drift', () => {
    const result = validateChainAgentResult(
      resultWithPrompt({
        selectedPrompt:
          'The color-film portrait gently animates with sparkling catchlights in her eyes, soft focus breathing, and subtle hair movement.',
        generationPrompt:
          'The color-film portrait gently animates with sparkling catchlights in her eyes, soft focus breathing, and subtle hair movement.',
      }),
      contextWithCurrentInput({}),
    );

    expect(result).toMatchObject({ ok: true });
  });

  it('passes validation after completing omitted optional fields', () => {
    const result = validateChainAgentResult(
      resultWithPrompt({
        selectedPrompt:
          'The color-film portrait gently animates with subtle breathing, soft bokeh motion, and a slow camera push.',
        generationPrompt:
          'The color-film portrait gently animates with subtle breathing, soft bokeh motion, and a slow camera push.',
      }),
      contextWithCurrentInput({}, true),
    );

    expect(result).toMatchObject({ ok: true });
  });

  it('allows optional string fields to be intentionally blank', () => {
    const result = validateChainAgentResult(
      resultWithPrompt(
        {
          selectedPrompt:
            'The color-film portrait gently animates with subtle breathing, soft bokeh motion, and a slow camera push.',
          generationPrompt:
            'The color-film portrait gently animates with subtle breathing, soft bokeh motion, and a slow camera push.',
        },
        {
          generation_negative_prompt: '',
          generation_seed: 12345,
        },
      ),
      contextWithCurrentInput({}, true),
    );

    expect(result).toMatchObject({ ok: true });
  });

  it('completes missing optional fields from schema generically', () => {
    const context = contextWithCurrentInput({}, true);
    const completed = completeChainAgentSelectedParams(
      resultWithPrompt({
        selectedPrompt:
          'The color-film portrait gently animates with subtle breathing, soft bokeh motion, and a slow camera push.',
        generationPrompt:
          'The color-film portrait gently animates with subtle breathing, soft bokeh motion, and a slow camera push.',
      }).selectedParams,
      context,
    );

    expect(completed).toMatchObject({
      generation_negative_prompt: '',
      generation_seed: 0,
    });
    expect(
      validateChainAgentResult(
        {
          selectedParams: completed,
          selectedPrompt: String(completed.generation_prompt),
          suggestions: [
            { title: 'A', prompt: String(completed.generation_prompt) },
            {
              title: 'B',
              prompt: `${String(completed.generation_prompt)} Camera drifts closer.`,
            },
            {
              title: 'C',
              prompt: `${String(completed.generation_prompt)} Background bokeh shifts.`,
            },
          ],
        },
        context,
      ),
    ).toMatchObject({ ok: true });
  });

  it('prefers existing downstream params before schema fallback completion', () => {
    const context = contextWithCurrentInput({}, true);
    context.nextStep.requestParams = {
      generation_negative_prompt: 'avoid blur',
      generation_seed: 98765,
    };

    const completed = completeChainAgentSelectedParams(
      resultWithPrompt({
        selectedPrompt:
          'The color-film portrait gently animates with subtle breathing, soft bokeh motion, and a slow camera push.',
        generationPrompt:
          'The color-film portrait gently animates with subtle breathing, soft bokeh motion, and a slow camera push.',
      }).selectedParams,
      context,
    );

    expect(completed).toMatchObject({
      generation_negative_prompt: 'avoid blur',
      generation_seed: 98765,
    });
  });

  it('pins prompt_extend off on the agent proposal but honors user edits', () => {
    const schemaContext = {
      nextStep: {
        requestParams: null,
        schema: {
          type: 'object',
          properties: {
            generation_prompt: { type: 'string' },
            generation_prompt_extend: { type: 'boolean', default: true },
          },
        },
      },
    };

    // Agent PROPOSAL: pinned OFF even though the model defaults it to true.
    const proposal = completeChainAgentSelectedParams(
      { generation_prompt: 'A cinematic portrait' },
      schemaContext,
      { pinPromptEnhancementOff: true },
    );
    expect(proposal.generation_prompt_extend).toBe(false);

    // User edit/copilot approval (no flag): the user's choice is honored,
    // never overridden back to false.
    const userEdit = completeChainAgentSelectedParams(
      {
        generation_prompt: 'A cinematic portrait',
        generation_prompt_extend: true,
      },
      schemaContext,
    );
    expect(userEdit.generation_prompt_extend).toBe(true);
  });

  it('rejects selected prompt that does not match selected params prompt', () => {
    const result = validateChainAgentResult(
      resultWithPrompt({
        selectedPrompt: 'Short title prompt.',
        generationPrompt:
          'A complete generation prompt with camera motion, continuity, and detailed subject movement.',
      }),
      contextWithCurrentInput({}),
    );

    expect(result).toMatchObject({
      ok: false,
      error:
        'selected_prompt must exactly match selected_params.generation_prompt.',
    });
  });

  it('drops generation_prompt for downstream schemas that do not accept it', () => {
    const modifyContext: ChainAgentPromptContext = {
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
          properties: {
            generation_seed: {
              type: 'integer',
              minimum: 0,
              maximum: 2147483647,
            },
          },
        },
        stepKey: 'modify',
        stepKind: 'video',
      },
      previousStep: {
        modelIdentifier: 'google/veo-3.1',
        outputFiles: [],
        requestParams: { generation_prompt: 'A living portrait video.' },
        stepKey: 'video',
        stepKind: 'video',
      },
    };

    const completed = completeChainAgentSelectedParams(
      {
        generation_prompt: 'Re-grade the footage as vintage Kodachrome film.',
        generation_seed: 7,
      },
      modifyContext,
    );

    expect(completed).not.toHaveProperty('generation_prompt');
    expect(completed).toMatchObject({ generation_seed: 7 });

    const validation = validateChainAgentResult(
      {
        selectedParams: {
          generation_prompt: 'Re-grade the footage as vintage Kodachrome film.',
          generation_seed: 7,
        },
        selectedPrompt: 'Re-grade the footage as vintage Kodachrome film.',
        suggestions: [
          {
            title: 'Kodachrome',
            prompt: 'Re-grade as vintage Kodachrome with soft halation.',
          },
          {
            title: 'Teal',
            prompt: 'Re-grade as cool teal cinema with fine grain.',
          },
          {
            title: 'Sepia',
            prompt: 'Re-grade as warm sepia with a gentle vignette.',
          },
        ],
      },
      modifyContext,
    );

    expect(validation).toMatchObject({ ok: true });
  });
});

function contextWithCurrentInput(
  currentInput: ChainAgentPromptContext['currentInput'],
  includeAdvancedFields = false,
): ChainAgentPromptContext {
  const properties = {
    generation_prompt: { type: 'string' },
    generation_duration: { type: 'number', minimum: 1, maximum: 8 },
    ...(includeAdvancedFields
      ? {
          generation_negative_prompt: { type: 'string' },
          generation_seed: { type: 'integer', minimum: 0, maximum: 2147483647 },
        }
      : {}),
  };

  return {
    currentInput,
    flow: {
      currentStepKey: 'image',
      mode: 'autopilot',
      nextStepKey: 'video',
    },
    nextStep: {
      modelIdentifier: includeAdvancedFields
        ? 'google/veo-3.1-fast'
        : 'google/veo-3.1-lite',
      requestParams: null,
      schema: {
        type: 'object',
        required: ['generation_prompt', 'generation_duration'],
        properties,
      },
      stepKey: 'video',
      stepKind: 'video',
    },
    previousStep: {
      modelIdentifier: 'bfl/flux-1.1-pro',
      outputFiles: [],
      requestParams: {
        generation_prompt:
          'A color film-inspired portrait of a young Japanese woman looking to the camera with a shallow depth of field that blurs the surrounding elements, drawing attention to her eyes.',
      },
      stepKey: 'image',
      stepKind: 'image',
    },
  };
}

function resultWithPrompt(
  {
    generationPrompt,
    selectedPrompt,
  }: {
    generationPrompt: string;
    selectedPrompt: string;
  },
  extraParams: Record<string, unknown> = {},
): Pick<ChainAgentResult, 'selectedParams' | 'selectedPrompt' | 'suggestions'> {
  return {
    selectedParams: {
      generation_duration: 4,
      generation_prompt: generationPrompt,
      ...extraParams,
    },
    selectedPrompt,
    suggestions: [
      { title: 'A', prompt: selectedPrompt, params: {} },
      {
        title: 'B',
        prompt: `${selectedPrompt} Camera drifts closer.`,
        params: {},
      },
      {
        title: 'C',
        prompt: `${selectedPrompt} Background bokeh shifts.`,
        params: {},
      },
    ],
  };
}
