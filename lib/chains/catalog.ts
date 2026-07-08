import 'server-only';

import { formatPublicModelName } from '@/lib/models/display';
import { listModelCatalog } from '@/lib/models/model-library';
import {
  isImageInputCapableModel,
  isImageToVideoChainModel,
  isVideoToVideoChainModel,
} from '@/lib/models/semantic-schema';

import { getChainTemplate, selectChainTemplateSteps } from './templates';

export type ModelChainCatalogEntry = {
  accent: string;
  actionLabel: string;
  badge: string;
  defaultInput: Record<string, unknown>;
  description: string;
  href: string;
  imageSrc: string;
  modelIdentifiers: string[];
  rank: string;
  routeLabel: string;
  slug: string;
  steps: string[];
  templateSlug: string;
  title: string;
};

export type ModelChainCatalogGridEntry = Pick<
  ModelChainCatalogEntry,
  | 'accent'
  | 'actionLabel'
  | 'badge'
  | 'href'
  | 'imageSrc'
  | 'modelIdentifiers'
  | 'routeLabel'
  | 'slug'
  | 'title'
>;

export type ModelChainCatalogPage = {
  entries: ModelChainCatalogGridEntry[];
  page: number;
  pageSize: number;
  query: string;
  total: number;
};

const CARD_IMAGE_SRC =
  'https://imagedelivery.net/ub24fjUytZQ3JbssUo49_w/97d9a23a-2a4e-4543-4b3b-199516ad6c00/1280x720';
const DEFAULT_CARD_ACCENT = '#1773cf';
const CARD_GRID_COLUMNS = 5;
const CARD_ACCENTS = [
  DEFAULT_CARD_ACCENT,
  '#318f55',
  '#9933cc',
  '#d98026',
  '#d9467a',
] as const;
const CARD_ACTION_LABEL = 'Use this template';

let modelChainCatalogCache: ModelChainCatalogEntry[] | null = null;
let modelChainCatalogSearchCache: Map<string, string> | null = null;
let modelChainCatalogEntryBySlugCache: Map<
  string,
  ModelChainCatalogEntry
> | null = null;

export function listModelChainCatalog(options: { limit?: number } = {}) {
  const entries = getModelChainCatalogEntries();

  return typeof options.limit === 'number'
    ? entries.slice(0, options.limit)
    : [...entries];
}

export function listModelChainCatalogPage({
  page = 1,
  pageSize = 25,
  query = '',
}: {
  page?: number;
  pageSize?: number;
  query?: string;
}): ModelChainCatalogPage {
  const normalizedQuery = query.trim().slice(0, 120).toLowerCase();
  const safePageSize = clampInteger(pageSize, 1, 100, 25);
  const entries = getModelChainCatalogEntries();
  const searchTextBySlug = getModelChainCatalogSearchTextBySlug();
  const filteredEntries = normalizedQuery
    ? entries.filter((entry) =>
        searchTextBySlug.get(entry.slug)?.includes(normalizedQuery),
      )
    : entries;
  const pageCount = Math.max(
    1,
    Math.ceil(filteredEntries.length / safePageSize),
  );
  const safePage = clampInteger(page, 1, pageCount, 1);
  const start = (safePage - 1) * safePageSize;

  return {
    entries: filteredEntries
      .slice(start, start + safePageSize)
      .map(toGridEntry),
    page: safePage,
    pageSize: safePageSize,
    query: normalizedQuery,
    total: filteredEntries.length,
  };
}

export function getModelChainCatalogEntry(slug: string) {
  getModelChainCatalogEntries();

  return modelChainCatalogEntryBySlugCache?.get(slug) ?? null;
}

function toGridEntry(
  entry: ModelChainCatalogEntry,
): ModelChainCatalogGridEntry {
  return {
    accent: entry.accent,
    actionLabel: entry.actionLabel,
    badge: entry.badge,
    href: entry.href,
    imageSrc: entry.imageSrc,
    modelIdentifiers: entry.modelIdentifiers,
    routeLabel: entry.routeLabel,
    slug: entry.slug,
    title: entry.title,
  };
}

