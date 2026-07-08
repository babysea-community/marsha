import { describe, expect, it } from 'vitest';

import {
  createDefaultCanvasName,
  isDefaultCanvasName,
  MAX_CANVAS_TITLE_LENGTH,
  MAX_DEFAULT_CANVAS_NAME_LENGTH,
  normalizeCanvasTitle,
} from '@/lib/canvas/names';

describe('canvas names', () => {
  it('generates two-word default names within the default length budget', () => {
    const name = createDefaultCanvasName();

    expect(name).toMatch(/^[a-z]+-[a-z]+$/);
    expect(name.length).toBeLessThanOrEqual(MAX_DEFAULT_CANVAS_NAME_LENGTH);
    expect(isDefaultCanvasName(name)).toBe(true);
  });

  it('identifies generated default names without treating custom titles as defaults', () => {
    expect(isDefaultCanvasName('amber-beam')).toBe(true);
    expect(isDefaultCanvasName('amber-beam-copy')).toBe(false);
    expect(isDefaultCanvasName('custom-title')).toBe(false);
  });

  it('normalizes user titles to 40 characters', () => {
    const title = `  ${'a'.repeat(MAX_CANVAS_TITLE_LENGTH + 10)}  `;

    expect(normalizeCanvasTitle(title)).toBe(
      'a'.repeat(MAX_CANVAS_TITLE_LENGTH),
    );
  });
});
