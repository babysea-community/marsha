export const MAX_CANVAS_TITLE_LENGTH = 40;
export const MAX_DEFAULT_CANVAS_NAME_LENGTH = 20;

const CANVAS_NAME_LEFT = [
  'amber',
  'cedar',
  'coral',
  'dawn',
  'ember',
  'field',
  'flower',
  'glass',
  'harbor',
  'jade',
  'meadow',
  'neon',
  'orbit',
  'quartz',
  'river',
  'silver',
  'spark',
  'sunset',
] as const;

const CANVAS_NAME_RIGHT = [
  'beam',
  'bloom',
  'brook',
  'cloud',
  'crest',
  'forge',
  'garden',
  'glade',
  'grove',
  'haven',
  'light',
  'maple',
  'stone',
  'trail',
  'vale',
  'wave',
  'willow',
  'wood',
] as const;

export function normalizeCanvasTitle(title: string): string {
  return title.trim().slice(0, MAX_CANVAS_TITLE_LENGTH);
}

export function createDefaultCanvasName(): string {
  const name = `${pick(CANVAS_NAME_LEFT)}-${pick(CANVAS_NAME_RIGHT)}`;
  return name.slice(0, MAX_DEFAULT_CANVAS_NAME_LENGTH);
}

export function isDefaultCanvasName(name: string): boolean {
  const [left, right, extra] = name.trim().split('-');

  return (
    extra === undefined &&
    CANVAS_NAME_LEFT.includes(left as (typeof CANVAS_NAME_LEFT)[number]) &&
    CANVAS_NAME_RIGHT.includes(right as (typeof CANVAS_NAME_RIGHT)[number])
  );
}

function pick(items: readonly string[]): string {
  const index = randomIndex(items.length);
  return items[index] ?? items[0] ?? 'canvas';
}

function randomIndex(max: number): number {
  if (max <= 1) return 0;

  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return (values[0] ?? 0) % max;
  }

  return Math.floor(Math.random() * max);
}