function createModelChainSearchText(entry: ModelChainCatalogEntry) {
  return [
    entry.badge,
    entry.routeLabel,
    entry.title,
    ...entry.modelIdentifiers,
    ...entry.modelIdentifiers.map(formatPublicModelName),
  ]
    .join(' ')
    .toLowerCase();
}

function getModelChainCatalogSearchTextBySlug() {
  if (modelChainCatalogSearchCache) {
    return modelChainCatalogSearchCache;
  }

  modelChainCatalogSearchCache = new Map(
    getModelChainCatalogEntries().map((entry) => [
      entry.slug,
      createModelChainSearchText(entry),
    ]),
  );

  return modelChainCatalogSearchCache;
}

function clampInteger(
  value: number,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  return Number.isInteger(value)
    ? Math.min(Math.max(value, minimum), maximum)
    : fallback;
}

function getModelChainCatalogEntries() {
  if (modelChainCatalogCache) {
    return modelChainCatalogCache;
  }

  const entries = modelEntries();
  const uniqueEntries = Array.from(
    new Map(
      entries.map((entry): [string, ModelChainCatalogEntry] => [
        entry.slug,
        entry,
      ]),
    ).values(),
  );

  const accentedEntries = uniqueEntries.map((entry, index) => ({
    ...entry,
    accent: accentForCatalogIndex(index),
  }));

  modelChainCatalogCache = accentedEntries;
  modelChainCatalogEntryBySlugCache = new Map(
    accentedEntries.map((entry) => [entry.slug, entry]),
  );

  return accentedEntries;
}

