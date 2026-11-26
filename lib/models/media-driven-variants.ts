export type MediaDrivenVariantInputKind = 'image' | 'video';

export type MediaDrivenCallerMediaField =
  'generation_input_image_file' | 'generation_input_video_file';

export type MediaDrivenChainRole = 'video' | 'modify';

export type MediaDrivenModelVariant = {
  baseModelIdentifier: string;
  inputKind: MediaDrivenVariantInputKind;
  modelIdentifier: string;
  requiredCallerMediaField: MediaDrivenCallerMediaField;
  role: MediaDrivenChainRole;
};

// Act Two and Wan Animate are temporarily removed from the app; they will be
// reintroduced later as dedicated card types. Emptying these arrays neutralizes
// the variant machinery without deleting it, so the wiring can be restored when
// the new card types land.
const MEDIA_DRIVEN_BASE_MODEL_IDENTIFIERS = new Set<string>();

const MEDIA_DRIVEN_MODEL_VARIANTS: readonly MediaDrivenModelVariant[] = [];

const MEDIA_DRIVEN_MODEL_VARIANT_BY_IDENTIFIER: ReadonlyMap<
  string,
  MediaDrivenModelVariant
> = new Map(
  MEDIA_DRIVEN_MODEL_VARIANTS.map((variant) => [
    variant.modelIdentifier,
    variant,
  ]),
);

export function listMediaDrivenModelVariants() {
  return [...MEDIA_DRIVEN_MODEL_VARIANTS];
}

export function isMediaDrivenBaseModelIdentifier(modelIdentifier: string) {
  return MEDIA_DRIVEN_BASE_MODEL_IDENTIFIERS.has(modelIdentifier);
}

export function getMediaDrivenModelVariant(modelIdentifier: string) {
  return MEDIA_DRIVEN_MODEL_VARIANT_BY_IDENTIFIER.get(modelIdentifier) ?? null;
}

export function resolveSemanticModelIdentifier(modelIdentifier: string) {
  return (
    getMediaDrivenModelVariant(modelIdentifier)?.baseModelIdentifier ??
    modelIdentifier
  );
}

export function getMediaDrivenRequiredCallerField(
  modelIdentifier: string,
  role: MediaDrivenChainRole,
): MediaDrivenCallerMediaField | null {
  const variant = getMediaDrivenModelVariant(modelIdentifier);

  if (variant) {
    return variant.role === role ? variant.requiredCallerMediaField : null;
  }

  return null;
}
