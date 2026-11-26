/**
 * Client-side template entry synthesis.
 *
 * The /templates page previously pre-built EVERY model combination server-side
 * (image × refine × video × modify ≈ 79k entries, ~98 MB of JSON props) and
 * shipped the list to the client, which then looked up the selected
 * combination. That payload broke the page as soon as optional steps joined
 * the matrix. Every field the page renders is derivable from the four
 * selected model ids, so the client now synthesizes the single active entry
 * locally from this pure module instead.
 */

import { formatPublicModelName } from '@/lib/models/display';

export type TemplateStepView = {
  dependsOn: string[];
  key: string;
  kind: 'image' | 'video';
  model: string;
  title: string;
};

export type TemplatePageEntry = {
  accent: string;
  defaultInput: Record<string, unknown>;
  description: string;
  imageSrc: string;
  modelIdentifiers: string[];
  routeLabel: string;
  selectedSteps: TemplateStepView[];
  slug: string;
  title: string;
};

export type TemplateSelection = {
  imageModel: string;
  refineModel?: string;
  videoModel: string;
  modifyModel?: string;
};

const CARD_IMAGE_SRC =
  'https://imagedelivery.net/ub24fjUytZQ3JbssUo49_w/97d9a23a-2a4e-4543-4b3b-199516ad6c00/1280x720';
const DEFAULT_CARD_ACCENT = '#1773cf';
const CARD_ACCENTS = [
  DEFAULT_CARD_ACCENT,
  '#318f55',
  '#9933cc',
  '#d98026',
  '#d9467a',
] as const;

export function synthesizeTemplateEntry(
  selection: TemplateSelection,
): TemplatePageEntry {
  const { imageModel, refineModel, videoModel, modifyModel } = selection;
  const modelIdentifiers = [
    imageModel,
    ...(refineModel ? [refineModel] : []),
    videoModel,
    ...(modifyModel ? [modifyModel] : []),
  ];
  const slug = modelIdentifiers.map(slugify).join('--');

  return {
    accent: accentForSlug(slug),
    defaultInput: {
      image_model: imageModel,
      ...(refineModel ? { refine_model: refineModel } : {}),
      video_model: videoModel,
      ...(modifyModel ? { modify_model: modifyModel } : {}),
    },
    description: describeChain(selection),
    imageSrc: CARD_IMAGE_SRC,
    modelIdentifiers,
    routeLabel: '/api/v1/chains/runs',
    selectedSteps: synthesizeSteps(selection),
    slug,
    title: modelIdentifiers.map(formatPublicModelName).join(' → '),
  };
}

function synthesizeSteps(selection: TemplateSelection): TemplateStepView[] {
  const steps: TemplateStepView[] = [
    {
      dependsOn: [],
      key: 'image',
      kind: 'image',
      model: '${image_model}',
      title: 'Run image model',
    },
  ];

  if (selection.refineModel) {
    steps.push({
      dependsOn: ['image'],
      key: 'refine',
      kind: 'image',
      model: '${refine_model}',
      title: 'Run image model (2nd)',
    });
  }

  steps.push({
    dependsOn: [selection.refineModel ? 'refine' : 'image'],
    key: 'video',
    kind: 'video',
    model: '${video_model}',
    title: 'Run video model',
  });

  if (selection.modifyModel) {
    steps.push({
      dependsOn: ['video'],
      key: 'modify',
      kind: 'video',
      model: '${modify_model}',
      title: 'Run video model (2nd)',
    });
  }

  return steps;
}

function describeChain({
  imageModel,
  refineModel,
  videoModel,
  modifyModel,
}: TemplateSelection): string {
  const image = formatPublicModelName(imageModel);
  const refine = refineModel ? formatPublicModelName(refineModel) : null;
  const video = formatPublicModelName(videoModel);
  const modify = modifyModel ? formatPublicModelName(modifyModel) : null;

  if (refine && modify) {
    return `Run ${image}, refine its output with ${refine}, pass the final image URL into ${video}, then modify the video with ${modify}.`;
  }
  if (refine) {
    return `Run ${image}, refine its output with ${refine}, then pass the final image URL into ${video} for video generation.`;
  }
  if (modify) {
    return `Run ${image} as the image step, pass the output URL into ${video}, then modify the video with ${modify}.`;
  }
  return `Run ${image} as the image step, then pass the output URL into ${video} for video generation.`;
}

function accentForSlug(slug: string) {
  const value = Array.from(slug).reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );

  return CARD_ACCENTS[value % CARD_ACCENTS.length] ?? DEFAULT_CARD_ACCENT;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
