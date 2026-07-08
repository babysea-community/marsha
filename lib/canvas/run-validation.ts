import {
  isChainWiredSemanticFieldName,
  modelSchemaCacheKey,
  type ChainSchemaStepRole,
} from '@/lib/models/chain-schema';

export type CanvasRunValidationField = {
  default?: unknown;
  min?: number;
  name: string;
  required?: boolean;
  type?: 'text' | 'textarea' | 'number' | 'select' | 'boolean';
  valueKind?: 'string' | 'number' | 'boolean' | 'string-array' | 'json';
};

export type CanvasRunValidationGroup = {
  advanced: readonly CanvasRunValidationField[];
  core: readonly CanvasRunValidationField[];
};

export type CanvasRunValidationNode = {
  data: {
    flowId: string;
    modelId: string;
    role: ChainSchemaStepRole;
    values: Record<string, unknown>;
  };
  type?: string;
};

export type CanvasRunValidationModel = {
  available: boolean;
  id: string;
  label: string;
  unavailableReason?: string | null;
};

export type CanvasFlowRunValidation =
  { ok: true; reason: null } | { ok: false; reason: string };

export function validateCanvasFlowRun({
  agentDownstreamInputs = false,
  fieldsByModel,
  flowNodes,
  models,
}: {
  agentDownstreamInputs?: boolean;
  fieldsByModel: Record<string, CanvasRunValidationGroup | undefined>;
  flowNodes: readonly CanvasRunValidationNode[];
  models: readonly CanvasRunValidationModel[];
}): CanvasFlowRunValidation {
  if (flowNodes.length === 0) {
    return blocked('A flow needs an image_model and a video_model to run.');
  }

  const roles = new Set(flowNodes.map((node) => node.data.role));

  if (!roles.has('image') || !roles.has('video')) {
    return blocked('A flow needs an image_model and a video_model to run.');
  }

  for (const node of flowNodes) {
    const model = models.find((entry) => entry.id === node.data.modelId);

    if (!model) {
      return blocked(
        `${node.data.modelId || `${node.data.role}_model`} is no longer in the catalog.`,
      );
    }

    if (!model.available) {
      return blocked(
        `${model.label} is unavailable. ${model.unavailableReason ?? 'This model is not available for the configured inference mode/API keys.'}`,
      );
    }

    const fieldGroup =
      fieldsByModel[modelSchemaCacheKey(node.data.role, node.data.modelId)];

    if (!fieldGroup) {
      return blocked(`Loading the ${node.data.role}_model schema.`);
    }

    const fields = [...fieldGroup.core, ...fieldGroup.advanced].filter(
      (field) => shouldValidateFieldForRole(field, node.data.role),
    );
    const agentWillPlanStep =
      agentDownstreamInputs && node.data.role !== 'image';

    if (agentWillPlanStep) {
      continue;
    }

    for (const field of fields) {
      const value = node.data.values[field.name];
      const requestValue = hasSelectedCanvasValue(field, value)
        ? value
        : field.default;

      if (isUnselectedSelectValue(field, value)) {
        return blocked(
          `Choose ${field.name} in the ${node.data.role}_model node.`,
        );
      }

      if (shouldBlockZeroValue(field) && isZeroValue(requestValue, field)) {
        return blocked(
          `${field.name} cannot be 0 in the ${node.data.role}_model node.`,
        );
      }

      if (isRequiredRunField(field) && !hasSelectedCanvasValue(field, value)) {
        return blocked(
          `Fill ${field.name} in the ${node.data.role}_model node.`,
        );
      }
    }
  }

  return { ok: true, reason: null };
}

function blocked(reason: string): CanvasFlowRunValidation {
  return { ok: false, reason };
}

function shouldValidateFieldForRole(
  field: CanvasRunValidationField,
  role: ChainSchemaStepRole,
) {
  return (
    role === 'image' ||
    !isChainWiredSemanticFieldName(field.name) ||
    (field.name === 'generation_input_video_file' && field.required === true) ||
    (role === 'modify' &&
      field.name === 'generation_input_image_file' &&
      field.required === true)
  );
}

function isRequiredRunField(field: CanvasRunValidationField) {
  return field.required === true || field.name === 'generation_prompt';
}

function meaningfulCanvasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.some((item) => meaningfulCanvasValue(item));
  }

  return true;
}

function hasSelectedCanvasValue(
  field: CanvasRunValidationField,
  value: unknown,
) {
  return meaningfulCanvasValue(value) && !isUnselectedSelectValue(field, value);
}

function isUnselectedSelectValue(
  field: CanvasRunValidationField,
  value: unknown,
) {
  return (
    field.type === 'select' &&
    typeof value === 'string' &&
    value.trim().toLowerCase() === 'select'
  );
}

function shouldBlockZeroValue(field: CanvasRunValidationField): boolean {
  return (
    field.valueKind === 'number' && field.min !== undefined && field.min > 0
  );
}

function isZeroValue(value: unknown, field: CanvasRunValidationField): boolean {
  if (value === 0) return true;

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (field.valueKind === 'number') {
      const numericValue = Number(trimmed);
      return Number.isFinite(numericValue) && numericValue === 0;
    }

    return trimmed === '0';
  }

  if (Array.isArray(value)) {
    return value.some((item) => isZeroValue(item, field));
  }

  return false;
}
