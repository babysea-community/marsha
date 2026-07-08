import 'server-only';

import {
  listModels,
  type SemanticLadyModel,
  type SemanticLadyModelKind,
  type SemanticLadyProvider,
  type SemanticLadyWorkflow,
} from 'semantic-lady';

import {
  isMediaDrivenBaseModelIdentifier,
  listMediaDrivenModelVariants,
  type MediaDrivenVariantInputKind,
} from './media-driven-variants';

export type ModelProvider = SemanticLadyProvider;
export type ModelKind = SemanticLadyModelKind;
export type ModelMode = 'babysea' | 'byok';

export type ModelCatalogEntry = {
  babyseaCompatible?: boolean;
  key: string;
  kind: ModelKind;
  mediaInputKind?: MediaDrivenVariantInputKind;
  modelIdentifier: string;
  provider: ModelProvider;
  rawId: string;
  semanticModelIdentifier?: string;
  uiName: string;
  workflows: readonly SemanticLadyWorkflow[];
};

const BABYSEA_COMPATIBLE_ALIBABA_MODELS = new Set(['qwen/image']);
const BYOK_ONLY_BYTEPLUS_MODELS = new Set([
  'bytedance/seedance-2.0',
  'bytedance/seedance-2.0-fast',
]);

// Act Two and Wan Animate are temporarily excluded from the the app catalog;
// they will return later as dedicated card types.
const EXCLUDED_BASE_MODEL_IDENTIFIERS = new Set([
  'runway/act-two',
  'wan/2.2-animate-mix',
  'wan/2.2-animate-move',
]);

export const MODEL_CATALOG = listModels()
  .filter((model) => !EXCLUDED_BASE_MODEL_IDENTIFIERS.has(model.apiName))
  .flatMap((model) => {
    if (!isMediaDrivenBaseModelIdentifier(model.apiName)) {
      return [toCatalogEntry(model)];
    }

    return listMediaDrivenModelVariants()
      .filter((variant) => variant.baseModelIdentifier === model.apiName)
      .map((variant) =>
        toCatalogEntry(model, {
          mediaInputKind: variant.inputKind,
          modelIdentifier: variant.modelIdentifier,
          semanticModelIdentifier: variant.baseModelIdentifier,
          uiName: `${model.uiName} (${formatVariantInputKind(
            variant.inputKind,
          )})`,
        }),
      );
  });

export const MODEL_LOOKUP_CATALOG = MODEL_CATALOG;

function toCatalogEntry(
  model: SemanticLadyModel,
  options: {
    mediaInputKind?: MediaDrivenVariantInputKind;
    modelIdentifier?: string;
    semanticModelIdentifier?: string;
    uiName?: string;
  } = {},
): ModelCatalogEntry {
  const modelIdentifier = options.modelIdentifier ?? model.apiName;

  return {
    key: modelKey(modelIdentifier),
    kind: model.kind,
    modelIdentifier,
    provider: model.provider,
    rawId: model.providerModel,
    uiName: options.uiName ?? model.uiName,
    workflows: model.workflows,
    ...(options.mediaInputKind
      ? { mediaInputKind: options.mediaInputKind }
      : {}),
    ...(options.semanticModelIdentifier
      ? { semanticModelIdentifier: options.semanticModelIdentifier }
      : {}),
    ...(isBabySeaCompatible(model) ? {} : { babyseaCompatible: false }),
  };
}

function formatVariantInputKind(inputKind: MediaDrivenVariantInputKind) {
  return inputKind === 'image' ? 'Image' : 'Video';
}

function isBabySeaCompatible(model: SemanticLadyModel) {
  switch (model.provider) {
    case 'alibaba-cloud':
      return BABYSEA_COMPATIBLE_ALIBABA_MODELS.has(model.apiName);
    case 'byteplus':
      return !BYOK_ONLY_BYTEPLUS_MODELS.has(model.apiName);
    case 'google':
    case 'openai':
    case 'runway':
      return false;
    case 'black-forest-labs':
      return true;
  }
}

function modelKey(modelIdentifier: string) {
  return modelIdentifier
    .replace(/\./g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
