import { describe, expect, it } from 'vitest';

import { formatPublicModelName } from '@/lib/models/display';

describe('public model names', () => {
  it('keeps API identifiers out of public Alibaba model labels', () => {
    expect(formatPublicModelName('qwen/image')).toBe('Qwen Image');
    expect(formatPublicModelName('qwen/image-plus')).toBe('Qwen Image Plus');
    expect(formatPublicModelName('qwen/image-2')).toBe('Qwen Image 2.0');
    expect(formatPublicModelName('qwen/image-2-pro')).toBe(
      'Qwen Image 2.0 Pro',
    );
    expect(formatPublicModelName('wan/2.7-image-pro')).toBe(
      'Wan 2.7 Image Pro',
    );
    expect(formatPublicModelName('wan/2.1-imageedit')).toBe(
      'Wan 2.1 Image Edit',
    );
  });

  it('formats non-Alibaba public model labels by family name', () => {
    expect(formatPublicModelName('bytedance/seedream-4.5')).toBe(
      'Seedream 4.5',
    );
    expect(formatPublicModelName('bfl/flux-1.1-pro')).toBe('FLUX 1.1 Pro');
    expect(formatPublicModelName('bfl/flux-2-klein-9b')).toBe(
      'FLUX 2 Klein 9B',
    );
    expect(formatPublicModelName('google/nano-banana')).toBe('Nano Banana');
    expect(formatPublicModelName('google/nano-banana-2')).toBe('Nano Banana 2');
    expect(formatPublicModelName('google/imagen-4-ultra')).toBe(
      'Imagen 4 Ultra',
    );
    expect(formatPublicModelName('google/veo-3.1-fast')).toBe('Veo 3.1 Fast');
    expect(formatPublicModelName('gpt/image-2')).toBe('GPT Image 2');
    expect(formatPublicModelName('runway/gen-4-turbo')).toBe(
      'Runway Gen-4 Turbo',
    );
  });
});