function modelEntries(): ModelChainCatalogEntry[] {
  const models = listModelCatalog();
  const imageModels = sortModelsByPublicName(
    models.filter((model) => model.kind === 'image'),
  );
  const refineModels = imageModels.filter((model) =>
    isImageInputCapableModel(model.modelIdentifier),
  );
  const videoModels = sortModelsByPublicName(
    models.filter((model) => isImageToVideoChainModel(model.modelIdentifier)),
  );
  const modifyModels = sortModelsByPublicName(
    models.filter((model) => isVideoToVideoChainModel(model.modelIdentifier)),
  );

  return imageModels.flatMap((imageModel) => {
    const twoModelEntries = videoModels.map((videoModel) =>
      createEntry({
        badge: providerBadge([imageModel.provider, videoModel.provider]),
        defaultInput: defaultInputForTemplate({
          imageModel: imageModel.modelIdentifier,
          videoModel: videoModel.modelIdentifier,
        }),
        imageSrc: CARD_IMAGE_SRC,
        modelIdentifiers: [
          imageModel.modelIdentifier,
          videoModel.modelIdentifier,
        ],
        templateSlug: 'chain',
        title: modelTitle([
          imageModel.modelIdentifier,
          videoModel.modelIdentifier,
        ]),
        description: `Run ${formatPublicModelName(
          imageModel.modelIdentifier,
        )} as the image step, then pass the output URL into ${formatPublicModelName(
          videoModel.modelIdentifier,
        )} for video generation.`,
      }),
    );
    const twoModelModifyEntries = videoModels.flatMap((videoModel) =>
      modifyModels
        .filter((modifyModel) =>
          canModifyVideoOutput({ modifyModel, videoModel }),
        )
        .map((modifyModel) =>
          createEntry({
            badge: providerBadge([
              imageModel.provider,
              videoModel.provider,
              modifyModel.provider,
            ]),
            defaultInput: defaultInputForTemplate({
              imageModel: imageModel.modelIdentifier,
              videoModel: videoModel.modelIdentifier,
              modifyModel: modifyModel.modelIdentifier,
            }),
            imageSrc: CARD_IMAGE_SRC,
            modelIdentifiers: [
              imageModel.modelIdentifier,
              videoModel.modelIdentifier,
              modifyModel.modelIdentifier,
            ],
            templateSlug: 'chain',
            title: modelTitle([
              imageModel.modelIdentifier,
              videoModel.modelIdentifier,
              modifyModel.modelIdentifier,
            ]),
            description: `Run ${formatPublicModelName(
              imageModel.modelIdentifier,
            )} as the image step, pass the output URL into ${formatPublicModelName(
              videoModel.modelIdentifier,
            )}, then modify the video with ${formatPublicModelName(
              modifyModel.modelIdentifier,
            )}.`,
          }),
        ),
    );
    const threeModelEntries = refineModels.flatMap((refineModel) =>
      videoModels.map((videoModel) =>
        createEntry({
          badge: providerBadge([
            imageModel.provider,
            refineModel.provider,
            videoModel.provider,
          ]),
          defaultInput: defaultInputForTemplate({
            imageModel: imageModel.modelIdentifier,
            refineModel: refineModel.modelIdentifier,
            videoModel: videoModel.modelIdentifier,
          }),
          imageSrc: CARD_IMAGE_SRC,
          modelIdentifiers: [
            imageModel.modelIdentifier,
            refineModel.modelIdentifier,
            videoModel.modelIdentifier,
          ],
          templateSlug: 'chain',
          title: modelTitle([
            imageModel.modelIdentifier,
            refineModel.modelIdentifier,
            videoModel.modelIdentifier,
          ]),
          description: `Run ${formatPublicModelName(
            imageModel.modelIdentifier,
          )}, refine its output with ${formatPublicModelName(
            refineModel.modelIdentifier,
          )}, then pass the final image URL into ${formatPublicModelName(
            videoModel.modelIdentifier,
          )} for video generation.`,
        }),
      ),
    );
    const threeModelModifyEntries = refineModels.flatMap((refineModel) =>
      videoModels.flatMap((videoModel) =>
        modifyModels
          .filter((modifyModel) =>
            canModifyVideoOutput({ modifyModel, videoModel }),
          )
          .map((modifyModel) =>
            createEntry({
              badge: providerBadge([
                imageModel.provider,
                refineModel.provider,
                videoModel.provider,
                modifyModel.provider,
              ]),
              defaultInput: defaultInputForTemplate({
                imageModel: imageModel.modelIdentifier,
                refineModel: refineModel.modelIdentifier,
                videoModel: videoModel.modelIdentifier,
                modifyModel: modifyModel.modelIdentifier,
              }),
              imageSrc: CARD_IMAGE_SRC,
              modelIdentifiers: [
                imageModel.modelIdentifier,
                refineModel.modelIdentifier,
                videoModel.modelIdentifier,
                modifyModel.modelIdentifier,
              ],
              templateSlug: 'chain',
              title: modelTitle([
                imageModel.modelIdentifier,
                refineModel.modelIdentifier,
                videoModel.modelIdentifier,
                modifyModel.modelIdentifier,
              ]),
              description: `Run ${formatPublicModelName(
                imageModel.modelIdentifier,
              )}, refine its output with ${formatPublicModelName(
                refineModel.modelIdentifier,
              )}, pass the final image URL into ${formatPublicModelName(
                videoModel.modelIdentifier,
              )}, then modify the video with ${formatPublicModelName(
                modifyModel.modelIdentifier,
              )}.`,
            }),
          ),
      ),
    );

    return [
      ...twoModelEntries,
      ...twoModelModifyEntries,
      ...threeModelEntries,
      ...threeModelModifyEntries,
    ];
  });
}

/**
 * Google video models return data-video URIs, which Alibaba Cloud and
 * BytePlus video-to-video inputs reject (public URLs only). Mirrors the
 * template-layer handoff guard.
 */
