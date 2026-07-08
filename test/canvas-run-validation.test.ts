import { describe, expect, it } from 'vitest';

import {
  validateCanvasFlowRun,
  type CanvasRunValidationGroup,
  type CanvasRunValidationNode,
} from '@/lib/canvas/run-validation';
import { modelSchemaCacheKey } from '@/lib/models/chain-schema';

const models = [
  {
    available: true,
    id: 'bfl/flux-2-max',
    label: 'Flux 2 Max',
  },
  {
    available: true,
    id: 'google/veo-3.1',
    label: 'Veo 3.1',
  },
];

const fluxFields: CanvasRunValidationGroup = {
  core: [
    { name: 'generation_prompt', required: true, valueKind: 'string' },
    { default: 0, min: 64, name: 'generation_width', valueKind: 'number' },
    { default: 0, min: 64, name: 'generation_height', valueKind: 'number' },
  ],
  advanced: [
    { default: false, name: 'generation_moderation', valueKind: 'boolean' },
    { default: 0, min: 0, name: 'generation_priority', valueKind: 'number' },
  ],
};

const veoFields: CanvasRunValidationGroup = {
  core: [
    { name: 'generation_prompt', required: true, valueKind: 'string' },
    {
      name: 'generation_input_image_file',
      required: true,
      valueKind: 'string-array',
    },
  ],
  advanced: [],
};

const fieldsByModel = {
  [modelSchemaCacheKey('image', 'bfl/flux-2-max')]: fluxFields,
  [modelSchemaCacheKey('video', 'google/veo-3.1')]: veoFields,
};

const fieldsByModelWithRequiredSelect = {
  ...fieldsByModel,
  [modelSchemaCacheKey('image', 'bfl/flux-2-max')]: {
    ...fluxFields,
    core: [
      ...fluxFields.core,
      {
        name: 'generation_aspect_ratio',
        required: true,
        type: 'select' as const,
        valueKind: 'string' as const,
      },
    ],
  },
};

function flowNodes(
  imageValues: Record<string, unknown>,
  videoValues: Record<string, unknown>,
): CanvasRunValidationNode[] {
  return [
    {
      type: 'model',
      data: {
        flowId: 'flow_1',
        modelId: 'bfl/flux-2-max',
        role: 'image',
        values: imageValues,
      },
    },
    {
      type: 'model',
      data: {
        flowId: 'flow_1',
        modelId: 'google/veo-3.1',
        role: 'video',
        values: videoValues,
      },
    },
  ];
}

describe('canvas run validation', () => {
  it('blocks both run actions until required prompts are filled', () => {
    expect(
      validateCanvasFlowRun({
        fieldsByModel,
        flowNodes: flowNodes(
          { generation_width: 1280, generation_height: 720 },
          { generation_prompt: 'Animate the frame' },
        ),
        models,
      }),
    ).toMatchObject({
      ok: false,
      reason: 'Fill generation_prompt in the image_model node.',
    });
  });

  it('blocks numeric zero defaults before a provider run starts', () => {
    expect(
      validateCanvasFlowRun({
        fieldsByModel,
        flowNodes: flowNodes(
          { generation_prompt: 'A product photo', generation_height: 720 },
          { generation_prompt: 'Animate the frame' },
        ),
        models,
      }),
    ).toMatchObject({
      ok: false,
      reason: 'generation_width cannot be 0 in the image_model node.',
    });
  });

  it('blocks string zero values from form inputs', () => {
    expect(
      validateCanvasFlowRun({
        fieldsByModel,
        flowNodes: flowNodes(
          {
            generation_prompt: 'A product photo',
            generation_width: '0',
            generation_height: 720,
          },
          { generation_prompt: 'Animate the frame' },
        ),
        models,
      }),
    ).toMatchObject({
      ok: false,
      reason: 'generation_width cannot be 0 in the image_model node.',
    });
  });

  it('blocks numeric string values that normalize to zero', () => {
    expect(
      validateCanvasFlowRun({
        fieldsByModel,
        flowNodes: flowNodes(
          {
            generation_prompt: 'A product photo',
            generation_width: '0.0',
            generation_height: 720,
          },
          { generation_prompt: 'Animate the frame' },
        ),
        models,
      }),
    ).toMatchObject({
      ok: false,
      reason: 'generation_width cannot be 0 in the image_model node.',
    });
  });

  it('blocks select placeholders before a provider run starts', () => {
    expect(
      validateCanvasFlowRun({
        fieldsByModel: fieldsByModelWithRequiredSelect,
        flowNodes: flowNodes(
          {
            generation_aspect_ratio: 'Select',
            generation_height: 720,
            generation_prompt: 'A product photo',
            generation_width: 1280,
          },
          { generation_prompt: 'Animate the frame' },
        ),
        models,
      }),
    ).toMatchObject({
      ok: false,
      reason: 'Choose generation_aspect_ratio in the image_model node.',
    });
  });

  it('does not treat boolean false as an invalid zero value', () => {
    expect(
      validateCanvasFlowRun({
        fieldsByModel,
        flowNodes: flowNodes(
          {
            generation_height: 720,
            generation_moderation: false,
            generation_prompt: 'A product photo',
            generation_width: 1280,
          },
          { generation_prompt: 'Animate the frame' },
        ),
        models,
      }),
    ).toEqual({ ok: true, reason: null });
  });

  it('allows documented numeric zero values when the schema minimum is zero', () => {
    expect(
      validateCanvasFlowRun({
        fieldsByModel,
        flowNodes: flowNodes(
          {
            generation_height: 720,
            generation_priority: 0,
            generation_prompt: 'A product photo',
            generation_width: 1280,
          },
          { generation_prompt: 'Animate the frame' },
        ),
        models,
      }),
    ).toEqual({ ok: true, reason: null });
  });

  it('ignores downstream required media fields that are supplied by the chain', () => {
    expect(
      validateCanvasFlowRun({
        fieldsByModel,
        flowNodes: flowNodes(
          {
            generation_height: 720,
            generation_prompt: 'A product photo',
            generation_width: 1280,
          },
          { generation_prompt: 'Animate the frame' },
        ),
        models,
      }),
    ).toEqual({ ok: true, reason: null });
  });

  it('allows agent modes to run with blank downstream fields', () => {
    expect(
      validateCanvasFlowRun({
        agentDownstreamInputs: true,
        fieldsByModel,
        flowNodes: flowNodes(
          {
            generation_height: 720,
            generation_prompt: 'A product photo',
            generation_width: 1280,
          },
          {},
        ),
        models,
      }),
    ).toEqual({ ok: true, reason: null });
  });
});
