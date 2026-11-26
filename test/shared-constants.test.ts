import { describe, expect, it } from 'vitest';

import {
  APP_BACKEND_STACKS,
  APP_CRON_RUN_LIMIT,
  APP_SDK_REQUEST_TIMEOUT_MS,
  APP_SDK_ROUTE_MAX_DURATION_SECONDS,
  APP_STEP_WATCHDOG_SECONDS,
  BABYSEA_V1_STEP_MAX_DURATION_SECONDS,
  VERCEL_PRO_FLUID_COMPUTE_MAX_DURATION_SECONDS,
} from '@/lib/chains/shared-constants';
import { CronRequestSchema } from '@/lib/chains/schemas';

describe('The app topology constants', () => {
  it('captures BabySea v1 worst-case route budgets', () => {
    expect(BABYSEA_V1_STEP_MAX_DURATION_SECONDS.image).toBe(210);
    expect(BABYSEA_V1_STEP_MAX_DURATION_SECONDS.video).toBe(790);
  });

  it('keeps the step watchdog decoupled from and within the failover budget', () => {
    expect(APP_STEP_WATCHDOG_SECONDS.image).toBe(120);
    expect(APP_STEP_WATCHDOG_SECONDS.video).toBe(360);
    // The single-provider wall-clock watchdog must stay within BabySea's
    // per-step failover budget so a step never outlives the run's route
    // ceiling, even though the two are configured independently.
    expect(APP_STEP_WATCHDOG_SECONDS.image).toBeLessThanOrEqual(
      BABYSEA_V1_STEP_MAX_DURATION_SECONDS.image,
    );
    expect(APP_STEP_WATCHDOG_SECONDS.video).toBeLessThanOrEqual(
      BABYSEA_V1_STEP_MAX_DURATION_SECONDS.video,
    );
  });

  it('keeps the app on the SDK happy path with one BabySea step per invocation', () => {
    expect(APP_BACKEND_STACKS.chain.backendStack).toEqual(['image', 'video']);
    expect(APP_BACKEND_STACKS.chain.chainSlug).toBe('chain');
    expect(APP_SDK_ROUTE_MAX_DURATION_SECONDS).toBe(790);
    expect(APP_SDK_ROUTE_MAX_DURATION_SECONDS).toBeLessThanOrEqual(
      VERCEL_PRO_FLUID_COMPUTE_MAX_DURATION_SECONDS,
    );
    expect(APP_SDK_REQUEST_TIMEOUT_MS).toBe(790_000);
  });

  it('keeps cron batches to one run per invocation', () => {
    expect(APP_CRON_RUN_LIMIT).toBe(1);
    expect(CronRequestSchema.parse({})).toEqual({ limit: 1 });
    expect(() => CronRequestSchema.parse({ limit: 2 })).toThrow();
  });
});
