export const CHAIN_STEP_ROLES = ['image', 'refine', 'video', 'modify'] as const;

export type ChainSchemaStepRole = (typeof CHAIN_STEP_ROLES)[number];
export type SemanticChainFieldMode = 'initial' | 'downstream';

export function chainFieldModeForRole(
  role: ChainSchemaStepRole,
): SemanticChainFieldMode {
  return role === 'image' ? 'initial' : 'downstream';
}

export function modelSchemaCacheKey(
  role: ChainSchemaStepRole,
  modelIdentifier: string,
) {
  return `${role}:${modelIdentifier}`;
}

export function isChainWiredSemanticFieldName(fieldName: string): boolean {
  return (
    fieldName === 'generation_input_image_file' ||
    fieldName === 'generation_input_video_file' ||
    fieldName === 'generation_last_frame'
  );
}

export function filterChainSchemaFields<TField extends { name: string }>(
  fields: readonly TField[],
  role: ChainSchemaStepRole,
  options: {
    allowInputImageFile?: boolean;
    allowInputVideoFile?: boolean;
  } = {},
): TField[] {
  if (chainFieldModeForRole(role) === 'initial') {
    return [...fields];
  }

  return fields.filter(
    (field) =>
      !isChainWiredSemanticFieldName(field.name) ||
      (options.allowInputImageFile === true &&
        field.name === 'generation_input_image_file') ||
      (options.allowInputVideoFile === true &&
        field.name === 'generation_input_video_file'),
  );
}
