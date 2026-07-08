export type ErrorGuidance = {
  summary: string;
  what_to_try_next: string[];
};

export function getErrorGuidance({
  code,
  message,
}: {
  code: string;
  message: string;
}): ErrorGuidance | null {
  const normalizedMessage = message.toLowerCase();

  if (code === 'byok_credentials_missing') {
    return guidance(
      'The app cannot reach the selected provider with the current server configuration.',
      [
        'Set the provider API key required by the selected model, or switch APP_PROVIDER_MODE to babysea.',
        'Use GET /api/v1/models to confirm which provider owns the model identifier.',
      ],
    );
  }

  if (code === 'provider_rate_limited') {
    return guidance('The provider rate-limited this generation step.', [
      'Retry the run after the provider rate window resets.',
      'Check the provider account limits if this happens repeatedly.',
    ]);
  }

  if (code === 'provider_quota_exceeded') {
    return guidance(
      'The provider account has no remaining quota for this model.',
      [
        'Add a payment method or raise the model quota in the provider account.',
        'Switch the step to a model from a provider with available quota.',
      ],
    );
  }

  if (code === 'provider_unauthorized') {
    return guidance('The provider rejected the server-side credentials.', [
      'Verify the provider API key configured on the the app server.',
      'Confirm the provider account has access to the selected model.',
    ]);
  }

  if (code === 'provider_not_found') {
    return guidance(
      'The provider could not find the generation task or output.',
      [
        'Poll the run again if the provider may still be catching up.',
        'For short-lived provider URLs, retry the chain and copy or download outputs soon after completion.',
      ],
    );
  }

  if (code === 'provider_unavailable') {
    return guidance('The provider is temporarily unavailable.', [
      'Retry the run after a short delay.',
      'Check the selected provider status and the app server logs if this repeats.',
    ]);
  }

  if (code === 'database_unreachable') {
    return guidance('The app cannot reach its Aurora PostgreSQL database.', [
      'Confirm DATABASE_URL uses the Aurora writer endpoint and includes port 5432.',
      'In the Aurora security group, allow inbound TCP 5432 from the app runtime egress IP or place the app in private networking.',
      'For Vercel production, prefer RDS Proxy, AWS PrivateLink, or VPC peering instead of relying on dynamic public egress IPs.',
    ]);
  }

  if (code === 'provider_invalid_request') {
    return guidance('The provider rejected the request shape for this model.', [
      'Compare your model input object with GET /api/v1/models/{modelId}.',
      'Use only the Semantic Lady generation_* fields listed for the selected model.',
    ]);
  }

  if (code === 'provider_unexpected_response') {
    if (
      normalizedMessage.includes('no urls') ||
      normalizedMessage.includes('no output') ||
      normalizedMessage.includes('no usable') ||
      normalizedMessage.includes('no media')
    ) {
      return guidance('The provider completed without a usable media URL.', [
        'Retry with a simpler prompt or a model that is known to return URL media.',
        'Check the provider dashboard for the task if the provider reported success but omitted media.',
      ]);
    }

    return guidance('The provider returned a response the app could not use.', [
      'Retry the run once in case the provider response was transient.',
      'If it repeats, compare the selected model output shape with GET /api/v1/models/{modelId}.',
    ]);
  }

  if (code === 'chain_step_params_failed') {
    if (normalizedMessage.includes('previous step output')) {
      return guidance(
        'A dependent step could not find media from the previous step.',
        [
          'Inspect the previous step in the run timeline for missing output files.',
          'Retry with a model that returns URL output for chained inputs.',
        ],
      );
    }

    if (normalizedMessage.includes('does not accept image input')) {
      return guidance(
        'The selected model cannot use the image input supplied to this step.',
        [
          'Choose an image-input-capable image model.',
          'Remove generation_input_file when starting from text only.',
        ],
      );
    }

    if (normalizedMessage.includes('provider-controlled model input')) {
      return guidance(
        'The request included a provider-controlled field that the app owns.',
        [
          'Remove model, callback, provider, or BabySea routing fields from model input objects.',
          'Select models through chain_models instead of provider routing fields.',
        ],
      );
    }

    return guidance('The app could not prepare model input for this step.', [
      'Check that the selected model supports the input you supplied.',
      'Use GET /api/v1/models/{modelId} to inspect the accepted Semantic Lady schema.',
    ]);
  }

  if (code === 'babysea_start_timed_out') {
    return guidance(
      'The generation did not return a provider id before the start deadline.',
      [
        'Retry the run once in case the upstream provider was slow.',
        'Check provider status and the app server logs if this repeats.',
      ],
    );
  }

  if (code === 'step_running_timed_out') {
    return guidance(
      'The generation did not reach a terminal state before the running deadline.',
      [
        'Retry the run; the upstream provider job may have stalled after starting.',
        'Check provider status and the app server logs if this repeats.',
      ],
    );
  }

  if (code === 'invalid_chain_input') {
    return guidance('The run input does not match the chain template schema.', [
      'Compare the request body with GET /api/v1/chains.',
      'Keep model choices under input.chain_models and per-step content under the matching model input object.',
    ]);
  }

  return null;
}

function guidance(summary: string, whatToTryNext: string[]): ErrorGuidance {
  return {
    summary,
    what_to_try_next: whatToTryNext,
  };
}
