import { describe, expect, it } from 'vitest';

import {
  getModelChainCatalogEntry,
  listModelChainCatalog,
} from '@/lib/chains/catalog';
import {
  isImageInputCapableModel,
  isImageToVideoChainModel,
  isVideoToVideoChainModel,
} from '@/lib/models/semantic-schema';
import { formatPublicModelName } from '@/lib/models/display';
import { listModelCatalog } from '@/lib/models/model-library';

describe('model chain catalog', () => {
  it('builds chain cards for every valid model combination', () => {
    const models = listModelCatalog();
    const imageModels = models.filter((model) => model.kind === 'image');
    const refineModels = imageModels.filter((model) =>
      isImageInputCapableModel(model.modelIdentifier),
    );
    const videoModels = models.filter((model) =>
      isImageToVideoChainModel(model.modelIdentifier),
    );
    const modifyModels = models.filter((model) =>
      isVideoToVideoChainModel(model.modelIdentifier),
    );
    const compatibleVideoModifyPairs = videoModels.flatMap((videoModel) =>
      modifyModels
        .filter((modifyModel) =>
          canModifyVideoOutput({ modifyModel, videoModel }),
        )
        .map((modifyModel) => ({ modifyModel, videoModel })),
    );
    const catalog = listModelChainCatalog();
    const modelEntries = catalog;
    const imageVideoEntries = modelEntries.filter(
      (entry) => !hasRefineModel(entry) && !hasModifyModel(entry),
    );
    const imageRefineVideoEntries = modelEntries.filter(
      (entry) => hasRefineModel(entry) && !hasModifyModel(entry),
    );
    const imageVideoModifyEntries = modelEntries.filter(
      (entry) => !hasRefineModel(entry) && hasModifyModel(entry),
    );
    const imageRefineVideoModifyEntries = modelEntries.filter(
      (entry) => hasRefineModel(entry) && hasModifyModel(entry),
    );
    const expectedImageVideoCount = imageModels.length * videoModels.length;
    const expectedImageRefineVideoCount =
      imageModels.length * refineModels.length * videoModels.length;
    const expectedImageVideoModifyCount =
      imageModels.length * compatibleVideoModifyPairs.length;
    const expectedImageRefineVideoModifyCount =
      imageModels.length *
      refineModels.length *
      compatibleVideoModifyPairs.length;

    expect(imageVideoEntries).toHaveLength(expectedImageVideoCount);
    expect(imageRefineVideoEntries).toHaveLength(expectedImageRefineVideoCount);
    expect(imageVideoModifyEntries).toHaveLength(expectedImageVideoModifyCount);
    expect(imageRefineVideoModifyEntries).toHaveLength(
      expectedImageRefineVideoModifyCount,
    );
    expect(modelEntries).toHaveLength(
      expectedImageVideoCount +
        expectedImageRefineVideoCount +
        expectedImageVideoModifyCount +
        expectedImageRefineVideoModifyCount,
    );
    expect(catalog).toHaveLength(modelEntries.length);
    expect(new Set(modelEntries.map((entry) => entry.slug)).size).toBe(
      modelEntries.length,
    );

    const catalogChains = new Set(
      modelEntries.map((entry) => entry.modelIdentifiers.join(' → ')),
    );

    expect(
      catalogChains.has('bfl/flux-1.1-pro → bytedance/seedance-1.5-pro'),
    ).toBe(true);
    expect(
      catalogChains.has(
        'bfl/flux-1.1-pro → bytedance/seedream-5-lite → bytedance/seedance-1.5-pro',
      ),
    ).toBe(true);
    expect(
      catalogChains.has(
        'bfl/flux-1.1-pro → runway/gen-4-turbo → runway/aleph-2',
      ),
    ).toBe(true);
    expect(catalogChains.has('bfl/flux-1.1-pro → runway/aleph-2')).toBe(false);
    expect(
      catalogChains.has(
        'bfl/flux-1.1-pro → wan/2.7-i2v-2026-04-25 → wan/2.7-videoedit',
      ),
    ).toBe(true);
    expect(catalogChains.has('bfl/flux-1.1-pro → wan/2.7-videoedit')).toBe(
      false,
    );
    expect(catalogChains.has('bfl/flux-1.1-pro → wan/2.7-t2v')).toBe(false);
    expect(catalogChains.has('bfl/flux-1.1-pro → happyhorse/1.0-t2v')).toBe(
      false,
    );
    expect(
      catalogChains.has('bfl/flux-1.1-pro → happyhorse/1.0-video-edit'),
    ).toBe(false);
    expect(catalogChains.has('bfl/flux-1.1-pro → wan/2.2-animate-mix')).toBe(
      false,
    );
    expect(
      catalogChains.has('bfl/flux-1.1-pro → wan/2.2-animate-mix-image'),
    ).toBe(false);
    expect(
      catalogChains.has(
        'bfl/flux-1.1-pro → runway/gen-4-turbo → wan/2.2-animate-mix-video',
      ),
    ).toBe(false);
    expect(
      catalogChains.has(
        'bfl/flux-1.1-pro → google/veo-3.1-lite → wan/2.7-videoedit',
      ),
    ).toBe(false);
    expect(
      catalogChains.has(
        'bfl/flux-1.1-pro → google/veo-3.1-lite → runway/aleph-2',
      ),
    ).toBe(true);

    expect(isSortedByFirstModelName(modelEntries)).toBe(true);

    // The count assertions above already validate every combination exists.
    // Deep-validate only a few representative entries (one per chain shape,
    // plus the first and last) so this stays fast instead of looping all
    // 67k+ combinations.
    const sampleEntries = [
      modelEntries[0]!,
      modelEntries[modelEntries.length - 1]!,
      imageVideoEntries[0]!,
      imageRefineVideoEntries[0]!,
      imageVideoModifyEntries[0]!,
      imageRefineVideoModifyEntries[0]!,
    ].filter(Boolean);

    for (const entry of sampleEntries) {
      expect(entry.href).toBe('/templates');
      expect(entry.templateSlug).toBe('chain');
      expect(entry.routeLabel).toBe('/api/v1/chains/runs');
      expect(entry.defaultInput.image_model).toBe(entry.modelIdentifiers[0]);

      const expectedSteps = [
        'image',
        ...(hasRefineModel(entry) ? ['refine'] : []),
        'video',
        ...(hasModifyModel(entry) ? ['modify'] : []),
      ];
      let modelIndex = 1;

      expect(entry.steps).toEqual(expectedSteps);

      if (hasRefineModel(entry)) {
        expect(entry.defaultInput.refine_model).toBe(
          entry.modelIdentifiers[modelIndex],
        );
        expect(
          isImageInputCapableModel(entry.modelIdentifiers[modelIndex]!),
        ).toBe(true);
        modelIndex += 1;
      } else {
        expect(entry.defaultInput).not.toHaveProperty('refine_model');
      }

      expect(entry.defaultInput.video_model).toBe(
        entry.modelIdentifiers[modelIndex],
      );
      modelIndex += 1;

      if (hasModifyModel(entry)) {
        expect(entry.defaultInput.modify_model).toBe(
          entry.modelIdentifiers[modelIndex],
        );
      } else {
        expect(entry.defaultInput).not.toHaveProperty('modify_model');
      }

      expect(getModelChainCatalogEntry(entry.slug)?.modelIdentifiers).toEqual(
        entry.modelIdentifiers,
      );
    }
  }, 15000);
});

function hasRefineModel(entry: { defaultInput: Record<string, unknown> }) {
  return typeof entry.defaultInput.refine_model === 'string';
}

function hasModifyModel(entry: { defaultInput: Record<string, unknown> }) {
  return typeof entry.defaultInput.modify_model === 'string';
}

function canModifyVideoOutput({
  modifyModel,
  videoModel,
}: {
  modifyModel: { provider: string };
  videoModel: { provider: string };
}) {
  return !(
    videoModel.provider === 'google' &&
    (modifyModel.provider === 'alibaba-cloud' ||
      modifyModel.provider === 'byteplus')
  );
}

function isSortedByFirstModelName(
  entries: Array<{ modelIdentifiers: string[] }>,
) {
  return entries.every((entry, index) => {
    const previous = entries[index - 1];

    if (!previous) {
      return true;
    }

    const previousName = formatPublicModelName(previous.modelIdentifiers[0]!);
    const currentName = formatPublicModelName(entry.modelIdentifiers[0]!);

    return previousName.localeCompare(currentName) <= 0;
  });
}