export function canModifyVideoOutput({
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

function createEntry({
  badge,
  defaultInput,
  description,
  imageSrc,
  modelIdentifiers,
  templateSlug,
  title,
}: {
  badge: string;
  defaultInput: Record<string, unknown>;
  description: string;
  imageSrc: string;
  modelIdentifiers: string[];
  templateSlug: string;
  title: string;
}): ModelChainCatalogEntry {
  const template = getChainTemplate(templateSlug);

  if (!template) {
    throw new Error(`Unknown the app template: ${templateSlug}`);
  }

  const slug = modelIdentifiers.map(slugify).join('--');
  const selectedSteps = selectChainTemplateSteps(template, defaultInput);

  return {
    accent: accentForSlug(slug),
    actionLabel: CARD_ACTION_LABEL,
    badge,
    defaultInput,
    description,
    href: '/templates',
    imageSrc,
    modelIdentifiers,
    rank: chainRankForTemplate(templateSlug),
    routeLabel: '/api/v1/chains/runs',
    slug,
    steps: selectedSteps.map((step) => step.key.replaceAll('_', '-')),
    templateSlug,
    title,
  };
}

function defaultInputForTemplate({
  imageModel,
  modifyModel,
  refineModel,
  videoModel,
}: {
  imageModel: string;
  modifyModel?: string;
  refineModel?: string;
  videoModel: string;
}) {
  return {
    image_model: imageModel,
    ...(refineModel
      ? {
          refine_model: refineModel,
        }
      : {}),
    video_model: videoModel,
    ...(modifyModel
      ? {
          modify_model: modifyModel,
        }
      : {}),
    image_model_input: {
      generation_prompt: 'A futuristic wireless headphone product.',
    },
    ...(refineModel
      ? {
          refine_model_input: {
            generation_prompt: 'Refine the frame with sharper material detail.',
          },
        }
      : {}),
    video_model_input: {
      generation_duration: 5,
      generation_prompt: 'Slow cinematic orbit around the product.',
    },
    ...(modifyModel
      ? {
          modify_model_input: {
            generation_prompt: 'Polish the video with cinematic motion edits.',
          },
        }
      : {}),
  };
}

function sortModelsByPublicName<T extends { modelIdentifier: string }>(
  models: T[],
) {
  return [...models].sort((first, second) => {
    const firstName = formatPublicModelName(first.modelIdentifier);
    const secondName = formatPublicModelName(second.modelIdentifier);

    return (
      firstName.localeCompare(secondName) ||
      first.modelIdentifier.localeCompare(second.modelIdentifier)
    );
  });
}

function modelTitle(modelIdentifiers: string[]) {
  return modelIdentifiers.map(formatPublicModelName).join(' → ');
}

function providerBadge(providers: string[]) {
  return providers.map(providerLabel).join(' → ');
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replaceAll('/', '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function chainRankForTemplate(templateSlug: string) {
  const ranks: Record<string, string> = {
    chain: 'CHAIN',
  };

  return ranks[templateSlug] ?? 'CHAIN.01';
}

function providerLabel(provider: string) {
  const labels: Record<string, string> = {
    'alibaba-cloud': 'Alibaba Cloud',
    'black-forest-labs': 'Black Forest Labs',
    byteplus: 'BytePlus',
    google: 'Google',
    openai: 'OpenAI',
    runway: 'Runway',
  };

  return labels[provider] ?? provider;
}

function accentForSlug(slug: string) {
  const value = Array.from(slug).reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );

  return CARD_ACCENTS[value % CARD_ACCENTS.length] ?? DEFAULT_CARD_ACCENT;
}

function accentForCatalogIndex(index: number) {
  const rowIndex = Math.floor(index / CARD_GRID_COLUMNS);
  const columnIndex = index % CARD_GRID_COLUMNS;
  const accentIndex = (rowIndex + columnIndex) % CARD_ACCENTS.length;

  return CARD_ACCENTS[accentIndex] ?? DEFAULT_CARD_ACCENT;
}
