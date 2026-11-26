import { describe, expect, it } from 'vitest';

import { agentSeedRange, freshAgentSeedValue } from '@/lib/chains/runner';

describe('agentSeedRange', () => {
  it('reads min/max/default from a schema generation_seed field', () => {
    expect(
      agentSeedRange({
        type: 'object',
        properties: {
          generation_seed: {
            type: 'integer',
            minimum: 5,
            maximum: 9,
            default: 7,
          },
        },
      }),
    ).toEqual({ min: 5, max: 9, defaultValue: 7 });
  });

  it('returns null when the schema does not expose generation_seed', () => {
    expect(
      agentSeedRange({
        type: 'object',
        properties: { generation_duration: { type: 'number' } },
      }),
    ).toBeNull();
    expect(agentSeedRange({})).toBeNull();
    expect(agentSeedRange(null)).toBeNull();
  });
});

describe('freshAgentSeedValue', () => {
  it('always returns a value within range and different from the default', () => {
    for (let i = 0; i < 200; i += 1) {
      const seed = freshAgentSeedValue(
        { min: 0, max: 100, defaultValue: 42 },
        new Set(),
      );

      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(100);
      expect(seed).not.toBe(42);
    }
  });

  it('moves off the default even when the range is tiny', () => {
    // Range [1, 2] with default 2 leaves only 1 as a valid fresh seed.
    for (let i = 0; i < 50; i += 1) {
      expect(
        freshAgentSeedValue({ min: 1, max: 2, defaultValue: 2 }, new Set()),
      ).toBe(1);
    }
  });
});
