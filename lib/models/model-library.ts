import 'server-only';

import {
  MODEL_CATALOG,
  MODEL_LOOKUP_CATALOG,
  type ModelCatalogEntry,
  type ModelProvider,
} from './model-catalog';
import { getSemanticModel } from './semantic-schema';

export type ModelName = (typeof MODEL_CATALOG)[number]['modelIdentifier'];
export type ModelKey = (typeof MODEL_CATALOG)[number]['key'];

export type ModelRouting = {
  babyseaCompatible?: boolean;
  provider: ModelProvider;
  rawId: string;
};

export const MODEL_IDENTIFIER = Object.freeze(
  Object.fromEntries(
    MODEL_CATALOG.map((model) => [model.key, model.modelIdentifier]),
  ),
) as Readonly<Record<ModelKey, ModelName>>;

const MODEL_BY_IDENTIFIER: ReadonlyMap<string, ModelCatalogEntry> = new Map(
  MODEL_LOOKUP_CATALOG.map((model): [string, ModelCatalogEntry] => [
    model.modelIdentifier,
    model,
  ]),
);

export function lookupModel(modelName: string): ModelRouting | null {
  const model = MODEL_BY_IDENTIFIER.get(modelName as ModelName);

  if (!model) {
    return null;
  }

  return {
    provider: model.provider,
    rawId: getRawId(model),
    ...(model.babyseaCompatible === false ? { babyseaCompatible: false } : {}),
  };
}

export function lookupRawProviderModel(
  modelIdentifier: string,
): ModelRouting | null {
  const separatorIndex = modelIdentifier.indexOf('/');

  if (separatorIndex <= 0) {
    return null;
  }

  const provider = normalizeModelProvider(
    modelIdentifier.slice(0, separatorIndex),
  );
  const rawId = modelIdentifier.slice(separatorIndex + 1);

  if (!provider || !rawId) {
    return null;
  }

  const model: ModelCatalogEntry | undefined = MODEL_CATALOG.find(
    (entry) => entry.provider === provider && entry.rawId === rawId,
  );

  if (!model) {
    return null;
  }

  return {
    provider: model.provider,
    rawId: model.rawId,
    ...(model.babyseaCompatible === false ? { babyseaCompatible: false } : {}),
  };
}

export function listRegisteredModels(): ModelName[] {
  return MODEL_CATALOG.map((model) => model.modelIdentifier);
}

export function listModelCatalog(): ModelCatalogEntry[] {
  return MODEL_CATALOG.map((model) => ({ ...model }));
}

export function getModelCatalogEntry(modelIdentifier: string) {
  return MODEL_BY_IDENTIFIER.get(modelIdentifier as ModelName) ?? null;
}

export function listModelSchemaSummaries() {
  return MODEL_CATALOG.map((entry) => {
    const model: ModelCatalogEntry = entry;

    return {
      object: 'model' as const,
      id: model.modelIdentifier,
      provider: model.provider,
      kind: model.kind,
      raw_id: model.rawId,
      modes: getModelModes(model),
      has_byok_schema: true,
      schema_url: `/api/v1/models/${model.modelIdentifier}`,
    };
  });
}

export function getModelSchema(modelIdentifier: string) {
  const model = getModelCatalogEntry(modelIdentifier);

  if (!model) {
    return null;
  }

  const semanticModel = getSemanticModel(
    model.semanticModelIdentifier ?? model.modelIdentifier,
  );

  return {
    object: 'model_schema' as const,
    id: model.modelIdentifier,
    provider: model.provider,
    kind: model.kind,
    raw_id: model.rawId,
    modes: getModelModes(model),
    ...(semanticModel
      ? {
          byok_schema: {
            source: 'semantic-lady' as const,
            provider_model: semanticModel.providerModel,
            workflows: semanticModel.workflows,
            fields: semanticModel.schema,
          },
        }
      : {}),
  };
}

function getModelModes(model: ModelCatalogEntry) {
  return model.babyseaCompatible === false
    ? (['byok'] as const)
    : (['babysea', 'byok'] as const);
}

function getRawId(model: ModelCatalogEntry) {
  if (model.provider !== 'byteplus') {
    return model.rawId;
  }

  const override = process.env[`BYTEPLUS_ENDPOINT_${model.key}`]?.trim();

  return override || model.rawId;
}

function normalizeModelProvider(value: string): ModelProvider | null {
  if (value === 'alibabacloud' || value === 'alibaba-cloud') {
    return 'alibaba-cloud';
  }

  if (value === 'bfl' || value === 'black-forest-labs') {
    return 'black-forest-labs';
  }

  if (value === 'byteplus') {
    return 'byteplus';
  }

  if (value === 'google') {
    return 'google';
  }

  if (value === 'openai') {
    return 'openai';
  }

  if (value === 'runway') {
    return 'runway';
  }

  return null;
}
