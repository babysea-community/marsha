import 'server-only';

import type { EstimateData, Generation, GenerationParams } from 'babysea';

import type { JsonObject } from '@/lib/chains/types';

/**
 * Canonical provider names recognised by the app.
 *
 *   - `babysea`      : default routing through the BabySea SDK (server-side key).
 *   - `alibabacloud` : direct Alibaba Cloud Model Studio/DashScope API, BYOK.
 *   - `bfl`          : direct Black Forest Labs (FLUX) API, BYOK.
 *   - `byteplus`     : direct BytePlus ModelArk API, BYOK.
 *   - `google`       : direct Google Gemini/Imagen/Veo APIs, BYOK.
 *   - `openai`       : direct OpenAI Image API, BYOK.
 *   - `runway`       : direct Runway API, BYOK.
 */
export type ProviderName =
  | 'babysea'
  | 'alibabacloud'
  | 'bfl'
  | 'byteplus'
  | 'google'
  | 'openai'
  | 'runway';

export const BYOK_PROVIDER_NAMES = [
  'alibabacloud',
  'bfl',
  'byteplus',
  'google',
  'openai',
  'runway',
] as const satisfies ReadonlyArray<
  Extract<
    ProviderName,
    'alibabacloud' | 'byteplus' | 'bfl' | 'google' | 'openai' | 'runway'
  >
>;

export type ByokProviderName = (typeof BYOK_PROVIDER_NAMES)[number];

/**
 * Non-secret marker persisted on a run when the deployment is configured to
 * call direct providers with server-side env keys.
 */
export type ByokRunConfig = {
  mode: 'server_env';
  providers: ByokProviderName[];
};

export type ProviderEstimateInput = {
  modelIdentifier: string;
  stepKind: 'image' | 'video';
  options: {
    audio?: boolean;
    count?: number;
    duration?: number;
    resolution?: string;
  };
};

export type ProviderSubmitInput = {
  modelIdentifier: string;
  stepKey?: string;
  stepKind: 'image' | 'video';
  params: GenerationParams | Record<string, unknown>;
  idempotencyKey: string;
  sourceModelIdentifier?: string;
};

/**
 * Result of `provider.submit`.
 *
 *   - `async`     : the provider returned a task id; the runner will poll.
 *   - `completed` : the provider returned the final output in the submit
 *                   response (synchronous providers). The runner skips the
 *                   running state and writes the result immediately.
 */
export type ProviderSubmitResult =
  | {
      kind: 'async';
      generationId: string;
      predictionId?: string | null;
      providerOrder: string[];
      providerMetadata?: JsonObject;
    }
  | {
      kind: 'completed';
      generationId: string;
      providerOrder: string[];
      providerUsed: string;
      outputFiles: string[];
      providerMetadata?: JsonObject;
    };

/**
 * Subset of the BabySea SDK `Generation` shape the runner consumes. Each
 * provider adapter translates its native polling response into this shape so
 * the runner's bookkeeping stays uniform.
 */
export type ProviderGenerationStatus = Partial<Generation> & {
  /** Optional provider-specific metadata to merge onto chain_step.provider_metadata. */
  provider_metadata?: JsonObject;
};

export type ProviderEstimateResult = EstimateData;

export type ProviderPollContext = {
  /** Previously persisted provider_metadata for this step, if any. */
  providerMetadata: JsonObject | null;
  /** Stable identifier returned from `submit`. */
  generationId: string;
  modelIdentifier: string;
};

export type ProviderCancelContext = ProviderPollContext;

export interface Provider {
  readonly name: ProviderName;

  /**
   * Pre-flight cost estimate. BYOK providers that bill the caller's account
   * return `cost_total_consumed: 0` so they do not falsely contribute to the
   * the app credits total.
   */
  estimate(input: ProviderEstimateInput): Promise<ProviderEstimateResult>;

  /**
   * Submit a generation request and return either an async task id or a
   * completed result (for synchronous providers).
   */
  submit(input: ProviderSubmitInput): Promise<ProviderSubmitResult>;

  /**
   * Fetch the latest status for a previously submitted generation.
   */
  poll(context: ProviderPollContext): Promise<ProviderGenerationStatus>;

  /**
   * Best-effort cancellation. Providers that do not expose a cancel endpoint
   * (e.g. BFL) resolve without error and let the runner mark the step locally.
   */
  cancel(context: ProviderCancelContext): Promise<void>;
}
