import { describe, expect, it } from 'vitest';

import { trimVideoLeadIn } from '../lib/storage/tools/video-trim';

describe('trimVideoLeadIn', () => {
  const bytes = new Uint8Array([0, 1, 2, 3, 4, 5]);

  it('returns the original bytes when the lead-in is not positive', async () => {
    await expect(
      trimVideoLeadIn({ bytes, contentType: 'video/mp4', leadInMs: 0 }),
    ).resolves.toBe(bytes);
  });

  it('leaves non-video outputs untouched', async () => {
    await expect(
      trimVideoLeadIn({ bytes, contentType: 'image/png', leadInMs: 300 }),
    ).resolves.toBe(bytes);
  });

  it('fails open to the original bytes when ffmpeg is unavailable', async () => {
    await expect(
      trimVideoLeadIn({
        bytes,
        contentType: 'video/mp4',
        leadInMs: 300,
        ffmpegPath: '/nonexistent/marsha-ffmpeg-test-binary',
      }),
    ).resolves.toBe(bytes);
  });
});
