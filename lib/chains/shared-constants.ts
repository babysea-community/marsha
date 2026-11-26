export const VERCEL_PRO_FLUID_COMPUTE_MAX_DURATION_SECONDS = 800;

// BabySea v1 supports model-specific provider stacks. Some models have one or
// two providers; three is the worst-case fallback depth used for SLA budgeting.
export const BABYSEA_V1_MAX_PROVIDER_ATTEMPTS_PER_MODEL = 3;

export const BABYSEA_V1_IMAGE_TIMEOUT_SECONDS = {
  bufferPerAttempt: 6,
  gracePeriod: 6,
  providerTimeout: 60,
} as const;

export const BABYSEA_V1_VIDEO_TIMEOUT_SECONDS = {
  bufferPerAttempt: 8,
  gracePeriod: 8,
  providerTimeout: 250,
} as const;

// Wall-clock watchdog for a single the app step that has a provider/generation
// id but never reaches a terminal state (a lost or hung provider job). The
// runner enforces this budget across cron re-entries, NOT within one serverless
// invocation, so it is deliberately decoupled from the BabySea 3-provider
// failover route budgets above and from Vercel's per-invocation ceiling. A
// the app step hits ONE provider per model; video gets more room because
// providers like Runway plus an unstable network can legitimately run long.
export const APP_STEP_WATCHDOG_SECONDS = {
  image: 120,
  video: 360,
} as const;

export const BABYSEA_V1_STEP_MAX_DURATION_SECONDS = {
  image: providerFailoverBudgetSeconds(
    BABYSEA_V1_IMAGE_TIMEOUT_SECONDS,
    BABYSEA_V1_MAX_PROVIDER_ATTEMPTS_PER_MODEL,
  ),
  video: providerFailoverBudgetSeconds(
    BABYSEA_V1_VIDEO_TIMEOUT_SECONDS,
    BABYSEA_V1_MAX_PROVIDER_ATTEMPTS_PER_MODEL,
  ),
} as const;

export const APP_BACKEND_STACKS = {
  chain: {
    backendStack: ['image', 'video'],
    chainSlug: 'chain',
  },
} as const;

// the app stays on the BabySea SDK path. Each processor/webhook invocation
// starts at most one BabySea generation. The route budget follows the longest
// single BabySea v1 worst-case call: video = 790s. Models with one- or
// two-provider stacks naturally complete inside that ceiling.
export const APP_SDK_ROUTE_MAX_DURATION_SECONDS =
  BABYSEA_V1_STEP_MAX_DURATION_SECONDS.video;
export const APP_SDK_REQUEST_TIMEOUT_MS =
  APP_SDK_ROUTE_MAX_DURATION_SECONDS * 1000;
export const APP_CRON_RUN_LIMIT = 1;

function providerFailoverBudgetSeconds(
  timeout: {
    bufferPerAttempt: number;
    gracePeriod: number;
    providerTimeout: number;
  },
  providerAttempts: number,
) {
  const failoverGrace = Math.max(providerAttempts - 1, 0) * timeout.gracePeriod;
  const buffer = providerAttempts * timeout.bufferPerAttempt;

  return providerAttempts * timeout.providerTimeout + failoverGrace + buffer;
}
