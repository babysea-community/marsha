import { Buffer } from 'node:buffer';

import type { NextRequest } from 'next/server';
import type { WebhookPayload } from 'babysea';
import { isGenerationEvent, verifyWebhook } from 'babysea/webhooks';

import { applyBabySeaWebhook } from '@/lib/chains/runner';
import { createChainStore } from '@/lib/chains/store';
import type { JsonObject } from '@/lib/chains/types';
import { getEnv } from '@/lib/utils/env';
import { AppError, toErrorMessage } from '@/lib/utils/errors';
import { jsonEnvelopeOk, jsonError } from '@/lib/security/http';

export const dynamic = 'force-dynamic';
// Keep in sync with APP_SDK_ROUTE_MAX_DURATION_SECONDS.
// The starter keeps this at 300 for broad Vercel compatibility. Raise it only
// on deployments whose plan supports a higher route duration.
export const maxDuration = 300;
export const runtime = 'nodejs';

const MAX_WEBHOOK_PAYLOAD_BYTES = 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get('content-length') ?? 0);

    if (contentLength > MAX_WEBHOOK_PAYLOAD_BYTES) {
      throw new AppError(
        'payload_too_large',
        'Webhook payload is too large.',
        413,
      );
    }

    const body = await request.text();

    if (Buffer.byteLength(body, 'utf8') > MAX_WEBHOOK_PAYLOAD_BYTES) {
      throw new AppError(
        'payload_too_large',
        'Webhook payload is too large.',
        413,
      );
    }

    const env = getEnv();

    if (!env.BABYSEA_WEBHOOK_SECRET) {
      throw new AppError(
        'webhook_not_configured',
        'BABYSEA_WEBHOOK_SECRET is required to receive BabySea webhooks.',
        500,
      );
    }

    const signature = request.headers.get('x-babysea-signature');

    if (!signature) {
      throw new AppError(
        'missing_webhook_signature',
        'Missing BabySea webhook signature.',
        400,
      );
    }

    let payload: WebhookPayload;

    try {
      payload = await verifyWebhook(
        body,
        signature,
        env.BABYSEA_WEBHOOK_SECRET,
      );
    } catch {
      throw new AppError(
        'invalid_webhook_signature',
        'Invalid BabySea webhook signature or payload.',
        400,
      );
    }

    const store = createChainStore();
    const generationId = isGenerationEvent(payload)
      ? payload.webhook_data.generation_id
      : null;
    const recorded = await store.recordWebhookDelivery({
      deliveryId: payload.webhook_delivery_id,
      eventType: payload.webhook_event,
      generationId,
      payload: JSON.parse(body) as JsonObject,
    });

    if (!recorded) {
      return jsonEnvelopeOk({ duplicate: true, received: true });
    }

    try {
      if (!isGenerationEvent(payload)) {
        await store.markWebhookDelivery({
          deliveryId: payload.webhook_delivery_id,
          status: 'processed',
        });

        return jsonEnvelopeOk({ ignored: true, received: true });
      }

      const record = await applyBabySeaWebhook(payload, { store });

      await store.markWebhookDelivery({
        deliveryId: payload.webhook_delivery_id,
        status: 'processed',
      });

      return jsonEnvelopeOk({
        received: true,
        run_id: record?.run.id ?? null,
        status: record?.run.status ?? null,
      });
    } catch (error) {
      await store.markWebhookDelivery({
        deliveryId: payload.webhook_delivery_id,
        error: toErrorMessage(error).slice(0, 2000),
        status: 'failed',
      });

      throw error;
    }
  } catch (error) {
    return await jsonError(error);
  }
}
