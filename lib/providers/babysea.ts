import 'server-only';

import type { BabySea } from 'babysea';

import { createBabySeaClient } from '@/lib/babysea';

import type {
  Provider,
  ProviderCancelContext,
  ProviderEstimateInput,
  ProviderEstimateResult,
  ProviderGenerationStatus,
  ProviderPollContext,
  ProviderSubmitInput,
  ProviderSubmitResult,
} from './types';

/**
 * Adapter that exposes the BabySea SDK behind the unified Provider interface.
 *
 * This is the default route for any chain step whose model identifier does not
 * start with a BYOK prefix (e.g. `bytedance/seedream-4.5`). All cost, retry,
 * failover, and webhook semantics continue to come from BabySea.
 */
export function createBabySeaProvider(client?: BabySea): Provider {
  const resolved = client ?? createBabySeaClient();
  return {
    name: 'babysea',

    async estimate(
      input: ProviderEstimateInput,
    ): Promise<ProviderEstimateResult> {
      const response = await resolved.estimate(
        input.modelIdentifier,
        input.options,
      );
      return response.data;
    },

    async submit(input: ProviderSubmitInput): Promise<ProviderSubmitResult> {
      const response = await resolved.generate(
        input.modelIdentifier,
        input.params as Parameters<BabySea['generate']>[1],
        {
          idempotencyKey: input.idempotencyKey,
        },
      );
      const data = response.data;

      if (
        'generation_status' in data &&
        data.generation_status === 'canceled'
      ) {
        return {
          kind: 'completed',
          generationId: data.generation_id,
          providerOrder: [],
          providerUsed: 'babysea',
          outputFiles: [],
          providerMetadata: {
            babysea_canceled_on_submit: true,
            request_id: response.request_id,
          },
        };
      }

      return {
        kind: 'async',
        generationId: data.generation_id,
        predictionId:
          'generation_prediction_id' in data
            ? data.generation_prediction_id
            : null,
        providerOrder:
          'generation_provider_order' in data
            ? data.generation_provider_order
            : [],
        providerMetadata: {
          idempotency_replayed: response.idempotency_replayed ?? false,
          request_id: response.request_id,
        },
      };
    },

    async poll(
      context: ProviderPollContext,
    ): Promise<ProviderGenerationStatus> {
      const response = await resolved.getGeneration(context.generationId);

      return {
        ...response.data,
        provider_metadata: { request_id: response.request_id },
      } as ProviderGenerationStatus;
    },

    async cancel(context: ProviderCancelContext): Promise<void> {
      try {
        await resolved.cancelGeneration(context.generationId);
      } catch {
        // Best-effort: local cancellation already won.
      }
    },
  };
}
