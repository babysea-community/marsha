import { describe, expect, it } from 'vitest';

import {
  isBlockedNetworkHostname,
  lookupAllowedNetworkAddress,
} from '@/lib/security/network-safety';
import {
  assertSafeChainInputTargets,
  assertSafeGenerationParamsTargets,
} from '@/lib/chains/templates';

describe('network safety', () => {
  it('blocks private and special-use network literals', () => {
    for (const hostname of [
      '10.0.0.1',
      '100.64.0.1',
      '192.31.196.1',
      '192.52.193.1',
      '192.175.48.1',
      '198.18.0.1',
      '203.0.113.1',
      '[100::1]',
      '[2001:1::1]',
      '[2001:1::2]',
      '[2001:2::1]',
      '[2001:3::1]',
      '[2001:4:112::1]',
      '[2001:10::1]',
      '[2001:20::1]',
      '[2001:db8::1]',
      '[2002::1]',
      '[2620:4f:8000::1]',
      '[::ffff:808:808:dead]',
      '[fe80::1]',
      '[fec0::1]',
    ]) {
      expect(isBlockedNetworkHostname(hostname), hostname).toBe(true);
    }
  });

  it('allows ordinary public hostnames and IP literals', () => {
    for (const hostname of [
      'cdn.example.com',
      '8.8.8.8',
      '[2606:4700:4700::1111]',
    ]) {
      expect(isBlockedNetworkHostname(hostname), hostname).toBe(false);
    }
  });

  it('accepts public IP literal DNS targets', async () => {
    await expect(lookupAllowedNetworkAddress('8.8.8.8')).resolves.toEqual({
      address: '8.8.8.8',
      family: 4,
    });
  });

  it('fails closed when DNS lookup fails', async () => {
    await expect(
      lookupAllowedNetworkAddress('unresolvable.app.invalid'),
    ).resolves.toBeNull();
  });

  it('validates caller model input URLs with unreachable DNS targets', async () => {
    await expect(
      assertSafeChainInputTargets({
        refine_model_input: {
          generation_input_file: [
            'https://unresolvable.app.invalid/source.png',
          ],
        },
        video_model_input: {
          generation_duration: 4,
        },
      }),
    ).rejects.toThrow('URL host must resolve to a public address.');
  });

  it('validates generated model param URLs with DNS answers', async () => {
    await expect(
      assertSafeGenerationParamsTargets({
        generation_duration: 4,
        generation_input_file: ['https://8.8.8.8/source.png'],
        generation_prompt: 'Animate the source image.',
      }),
    ).resolves.toBeUndefined();
  });

  it('validates canonical model URL params with unreachable DNS targets', async () => {
    await expect(
      assertSafeGenerationParamsTargets({
        generation_input_image_file: [
          'https://unresolvable.app.invalid/source.png',
        ],
        generation_prompt: 'Animate the source image.',
      }),
    ).rejects.toThrow('URL host must resolve to a public address.');
  });
});
