import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertSafeCallbackUrl,
  cancelRun,
  continueAgentRun,
  prepareStepParamsForProvider,
  processRun,
} from '@/lib/chains/runner';
import type { ChainAgent } from '@/lib/agents';
import {
  serializeCompletedRunOutput,
  serializeRunWithSteps,
} from '@/lib/chains/presenters';
import { createDataUrlOutputResponse } from '@/lib/chains/output-files';
import type { ChainRunWithSteps, JsonObject } from '@/lib/chains/types';
import { AppError } from '@/lib/utils/errors';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('runner callback validation', () => {
  it('accepts https callback URLs', () => {
    expect(() =>
      assertSafeCallbackUrl('https://api.example.com/marsha/callback'),
    ).not.toThrow();
  });

  it('rejects non-https callback URLs', () => {
    expect(() =>
      assertSafeCallbackUrl('http://api.example.com/callback'),
    ).toThrow('Callback URL must use HTTPS.');
  });

  it('rejects callback URLs with credentials', () => {
    expect(() =>
      assertSafeCallbackUrl('https://user:pass@api.example.com/callback'),
    ).toThrow('Callback URL must not include credentials.');
  });

  it('rejects obvious local callback hosts', () => {
    expect(() => assertSafeCallbackUrl('https://localhost/callback')).toThrow(
      'Callback URL host is not allowed.',
    );
    expect(() => assertSafeCallbackUrl('https://[::1]/callback')).toThrow(
      'Callback URL host is not allowed.',
    );
  });

  it('rejects special-use callback network targets', () => {
    for (const url of [
      'https://100.64.0.1/callback',
      'https://198.18.0.1/callback',
      'https://[100::1]/callback',
      'https://[2001::1]/callback',
      'https://[2001:2::1]/callback',
      'https://[2001:10::1]/callback',
      'https://[2001:20::1]/callback',
      'https://[3fff::1]/callback',
      'https://[::ffff:127.0.0.1]/callback',
      'https://[::ffff:808:808:dead]/callback',
      'https://[fe90::1]/callback',
      'https://[fec0::1]/callback',
    ]) {
      expect(() => assertSafeCallbackUrl(url)).toThrow(
        'Callback URL host is not allowed.',
      );
    }
  });

  it('accepts public IPv6 callback URLs', () => {
    expect(() =>
      assertSafeCallbackUrl('https://[2606:4700:4700::1111]/callback'),
    ).not.toThrow();
  });

  it('rejects malformed callback URLs as validation errors', () => {
    expect(() => assertSafeCallbackUrl('not a url')).toThrow(
      'Callback URL must be a valid URL.',
    );
  });
});

describe('runner step claiming', () => {
  it('keeps canonical step params for every provider', () => {
    const params = {
      generation_prompt: 'BabySea prompt',
      generation_aspect_ratio: '16:9',
    };
    const input = {
      image_model_input: {
        output_format: 'jpg',
        prompt: 'Provider prompt',
        size: '2K',
        skipped: undefined,
      },
    };

    expect(
      prepareStepParamsForProvider({
        input,
        params,
        providerName: 'babysea',
        stepKey: 'image',
      }),
    ).toEqual(params);

    expect(
      prepareStepParamsForProvider({
        input,
        params,
        providerName: 'byteplus',
        stepKey: 'image',
      }),
    ).toEqual(params);
  });

  it('keeps a recently started BabySea step running while the generation id is pending', async () => {
    const record = createRunWithSteps({
      run: {
        currentStepKey: 'image',
        status: 'running',
      },
      step: {
        startedAt: new Date().toISOString(),
        status: 'running',
      },
    });

    const result = await processRun(record, {
      babysea: {} as never,
      store: {} as never,
    });

    expect({
      run: result.run,
      steps: result.steps,
      checkpoints: result.agentCheckpoints,
    }).toMatchObject({
      run: { status: 'running' },
    });
    expect(result.steps[0]!.status).toBe('running');
    expect(result.steps[0]!.babyseaGenerationId).toBeNull();
  });

  it('fails an abandoned BabySea start after the stale-start deadline', async () => {
    const record = createRunWithSteps({
      run: {
        currentStepKey: 'image',
        status: 'running',
      },
      step: {
        startedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        status: 'running',
      },
    });
    let updatedRecord = record;
    const store = {
      getRunWithSteps: async () => updatedRecord,
      updateRunningStep: async (
        _stepId: string,
        patch: Record<string, unknown>,
      ) => {
        const step = updatedRecord.steps[0]!;

        if (step.status !== 'running') {
          return null;
        }

        updatedRecord = {
          ...updatedRecord,
          steps: [
            {
              ...step,
              ...patch,
            },
          ],
        };

        return updatedRecord.steps[0]!;
      },
      updateActiveRun: async (
        _runId: string,
        patch: Record<string, unknown>,
      ) => {
        updatedRecord = {
          ...updatedRecord,
          run: {
            ...updatedRecord.run,
            ...patch,
          },
        };

        return updatedRecord.run;
      },
    };

    const result = await processRun(record, {
      babysea: {} as never,
      store: store as never,
    });

    expect(result.run.status).toBe('failed');
    expect(result.run.errorCode).toBe('babysea_start_timed_out');
    expect(result.steps[0]!.status).toBe('failed');
    expect(result.steps[0]!.errorCode).toBe('babysea_start_timed_out');
  });

  it('fails a running step that exceeds the running watchdog deadline', async () => {
    const record = createRunWithSteps({
      run: {
        currentStepKey: 'image',
        status: 'running',
      },
      step: {
        // Already started on the provider, but stuck running far past the
        // wall-clock watchdog deadline (~52 min); 2h here is comfortably over.
        babyseaGenerationId: 'gen-stuck-123',
        startedAt: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
        status: 'running',
      },
    });
    let updatedRecord = record;
    const store = {
      getRunWithSteps: async () => updatedRecord,
      updateRunningStep: async (
        _stepId: string,
        patch: Record<string, unknown>,
      ) => {
        const step = updatedRecord.steps[0]!;

        if (step.status !== 'running') {
          return null;
        }

        updatedRecord = {
          ...updatedRecord,
          steps: [
            {
              ...step,
              ...patch,
            },
          ],
        };

        return updatedRecord.steps[0]!;
      },
      updateActiveRun: async (
        _runId: string,
        patch: Record<string, unknown>,
      ) => {
        updatedRecord = {
          ...updatedRecord,
          run: {
            ...updatedRecord.run,
            ...patch,
          },
        };

        return updatedRecord.run;
      },
    };

    const result = await processRun(record, {
      babysea: {} as never,
      store: store as never,
    });

    expect(result.run.status).toBe('failed');
    expect(result.run.errorCode).toBe('step_running_timed_out');
    expect(result.steps[0]!.status).toBe('failed');
    expect(result.steps[0]!.errorCode).toBe('step_running_timed_out');
  });

  it('does not start BabySea generation when another processor claimed the queued step', async () => {
    const record = createRunWithSteps();
    let generateCalled = false;
    const store = {
      claimQueuedStep: async () => null,
      getRunWithSteps: async () => record,
    };
    const babysea = {
      generate: async () => {
        generateCalled = true;
        throw new Error('generate should not be called');
      },
    };

    const result = await processRun(record, {
      babysea: babysea as never,
      store: store as never,
    });

    expect(generateCalled).toBe(false);
    expect(result.run.status).toBe('queued');
  });

  it('requeues a step when provider submit is rate limited', async () => {
    let updatedRecord = createRunWithSteps();
    let generateCalled = false;
    const store = {
      claimQueuedStep: async (
        stepId: string,
        patch: Record<string, unknown>,
      ) => {
        const step = updatedRecord.steps.find(
          (candidate) =>
            candidate.id === stepId && candidate.status === 'queued',
        );

        if (!step) {
          return null;
        }

        updatedRecord = {
          ...updatedRecord,
          steps: [
            {
              ...step,
              ...patch,
            } as ChainRunWithSteps['steps'][number],
          ],
        };

        return updatedRecord.steps[0]!;
      },
      getRunWithSteps: async () => updatedRecord,
      updateActiveRun: async (
        _runId: string,
        patch: Record<string, unknown>,
      ) => {
        if (!['queued', 'running'].includes(updatedRecord.run.status)) {
          return null;
        }

        updatedRecord = {
          ...updatedRecord,
          run: {
            ...updatedRecord.run,
            ...patch,
          },
        };

        return updatedRecord.run;
      },
      updateRunningStep: async (
        stepId: string,
        patch: Record<string, unknown>,
      ) => {
        const step = updatedRecord.steps.find(
          (candidate) =>
            candidate.id === stepId && candidate.status === 'running',
        );

        if (!step) {
          return null;
        }

        updatedRecord = {
          ...updatedRecord,
          steps: [
            {
              ...step,
              ...patch,
            } as ChainRunWithSteps['steps'][number],
          ],
        };

        return updatedRecord.steps[0]!;
      },
    };
    const babysea = {
      generate: async () => {
        generateCalled = true;
        throw new AppError(
          'provider_rate_limited',
          'Provider responded 429.',
          429,
        );
      },
    };

    const result = await processRun(updatedRecord, {
      babysea: babysea as never,
      store: store as never,
    });

    expect(generateCalled).toBe(true);
    expect(result.run.status).toBe('queued');
    expect(result.run.currentStepKey).toBeNull();
    expect(result.run.errorCode).toBeNull();
    expect(result.steps[0]!.status).toBe('queued');
    expect(result.steps[0]!.startedAt).toBeNull();
    expect(result.steps[0]!.errorCode).toBeNull();
  });

  it('does not start BabySea generation when the run became terminal after step claim', async () => {
    const record = createRunWithSteps();
    const canceledRecord = createRunWithSteps({
      run: {
        completedAt: new Date().toISOString(),
        status: 'canceled',
      },
      step: {
        completedAt: new Date().toISOString(),
        status: 'canceled',
      },
    });
    let generateCalled = false;
    let localStepCanceled = false;
    const store = {
      claimQueuedStep: async (
        _stepId: string,
        patch: Record<string, unknown>,
      ) =>
        ({
          ...record.steps[0]!,
          ...patch,
        }) as ChainRunWithSteps['steps'][number],
      getRunWithSteps: async () => canceledRecord,
      updateActiveRun: async () => null,
      updateRunningStep: async (
        _stepId: string,
        patch: Record<string, unknown>,
      ) => {
        localStepCanceled = patch.status === 'canceled';

        return {
          ...record.steps[0]!,
          ...patch,
        } as ChainRunWithSteps['steps'][number];
      },
    };
    const babysea = {
      generate: async () => {
        generateCalled = true;
        throw new Error('generate should not be called');
      },
    };

    const result = await processRun(record, {
      babysea: babysea as never,
      store: store as never,
    });

    expect(generateCalled).toBe(false);
    expect(localStepCanceled).toBe(true);
    expect(result.run.status).toBe('canceled');
  });

  it('cancels the BabySea generation when local cancellation wins during start', async () => {
    const record = createRunWithSteps();
    const canceledRecord = createRunWithSteps({
      run: {
        completedAt: new Date().toISOString(),
        status: 'canceled',
      },
      step: {
        completedAt: new Date().toISOString(),
        status: 'canceled',
      },
    });
    let canceledGenerationId: string | null = null;
    const store = {
      claimQueuedStep: async (
        _stepId: string,
        patch: Record<string, unknown>,
      ) =>
        ({
          ...record.steps[0]!,
          ...patch,
        }) as ChainRunWithSteps['steps'][number],
      getRunWithSteps: async () => canceledRecord,
      updateActiveRun: async (_runId: string, patch: Record<string, unknown>) =>
        ({
          ...record.run,
          ...patch,
        }) as ChainRunWithSteps['run'],
      updateRunningStep: async () => null,
    };
    const babysea = {
      cancelGeneration: async (generationId: string) => {
        canceledGenerationId = generationId;
      },
      generate: async () => ({
        data: {
          generation_id: 'gen_canceled_after_start',
        },
        idempotency_replayed: false,
        request_id: 'req_canceled_after_start',
      }),
    };

    const result = await processRun(record, {
      babysea: babysea as never,
      store: store as never,
    });

    expect(canceledGenerationId).toBe('gen_canceled_after_start');
    expect(result.run.status).toBe('canceled');
  });

  it('does not cancel BabySea when client cancellation loses to a terminal run', async () => {
    const record = createRunWithSteps({
      run: {
        currentStepKey: 'image',
        status: 'running',
      },
      step: {
        babyseaGenerationId: 'gen_already_succeeded',
        startedAt: new Date().toISOString(),
        status: 'running',
      },
    });
    const succeededRecord = createRunWithSteps({
      run: {
        completedAt: new Date().toISOString(),
        status: 'succeeded',
      },
      step: {
        babyseaGenerationId: 'gen_already_succeeded',
        completedAt: new Date().toISOString(),
        status: 'succeeded',
      },
    });
    let getCalls = 0;
    let cancelGenerationCalled = false;
    const store = {
      getRunWithSteps: async () => {
        getCalls += 1;

        return getCalls === 1 ? record : succeededRecord;
      },
      updateActiveRun: async () => null,
    };
    const babysea = {
      cancelGeneration: async () => {
        cancelGenerationCalled = true;
      },
    };

    const result = await cancelRun(record.run.id, {
      babysea: babysea as never,
      store: store as never,
    });

    expect(cancelGenerationCalled).toBe(false);
    expect(result.run.status).toBe('succeeded');
  });

  it('marks client cancellation locally before canceling BabySea generation', async () => {
    let updatedRecord = createRunWithSteps({
      run: {
        currentStepKey: 'image',
        status: 'running',
      },
      step: {
        babyseaGenerationId: 'gen_client_canceled',
        startedAt: new Date().toISOString(),
        status: 'running',
      },
    });
    const order: string[] = [];
    const store = {
      claimCallbackDelivery: async () => false,
      getRunWithSteps: async () => updatedRecord,
      recordAuditEvent: async () => {
        order.push('audit');
      },
      updateActiveRun: async (
        _runId: string,
        patch: Record<string, unknown>,
      ) => {
        order.push('run');
        updatedRecord = {
          ...updatedRecord,
          run: {
            ...updatedRecord.run,
            ...patch,
          },
        };

        return updatedRecord.run;
      },
      updateRunningStep: async (
        _stepId: string,
        patch: Record<string, unknown>,
      ) => {
        order.push('step');
        updatedRecord = {
          ...updatedRecord,
          steps: [
            {
              ...updatedRecord.steps[0]!,
              ...patch,
            },
          ],
        };

        return updatedRecord.steps[0]!;
      },
    };
    const babysea = {
      cancelGeneration: async () => {
        order.push('babysea');
      },
    };

    const result = await cancelRun(updatedRecord.run.id, {
      babysea: babysea as never,
      store: store as never,
    });

    expect(order).toEqual(['run', 'step', 'babysea', 'audit']);
    expect(result.run.status).toBe('canceled');
    expect(result.steps[0]!.status).toBe('canceled');
  });

  it('ignores BabySea status updates after local cancellation wins', async () => {
    const record = createRunWithSteps({
      run: {
        currentStepKey: 'image',
        status: 'running',
      },
      step: {
        babyseaGenerationId: 'gen_late_webhook',
        startedAt: new Date().toISOString(),
        status: 'running',
      },
    });
    const canceledRecord = createRunWithSteps({
      run: {
        completedAt: new Date().toISOString(),
        status: 'canceled',
      },
      step: {
        babyseaGenerationId: 'gen_late_webhook',
        completedAt: new Date().toISOString(),
        status: 'canceled',
      },
    });
    let updateStepCalled = false;
    const store = {
      getRunWithSteps: async () => canceledRecord,
      updateRunningStep: async () => null,
      updateStep: async () => {
        updateStepCalled = true;
        throw new Error('late webhook should not update a terminal step');
      },
    };
    const babysea = {
      getGeneration: async () => ({
        data: {
          generation_completed_at: new Date().toISOString(),
          generation_id: 'gen_late_webhook',
          generation_output_file: ['https://cdn.example.com/output.png'],
          generation_provider_order: ['byteplus'],
          generation_provider_used: 'byteplus',
          generation_status: 'succeeded',
        },
        request_id: 'req_late_webhook',
      }),
    };

    const result = await processRun(record, {
      babysea: babysea as never,
      store: store as never,
    });

    expect(updateStepCalled).toBe(false);
    expect(result.run.status).toBe('canceled');
    expect(result.steps[0]!.status).toBe('canceled');
  });

  it('skips queued steps when an earlier step fails', async () => {
    const failedStepRecord = createRunWithSteps({
      run: {
        currentStepKey: null,
        status: 'running',
      },
      step: {
        completedAt: new Date().toISOString(),
        errorCode: 'provider_invalid_request',
        errorMessage: 'Alibaba Cloud responded 400.',
        status: 'failed',
      },
    });
    const queuedVideoStep = {
      ...failedStepRecord.steps[0]!,
      completedAt: null,
      dependsOn: ['image'],
      errorCode: null,
      errorMessage: null,
      id: '5f1c6f0a-95c5-4f1d-9f74-8f2f5b8f1c11',
      modelIdentifier: 'bytedance/seedance-1.5-pro',
      status: 'queued' as const,
      stepIndex: 1,
      stepKey: 'video',
      stepKind: 'video' as const,
    };
    let updatedRecord: ChainRunWithSteps = {
      ...failedStepRecord,
      steps: [failedStepRecord.steps[0]!, queuedVideoStep],
    };
    const store = {
      getRunWithSteps: async () => updatedRecord,
      updateActiveRun: async (
        _runId: string,
        patch: Record<string, unknown>,
      ) => {
        updatedRecord = {
          ...updatedRecord,
          run: { ...updatedRecord.run, ...patch },
        };
        return updatedRecord.run;
      },
      updateQueuedStep: async (
        stepId: string,
        patch: Record<string, unknown>,
      ) => {
        const stepIndex = updatedRecord.steps.findIndex(
          (step) => step.id === stepId && step.status === 'queued',
        );

        if (stepIndex < 0) {
          return null;
        }

        const updatedStep = {
          ...updatedRecord.steps[stepIndex]!,
          ...patch,
        } as ChainRunWithSteps['steps'][number];

        updatedRecord = {
          ...updatedRecord,
          steps: updatedRecord.steps.map((step, index) =>
            index === stepIndex ? updatedStep : step,
          ),
        };

        return updatedStep;
      },
    };

    const result = await processRun(updatedRecord, {
      store: store as never,
    });

    expect(result.run.status).toBe('failed');
    expect(result.run.errorCode).toBe('provider_invalid_request');
    // No input will ever arrive for the queued video step once the image
    // step has failed, so it must be skipped immediately, not left queued.
    expect(result.steps[1]!.status).toBe('skipped');
    expect(result.steps[1]!.completedAt).toBeTruthy();
  });

  it('skips queued steps when an earlier step failed on an awaiting_agent run', async () => {
    // A failure can be persisted while the run is parked at `awaiting_agent`
    // (e.g. a failed agent checkpoint). The run-get route now advances such a
    // run, and processRun must escalate the failure - failing the run and
    // marking the still-queued downstream step skipped, never left queued.
    const failedStepRecord = createRunWithSteps({
      run: {
        currentStepKey: null,
        status: 'awaiting_agent',
      },
      step: {
        completedAt: new Date().toISOString(),
        errorCode: 'provider_invalid_request',
        errorMessage: 'Alibaba Cloud responded 400.',
        status: 'failed',
      },
    });
    const queuedVideoStep = {
      ...failedStepRecord.steps[0]!,
      completedAt: null,
      dependsOn: ['image'],
      errorCode: null,
      errorMessage: null,
      id: '5f1c6f0a-95c5-4f1d-9f74-8f2f5b8f1c22',
      modelIdentifier: 'bytedance/seedance-1.5-pro',
      status: 'queued' as const,
      stepIndex: 1,
      stepKey: 'video',
      stepKind: 'video' as const,
    };
    let updatedRecord: ChainRunWithSteps = {
      ...failedStepRecord,
      steps: [failedStepRecord.steps[0]!, queuedVideoStep],
    };
    const store = {
      getRunWithSteps: async () => updatedRecord,
      updateActiveRun: async (
        _runId: string,
        patch: Record<string, unknown>,
      ) => {
        updatedRecord = {
          ...updatedRecord,
          run: { ...updatedRecord.run, ...patch },
        };
        return updatedRecord.run;
      },
      updateQueuedStep: async (
        stepId: string,
        patch: Record<string, unknown>,
      ) => {
        const stepIndex = updatedRecord.steps.findIndex(
          (step) => step.id === stepId && step.status === 'queued',
        );

        if (stepIndex < 0) {
          return null;
        }

        const updatedStep = {
          ...updatedRecord.steps[stepIndex]!,
          ...patch,
        } as ChainRunWithSteps['steps'][number];

        updatedRecord = {
          ...updatedRecord,
          steps: updatedRecord.steps.map((step, index) =>
            index === stepIndex ? updatedStep : step,
          ),
        };

        return updatedStep;
      },
    };

    const result = await processRun(updatedRecord, {
      store: store as never,
    });

    expect(result.run.status).toBe('failed');
    expect(result.steps[1]!.status).toBe('skipped');
    expect(result.steps[1]!.completedAt).toBeTruthy();
  });

  it('fails the chain when the next step cannot use a previous output', async () => {
    const firstStepRecord = createRunWithSteps({
      run: {
        currentStepKey: null,
        status: 'running',
      },
      step: {
        babyseaGenerationId: 'gen_empty_image',
        completedAt: new Date().toISOString(),
        outputFiles: [],
        status: 'succeeded',
      },
    });
    const videoStep = {
      ...firstStepRecord.steps[0]!,
      babyseaGenerationId: null,
      completedAt: null,
      dependsOn: ['image'],
      id: 'd432191c-f4b4-4ed9-b121-d2bd893d7e16',
      modelIdentifier: 'bytedance/seedance-1.5-pro',
      outputFiles: [],
      requestParams: null,
      startedAt: null,
      status: 'queued' as const,
      stepIndex: 1,
      stepKey: 'video',
      stepKind: 'video' as const,
    };
    let updatedRecord: ChainRunWithSteps = {
      ...firstStepRecord,
      steps: [firstStepRecord.steps[0]!, videoStep],
    };
    let claimQueuedStepCalled = false;
    const store = {
      claimQueuedStep: async () => {
        claimQueuedStepCalled = true;
        return null;
      },
      getRunWithSteps: async () => updatedRecord,
      updateActiveRun: async (
        _runId: string,
        patch: Record<string, unknown>,
      ) => {
        updatedRecord = {
          ...updatedRecord,
          run: {
            ...updatedRecord.run,
            ...patch,
          },
        };

        return updatedRecord.run;
      },
      updateQueuedStep: async (
        stepId: string,
        patch: Record<string, unknown>,
      ) => {
        const stepIndex = updatedRecord.steps.findIndex(
          (step) => step.id === stepId && step.status === 'queued',
        );

        if (stepIndex < 0) {
          return null;
        }

        const updatedStep = {
          ...updatedRecord.steps[stepIndex]!,
          ...patch,
        } as ChainRunWithSteps['steps'][number];

        updatedRecord = {
          ...updatedRecord,
          steps: updatedRecord.steps.map((step, index) =>
            index === stepIndex ? updatedStep : step,
          ),
        };

        return updatedStep;
      },
    };
    const babysea = {
      generate: async () => {
        throw new Error('generate should not be called');
      },
    };

    const result = await processRun(updatedRecord, {
      babysea: babysea as never,
      store: store as never,
    });

    expect(claimQueuedStepCalled).toBe(false);
    expect(result.run.status).toBe('failed');
    expect(result.run.errorCode).toBe('chain_step_params_failed');
    expect(result.steps[1]!.status).toBe('failed');
    expect(result.steps[1]!.errorMessage).toBe(
      'Required previous step output is missing.',
    );
  });

  it('uses storage-backed output URLs for normal downstream step handoff', async () => {
    const record = createRunWithSteps({
      run: {
        currentStepKey: null,
        status: 'running',
      },
      step: {
        babyseaGenerationId: 'gen_image',
        completedAt: new Date().toISOString(),
        outputFiles: ['data:image/png;base64,aW1hZ2U='],
        providerMetadata: {
          app_storage: {
            assets: [
              {
                content_type: 'image/png',
                output_index: 0,
                provider: 'aws-s3',
                storage_path:
                  'runs/af252a34-977d-4fc5-81ac-502d2fb94421/image/output-0.png',
                url: 'https://8.8.8.8/runs/af252a34-977d-4fc5-81ac-502d2fb94421/image/output-0.png',
              },
            ],
            provider: 'aws-s3',
          },
        },
        status: 'succeeded',
      },
    });
    const queuedVideoStep = {
      ...record.steps[0]!,
      babyseaGenerationId: null,
      completedAt: null,
      dependsOn: ['image'],
      id: '5f1c6f0a-95c5-4f1d-9f74-8f2f5b8f1c20',
      modelIdentifier: 'bytedance/seedance-1.5-pro',
      outputFiles: [],
      providerMetadata: null,
      requestParams: null,
      startedAt: null,
      status: 'queued' as const,
      stepIndex: 1,
      stepKey: 'video',
      stepKind: 'video' as const,
    };
    let updatedRecord: ChainRunWithSteps = {
      ...record,
      steps: [record.steps[0]!, queuedVideoStep],
    };
    let submittedParams: Record<string, unknown> | null = null;
    const store = createMutableAgentStore(updatedRecord, (next) => {
      updatedRecord = next;
    });
    const babysea = {
      generate: async (_model: string, params: Record<string, unknown>) => {
        submittedParams = params;

        return {
          data: { generation_id: 'gen_video' },
          idempotency_replayed: false,
          request_id: 'req_video',
        };
      },
    };

    const result = await processRun(updatedRecord, {
      babysea: babysea as never,
      store: store as never,
    });

    expect(result.run.status).toBe('running');
    expect(submittedParams).toMatchObject({
      generation_input_file: [
        'https://8.8.8.8/runs/af252a34-977d-4fc5-81ac-502d2fb94421/image/output-0.png',
      ],
    });
  });

  it('persists synchronous completed provider outputs through optional storage', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://app.example.com');
    vi.stubEnv('APP_API_KEY', 'bchn_test_key');
    vi.stubEnv('APP_CALLBACK_SECRET', 'callback_secret');
    vi.stubEnv('APP_CRON_SECRET', 'cron_secret');
    vi.stubEnv('DATABASE_URL', 'postgres://test:test@localhost:5432/test');
    vi.stubEnv('OPENAI_API_KEY', 'openai_test_key');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [{ b64_json: 'aW1hZ2U=' }],
            }),
            { status: 200 },
          ),
      ),
    );
    const record = createRunWithSteps({
      run: {
        byokCredentials: { mode: 'server_env', providers: ['openai'] },
      },
      step: {
        modelIdentifier: 'gpt/image-2',
      },
    });
    let updatedRecord = record;
    const store = createMutableAgentStore(updatedRecord, (next) => {
      updatedRecord = next;
    });
    const storageWrites: Array<{ contentType: string; key: string }> = [];
    const storage = {
      id: 'aws-s3' as const,
      label: 'test s3',
      store: async (input: { contentType: string; key: string }) => {
        storageWrites.push({ contentType: input.contentType, key: input.key });

        return {
          publicUrl: `https://cdn.example.com/${input.key}`,
          storagePath: input.key,
        };
      },
      remove: async () => undefined,
      removeByPrefix: async () => undefined,
    };

    const result = await processRun(record, {
      storage,
      store: store as never,
    });

    expect(result.steps[0]).toMatchObject({
      outputFiles: [
        'https://cdn.example.com/runs/af252a34-977d-4fc5-81ac-502d2fb94421/image/output-0.png',
      ],
      status: 'succeeded',
    });
    expect(result.steps[0]?.providerMetadata).toMatchObject({
      app_storage: {
        assets: [
          {
            output_index: 0,
            provider: 'aws-s3',
            url: 'https://cdn.example.com/runs/af252a34-977d-4fc5-81ac-502d2fb94421/image/output-0.png',
          },
        ],
      },
    });
    expect(storageWrites).toEqual([
      {
        contentType: 'image/png',
        key: 'runs/af252a34-977d-4fc5-81ac-502d2fb94421/image/output-0.png',
      },
    ]);
  });

  it('skips the agent model call when a concurrent processor already created the checkpoint', async () => {
    // Two processors (e.g. an overlapping cron tick and the BabySea webhook for
    // the previous step) can enter prepareAgentCheckpoint together. The first
    // commits the checkpoint while the second is still assembling context; the
    // second must not pay for a duplicate Bedrock call.
    const record = chainAgentRecord('autopilot');
    let updatedRecord = record;
    const baseStore = createMutableAgentStore(updatedRecord, (next) => {
      updatedRecord = next;
    });

    const now = new Date().toISOString();
    const concurrentCheckpoint = {
      id: '44444444-4444-4444-8444-444444444444',
      appliedAt: null,
      approvedAt: null,
      createdAt: now,
      errorCode: null,
      errorMessage: null,
      inputSnapshot: {},
      mode: 'autopilot' as const,
      modelIdentifier: 'us.amazon.nova-2-lite-v1:0',
      output: {},
      previousStepKey: 'image',
      provider: 'bedrock' as const,
      runId: record.run.id,
      selectedParams: { generation_prompt: 'A concurrent pick.' },
      selectedPrompt: 'A concurrent pick.',
      status: 'suggested' as const,
      stepKey: 'video',
      updatedAt: now,
    } satisfies ChainRunWithSteps['agentCheckpoints'][number];

    let lookups = 0;
    const store = {
      ...baseStore,
      getAgentCheckpointForStep: async () => {
        lookups += 1;
        // 1st call: the initial existing-checkpoint probe finds nothing.
        // 2nd call: the pre-call re-check sees the concurrent commit.
        return lookups >= 2 ? concurrentCheckpoint : null;
      },
    };

    let agentCalls = 0;
    const agent: ChainAgent = {
      suggestNextStep: async () => {
        agentCalls += 1;
        return {
          observations: {},
          observability: {},
          rawText: '{}',
          selectedParams: { generation_prompt: 'Should never be used.' },
          selectedPrompt: 'Should never be used.',
          suggestions: [],
        };
      },
    };

    const result = await processRun(record, {
      agent,
      babysea: {} as never,
      store: store as never,
    });

    expect(agentCalls).toBe(0);
    expect(lookups).toBeGreaterThanOrEqual(2);
    expect(result.run).toMatchObject({ status: 'awaiting_agent' });
  });

  it('pauses a Chain Agent Copilot run at the next checkpoint', async () => {
    const record = chainAgentRecord('copilot');
    let updatedRecord = record;
    let nextStepSchema: JsonObject | null = null;
    let nextStepRequestParams: JsonObject | null = null;
    const store = createMutableAgentStore(updatedRecord, (next) => {
      updatedRecord = next;
    });
    const agent = createPromptAgent({
      selectedPrompt: 'Slow cinematic dolly-in.',
      observability: {
        instruction_version: 'test-version',
        validation: { ok: true },
      },
      selectedParams: { generation_prompt: 'Slow cinematic dolly-in.' },
      onContext: (context) => {
        nextStepSchema = (context.nextStep.schema ?? null) as JsonObject | null;
        nextStepRequestParams = (context.nextStep.requestParams ??
          null) as JsonObject | null;
      },
    });

    const result = await processRun(record, {
      agent,
      babysea: {} as never,
      store: store as never,
    });

    expect(result.run).toMatchObject({ status: 'awaiting_agent' });
    expect(result.run.currentStepKey).toBe('video');
    expect(result.agentCheckpoints).toHaveLength(1);
    expect(result.agentCheckpoints[0]).toMatchObject({
      previousStepKey: 'image',
      status: 'suggested',
      stepKey: 'video',
    });
    expect(result.agentCheckpoints[0]!.output.observability).toMatchObject({
      instruction_version: 'test-version',
      validation: { ok: true },
    });
    expect(nextStepSchema).toMatchObject({
      properties: {
        generation_duration: expect.any(Object),
        generation_prompt: expect.any(Object),
      },
    });
    expect(nextStepRequestParams).toMatchObject({
      generation_duration: 4,
      generation_prompt: 'A user-filled downstream video prompt.',
    });
    expect(result.steps[1]!.status).toBe('queued');
  });

  it('passes storage-backed previous output URLs to Chain Agent context', async () => {
    const record = chainAgentRecord('copilot');
    record.steps[0] = {
      ...record.steps[0]!,
      providerMetadata: {
        app_storage: {
          assets: [
            {
              content_type: 'image/png',
              output_index: 0,
              provider: 'aws-s3',
              storage_path: `${record.run.id}/image/output-0.png`,
              url: `https://media.example.com/runs/${record.run.id}/image/output-0.png`,
            },
          ],
          provider: 'aws-s3',
        },
      },
    };
    let updatedRecord = record;
    let previousOutputFiles: string[] = [];
    const store = createMutableAgentStore(updatedRecord, (next) => {
      updatedRecord = next;
    });
    const agent = createPromptAgent({
      selectedPrompt: 'Slow cinematic dolly-in.',
      selectedParams: { generation_prompt: 'Slow cinematic dolly-in.' },
      onContext: (context) => {
        previousOutputFiles = context.previousStep.outputFiles;
      },
    });

    const result = await processRun(record, {
      agent,
      babysea: {} as never,
      store: store as never,
    });

    expect(result.run).toMatchObject({ status: 'awaiting_agent' });
    expect(previousOutputFiles).toEqual([
      `https://media.example.com/runs/${record.run.id}/image/output-0.png`,
    ]);
  });

  it('excludes reserved media fields from Chain Agent downstream schema', async () => {
    const record = chainAgentRecord('copilot', {
      videoModel: 'wan/2.7-r2v',
      videoModelInput: {
        generation_aspect_ratio: '16:9',
        generation_prompt: 'Animate the portrait naturally.',
      },
    });
    let updatedRecord = record;
    const observedSchemas: JsonObject[] = [];
    const store = createMutableAgentStore(updatedRecord, (next) => {
      updatedRecord = next;
    });
    const agent = createPromptAgent({
      selectedPrompt: 'A subtle portrait animation with a gentle focus pull.',
      selectedParams: {
        generation_aspect_ratio: '16:9',
      },
      onContext: (context) => {
        observedSchemas.push(context.nextStep.schema as JsonObject);
      },
    });

    const result = await processRun(record, {
      agent,
      babysea: {} as never,
      store: store as never,
    });

    expect(result.run).toMatchObject({ status: 'awaiting_agent' });
    const nextStepSchema = observedSchemas.at(0);
    expect(nextStepSchema).not.toBeNull();
    const nextStepProperties = nextStepSchema?.properties as JsonObject;
    expect(nextStepProperties).not.toHaveProperty(
      'generation_input_video_file',
    );
  });

  it('applies Chain Agent Autopilot prompt without overriding media handoff', async () => {
    const record = chainAgentRecord('autopilot');
    let updatedRecord = record;
    let submittedParams: Record<string, unknown> | null = null;
    const store = createMutableAgentStore(updatedRecord, (next) => {
      updatedRecord = next;
    });
    const agent = createPromptAgent({
      selectedPrompt: 'Elegant orbit with warm highlights.',
      selectedParams: {
        generation_duration: 6,
        generation_input_file: ['https://attacker.example.com/skip.png'],
        generation_input_video_file: ['https://attacker.example.com/skip.mp4'],
        generation_prompt: 'Elegant orbit with warm highlights.',
      },
    });
    const babysea = {
      generate: async (_model: string, params: Record<string, unknown>) => {
        submittedParams = params;

        return {
          data: { generation_id: 'gen_agent_video' },
          idempotency_replayed: false,
          request_id: 'req_agent_video',
        };
      },
    };

    const result = await processRun(record, {
      agent,
      babysea: babysea as never,
      store: store as never,
    });

    expect(result.run.status).toBe('running');
    expect(result.run.currentStepKey).toBe('video');
    expect(result.agentCheckpoints[0]).toMatchObject({ status: 'applied' });
    expect(submittedParams).toMatchObject({
      generation_duration: 6,
      generation_input_file: ['data:image/png;base64,aW1hZ2U='],
      generation_prompt: 'Elegant orbit with warm highlights.',
    });
    expect(submittedParams).not.toHaveProperty('generation_input_video_file');
  });

  it('preserves caller downstream params when completing omitted optional agent fields', async () => {
    const selectedPrompt = 'Elegant orbit with warm highlights.';
    const record = chainAgentRecord('autopilot', {
      videoModelInput: {
        generation_aspect_ratio: '9:16',
        generation_duration: 8,
        generation_prompt: 'Animate the product naturally.',
        generation_resolution: '1080p',
      },
    });
    let updatedRecord = record;
    let submittedParams: Record<string, unknown> | null = null;
    const store = createMutableAgentStore(updatedRecord, (next) => {
      updatedRecord = next;
    });
    const agent = createPromptAgent({
      selectedPrompt,
      selectedParams: {
        generation_prompt: selectedPrompt,
      },
    });
    const babysea = {
      generate: async (_model: string, params: Record<string, unknown>) => {
        submittedParams = params;

        return {
          data: { generation_id: 'gen_agent_video' },
          idempotency_replayed: false,
          request_id: 'req_agent_video',
        };
      },
    };

    const result = await processRun(record, {
      agent,
      babysea: babysea as never,
      store: store as never,
    });

    expect(result.run.status).toBe('running');
    expect(submittedParams).toMatchObject({
      generation_aspect_ratio: '9:16',
      generation_duration: 8,
      generation_prompt: selectedPrompt,
      generation_resolution: '1080p',
    });
  });

  it('preserves full agent generation prompt when selected prompt is short', async () => {
    const record = chainAgentRecord('autopilot');
    let updatedRecord = record;
    let submittedParams: Record<string, unknown> | null = null;
    const fullPrompt =
      'The product remains centered as the camera makes a smooth slow orbit, warm highlights glide across the surface, and the background bokeh breathes naturally.';
    const store = createMutableAgentStore(updatedRecord, (next) => {
      updatedRecord = next;
    });
    const agent = createPromptAgent({
      selectedPrompt: fullPrompt,
      selectedParams: {
        generation_duration: 6,
        generation_prompt: fullPrompt,
      },
    });
    const babysea = {
      generate: async (_model: string, params: Record<string, unknown>) => {
        submittedParams = params;

        return {
          data: { generation_id: 'gen_agent_video' },
          idempotency_replayed: false,
          request_id: 'req_agent_video',
        };
      },
    };

    const result = await processRun(record, {
      agent,
      babysea: babysea as never,
      store: store as never,
    });

    expect(result.run.status).toBe('running');
    expect(submittedParams).toMatchObject({
      generation_prompt: fullPrompt,
    });
    expect(result.agentCheckpoints[0]?.selectedPrompt).toBe(fullPrompt);
    expect(result.agentCheckpoints[0]?.selectedParams).toMatchObject({
      generation_prompt: fullPrompt,
    });
  });

  it('rejects invalid injected Chain Agent params before checkpoint creation', async () => {
    const record = chainAgentRecord('autopilot');
    let updatedRecord = record;
    const store = createMutableAgentStore(updatedRecord, (next) => {
      updatedRecord = next;
    });
    const agent = createPromptAgent({
      selectedPrompt: 'Elegant orbit with warm highlights.',
      selectedParams: {
        generation_duration: 99,
        generation_prompt: 'Elegant orbit with warm highlights.',
      },
    });

    const result = await processRun(record, {
      agent,
      babysea: {} as never,
      store: store as never,
    });

    expect(result.run.status).toBe('failed');
    expect(result.run.errorCode).toBe('chain_agent_invalid_response');
    expect(result.agentCheckpoints).toHaveLength(0);
  });

  it('rejects invalid Chain Agent Copilot approval params', async () => {
    const record = chainAgentRecord('copilot');
    let updatedRecord = record;
    const store = createMutableAgentStore(updatedRecord, (next) => {
      updatedRecord = next;
    });
    const agent = createPromptAgent({
      selectedPrompt: 'Slow cinematic dolly-in over the finished product.',
      selectedParams: {
        generation_duration: 4,
        generation_prompt: 'Slow cinematic dolly-in over the finished product.',
      },
    });
    const paused = await processRun(record, {
      agent,
      babysea: {} as never,
      store: store as never,
    });
    const checkpointId = paused.agentCheckpoints[0]!.id;

    await expect(
      continueAgentRun(
        paused.run.id,
        {
          checkpointId,
          selectedParams: {
            generation_duration: 99,
            generation_prompt:
              'Slow cinematic dolly-in over the finished product.',
          },
          selectedPrompt: 'Slow cinematic dolly-in over the finished product.',
        },
        { babysea: {} as never, store: store as never },
      ),
    ).rejects.toMatchObject({
      code: 'chain_agent_invalid_checkpoint',
      status: 400,
    });
  });
});

describe('runner response presentation', () => {
  it('keeps BabySea SDK identifiers in BabySea mode', () => {
    const record = createRunWithSteps({
      run: {
        output: { final_step_key: 'image' },
        status: 'succeeded',
      },
      step: {
        babyseaGenerationId: 'gen_babysea_123',
        babyseaIdempotencyReplayed: false,
        babyseaPredictionId: 'pred_babysea_123',
        babyseaRequestId: 'req_babysea_123',
        completedAt: new Date().toISOString(),
        outputFiles: ['https://cdn.example.com/babysea.png'],
        providerOrder: ['byteplus', 'fal'],
        providerUsed: 'byteplus',
        status: 'succeeded',
      },
    });

    const response = serializeRunWithSteps(record) as SerializedRunResponse;
    const step = response.steps[0]!;

    expect(response.mode).toBe('babysea');
    expect(response).not.toHaveProperty('estimate');
    expect(response).not.toHaveProperty('output');
    expect(response).not.toHaveProperty('completed_at');
    expect(response.current_step_key).toBe('completed');
    expect(response.input.chain_models).toEqual({
      image_model: 'bytedance/seedream-4.5',
    });
    expect(step).toMatchObject({
      babysea_generation_id: 'gen_babysea_123',
      babysea_idempotency_replayed: false,
      completed_at: expect.any(String),
      generation_output_file: ['https://cdn.example.com/babysea.png'],
      babysea_prediction_id: 'pred_babysea_123',
      babysea_request_id: 'req_babysea_123',
      provider_order: ['byteplus', 'fal'],
      provider_used: 'byteplus',
      started_at: null,
    });
    expect(step).not.toHaveProperty('provider_generation_id');
    expect(step).not.toHaveProperty('output_files');
    expect(step).not.toHaveProperty('request_params');
  });

  it('uses provider identifiers and strips BabySea-only fields in BYOK mode', () => {
    const record = createRunWithSteps({
      run: {
        byokCredentials: { mode: 'server_env', providers: ['bfl'] },
        output: {
          final_step_key: 'image',
          model_results: [{ babysea_generation_id: 'old_leaked_id' }],
          output_files: ['https://cdn.example.com/old.png'],
          steps: {
            image: { babysea_generation_id: 'old_leaked_id' },
          },
        },
        status: 'succeeded',
      },
      step: {
        babyseaGenerationId: 'bfl_task_123',
        babyseaPredictionId: null,
        babyseaRequestId: null,
        completedAt: new Date().toISOString(),
        dependsOn: ['image'],
        modelIdentifier: 'bfl/flux-1.1-pro',
        outputFiles: ['https://cdn.example.com/byok.png'],
        providerOrder: ['bfl'],
        providerMetadata: {
          output_expires_at: '2026-06-03T10:10:00.000Z',
          polling_url: 'https://api.bfl.ai/v1/get_result?id=bfl_task_123',
        },
        providerUsed: 'bfl',
        requestParams: {
          babysea_generation_id: 'internal_babysea_id',
          generation_input_file: ['https://cdn.example.com/input.png'],
          generation_output_file: ['https://cdn.example.com/output.png'],
          generation_output_format: 'png',
          generation_output_number: 1,
          generation_provider_order: ['bfl'],
          provider_request_id: 'internal_provider_request_id',
          prompt: 'A product render',
        },
        status: 'succeeded',
      },
    });

    const response = serializeRunWithSteps(record) as SerializedRunResponse;
    const step = response.steps[0]!;

    expect(response.mode).toBe('byok');
    expect(response).not.toHaveProperty('estimate');
    expect(response).not.toHaveProperty('output');
    expect(response).not.toHaveProperty('completed_at');
    expect(response.current_step_key).toBe('completed');
    expect(step).not.toHaveProperty('babysea_generation_id');
    expect(step).not.toHaveProperty('babysea_prediction_id');
    expect(step).not.toHaveProperty('babysea_request_id');
    expect(step).not.toHaveProperty('provider_generation_id');
    expect(step).not.toHaveProperty('provider_prediction_id');
    expect(step).not.toHaveProperty('provider_request_id');
    expect(step).not.toHaveProperty('provider_order');
    expect(step).not.toHaveProperty('provider_used');
    expect(step).not.toHaveProperty('request_params');
    expect(step).not.toHaveProperty('output_files');
    expect(step).not.toHaveProperty('generation_output_format');
    expect(step).not.toHaveProperty('generation_output_number');
    expect(step).not.toHaveProperty('generation_provider_order');
    expect(step.provider_metadata).toEqual({
      output_expires_at: '2026-06-03T10:10:00.000Z',
    });
    expect(step).toMatchObject({
      completed_at: expect.any(String),
      generation_input_file: ['https://cdn.example.com/input.png'],
      generation_output_file: ['https://cdn.example.com/byok.png'],
      started_at: null,
    });
  });

  it('serializes inline output media as authenticated output URLs', () => {
    const record = createRunWithSteps({
      step: {
        outputFiles: [
          'data:image/jpeg;base64,aW1hZ2U=',
          'https://cdn.example.com/output.png',
          'data:image/png;charset=utf-8;base64,cGFyYW1ldGVycw==',
        ],
        status: 'succeeded',
      },
    });

    const response = serializeRunWithSteps(record) as SerializedRunResponse;
    const step = response.steps[0]!;

    expect(step.generation_output_file).toEqual([
      '/api/v1/chains/get/af252a34-977d-4fc5-81ac-502d2fb94421/outputs/image/0',
      'https://cdn.example.com/output.png',
      '/api/v1/chains/get/af252a34-977d-4fc5-81ac-502d2fb94421/outputs/image/2',
    ]);
    expect(JSON.stringify(response)).not.toContain('data:image/jpeg;base64');
    expect(JSON.stringify(response)).not.toContain('data:image/png');
  });

  it('serializes storage-backed output URLs instead of inline output routes', () => {
    const record = createRunWithSteps({
      step: {
        outputFiles: ['data:image/jpeg;base64,aW1hZ2U='],
        providerMetadata: {
          app_storage: {
            assets: [
              {
                content_type: 'image/jpeg',
                output_index: 0,
                provider: 'aws-s3',
                storage_path:
                  'runs/af252a34-977d-4fc5-81ac-502d2fb94421/image/output-0.jpg',
                url: 'https://media.example.com/runs/af252a34-977d-4fc5-81ac-502d2fb94421/image/output-0.jpg',
              },
            ],
            provider: 'aws-s3',
          },
        },
        status: 'succeeded',
      },
    });

    const response = serializeRunWithSteps(record) as SerializedRunResponse;
    const step = response.steps[0]!;

    expect(step.generation_output_file).toEqual([
      'https://media.example.com/runs/af252a34-977d-4fc5-81ac-502d2fb94421/image/output-0.jpg',
    ]);
    expect(JSON.stringify(response)).not.toContain('/outputs/image/0');
  });

  it('does not shift storage-backed output URLs after partial storage success', () => {
    const record = createRunWithSteps({
      step: {
        outputFiles: [
          'data:image/jpeg;base64,Zmlyc3Q=',
          'data:image/jpeg;base64,c2Vjb25k',
        ],
        providerMetadata: {
          app_storage: {
            assets: [
              {
                content_type: 'image/jpeg',
                output_index: 1,
                provider: 'aws-s3',
                storage_path:
                  'runs/af252a34-977d-4fc5-81ac-502d2fb94421/image/output-1.jpg',
                url: 'https://media.example.com/runs/af252a34-977d-4fc5-81ac-502d2fb94421/image/output-1.jpg',
              },
            ],
            provider: 'aws-s3',
          },
        },
        status: 'succeeded',
      },
    });

    const response = serializeRunWithSteps(record) as SerializedRunResponse;
    const step = response.steps[0]!;

    expect(step.generation_output_file).toEqual([
      '/api/v1/chains/get/af252a34-977d-4fc5-81ac-502d2fb94421/outputs/image/0',
      'https://media.example.com/runs/af252a34-977d-4fc5-81ac-502d2fb94421/image/output-1.jpg',
    ]);
  });

  it('serves parameterized inline output media with the original content type', async () => {
    const response = createDataUrlOutputResponse(
      'data:image/png;charset=utf-8;base64,cGFyYW1ldGVycw==',
    );

    expect(response).not.toBeNull();
    expect(response?.headers.get('content-type')).toBe(
      'image/png;charset=utf-8',
    );
    expect(response?.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response?.text()).toBe('parameters');
  });

  it('serializes completed run output summaries without inline media', () => {
    const output = serializeCompletedRunOutput(
      createRunWithSteps({
        run: {
          status: 'succeeded',
        },
        step: {
          outputFiles: ['data:image/jpeg;base64,aW1hZ2U='],
          status: 'succeeded',
        },
      }),
    );

    expect(output).toEqual({
      final_step_key: 'image',
      output_files: [
        '/api/v1/chains/get/af252a34-977d-4fc5-81ac-502d2fb94421/outputs/image/0',
      ],
    });
    expect(JSON.stringify(output)).not.toContain('data:image/jpeg;base64');
  });

  it('serializes downstream handoff inputs without inline media', () => {
    const inlineOutput = 'data:image/jpeg;base64,aW1hZ2U=';
    const secondInlineOutput = 'data:image/png;base64,c2Vjb25k';
    const record = createRunWithSteps();
    const imageStep = record.steps[0]!;
    const videoStep = {
      ...imageStep,
      dependsOn: ['image'],
      id: 'b0c978db-71e9-4558-b042-05e5deae83bd',
      modelIdentifier: 'google/veo-3.1-fast',
      outputFiles: [],
      requestParams: {
        generation_input_file: [secondInlineOutput],
      },
      stepIndex: 1,
      stepKey: 'video',
      stepKind: 'video' as const,
    };

    const response = serializeRunWithSteps({
      ...record,
      steps: [
        {
          ...imageStep,
          outputFiles: [inlineOutput, secondInlineOutput],
          status: 'succeeded',
        },
        videoStep,
      ],
    }) as SerializedRunResponse;
    const video = response.steps.find((step) => step.step_key === 'video');

    expect(video?.generation_input_file).toEqual([
      '/api/v1/chains/get/af252a34-977d-4fc5-81ac-502d2fb94421/outputs/image/1',
    ]);
    expect(JSON.stringify(response)).not.toContain('data:image/jpeg;base64');
    expect(JSON.stringify(response)).not.toContain('data:image/png;base64');
  });

  it('does not duplicate caller-provided initial image inputs at step level', () => {
    const record = createRunWithSteps({
      run: {
        input: {
          image_model: 'bytedance/seedream-5-lite',
          image_model_input: {
            generation_input_file: ['https://cdn.example.com/source.jpg'],
            generation_prompt: 'Refine the source image',
          },
        },
      },
      step: {
        modelIdentifier: 'bytedance/seedream-5-lite',
        requestParams: {
          generation_input_file: ['https://cdn.example.com/source.jpg'],
          generation_prompt: 'Refine the source image',
        },
        stepKey: 'image',
      },
    });

    const response = serializeRunWithSteps(record) as SerializedRunResponse;
    const step = response.steps[0]!;

    expect(response.input.image_model_input).toEqual({
      generation_input_file: ['https://cdn.example.com/source.jpg'],
      generation_prompt: 'Refine the source image',
    });
    expect(step).not.toHaveProperty('generation_input_file');
  });

  it('keeps the test-3 base step fields with nullable timing fields', () => {
    const record = createRunWithSteps();

    const response = serializeRunWithSteps(record) as SerializedRunResponse;
    const step = response.steps[0]!;

    expect(response).not.toHaveProperty('output');
    expect(response).not.toHaveProperty('estimate');
    expect(response).not.toHaveProperty('error');
    expect(response.current_step_key).toBe('processing');
    expect(response).not.toHaveProperty('callback_status');
    expect(response).not.toHaveProperty('client_request_id');
    expect(response).not.toHaveProperty('completed_at');
    expect(response).not.toHaveProperty('metadata');
    expect(step.depends_on).toEqual([]);
    expect(step.started_at).toBeNull();
    expect(step.completed_at).toBeNull();
    expect(step).not.toHaveProperty('request_params');
    expect(step).not.toHaveProperty('output_files');
    expect(step).not.toHaveProperty('generation_input_file');
    expect(step).not.toHaveProperty('generation_output_file');
    expect(step).not.toHaveProperty('error');
  });

  it('keeps the same top-level lifecycle response shape as values arrive', () => {
    const queued = serializeRunWithSteps(
      createRunWithSteps({
        run: {
          estimate: {
            currency: 'credits',
            steps: [],
            total: 0,
          },
        },
      }),
    ) as SerializedRunResponse;
    const running = serializeRunWithSteps(
      createRunWithSteps({
        run: {
          currentStepKey: 'image',
          estimate: {
            currency: 'credits',
            steps: [],
            total: 0,
          },
          status: 'running',
        },
        step: {
          requestParams: { prompt: 'A product render' },
          startedAt: new Date().toISOString(),
          status: 'running',
        },
      }),
    ) as SerializedRunResponse;
    const succeeded = serializeRunWithSteps(
      createRunWithSteps({
        run: {
          completedAt: new Date().toISOString(),
          output: { final_step_key: 'image' },
          status: 'succeeded',
        },
        step: {
          completedAt: new Date().toISOString(),
          outputFiles: ['https://cdn.example.com/output.png'],
          requestParams: { prompt: 'A product render' },
          status: 'succeeded',
        },
      }),
    ) as SerializedRunResponse;

    expect(Object.keys(queued)).toEqual(Object.keys(running));
    expect(Object.keys(running)).toEqual(Object.keys(succeeded));
    expect(queued.current_step_key).toBe('processing');
    expect(running.current_step_key).toBe('image');
    expect(succeeded.current_step_key).toBe('completed');
    expect(queued.steps[0]).toMatchObject({
      started_at: null,
      completed_at: null,
    });
    expect(running.steps[0]).toMatchObject({
      started_at: expect.any(String),
      completed_at: null,
    });
    expect(succeeded.steps[0]).toMatchObject({
      completed_at: expect.any(String),
      generation_output_file: ['https://cdn.example.com/output.png'],
    });
  });

  it('adds actionable guidance to failed run and step errors', () => {
    const record = createRunWithSteps({
      run: {
        completedAt: new Date().toISOString(),
        errorCode: 'provider_unexpected_response',
        errorMessage: 'BytePlus image response contained no URLs.',
        status: 'failed',
      },
      step: {
        completedAt: new Date().toISOString(),
        errorCode: 'provider_unexpected_response',
        errorMessage: 'BytePlus image response contained no URLs.',
        status: 'failed',
      },
    });

    const response = serializeRunWithSteps(record) as SerializedRunResponse;

    expect(response.error).toMatchObject({
      code: 'provider_unexpected_response',
      guidance: {
        summary: 'The provider completed without a usable media URL.',
        what_to_try_next: expect.arrayContaining([
          'Retry with a simpler prompt or a model that is known to return URL media.',
        ]),
      },
    });
    expect(response.steps[0]!.error).toEqual(response.error);
    expect(response.timeline[0]!.error).toEqual(response.error);
  });

  it('groups multi-step selected models under input.chain_models', () => {
    const base = createRunWithSteps({
      run: {
        input: {
          image_model: 'bfl/flux-1.1-pro',
          video_model: 'bytedance/seedance-1-pro-fast',
          image_model_input: { prompt: 'A product render' },
          video_model_input: { duration: 2, ratio: '16:9' },
        },
      },
      step: {
        modelIdentifier: 'bfl/flux-1.1-pro',
        stepKey: 'image',
      },
    });
    const record: ChainRunWithSteps = {
      ...base,
      steps: [
        base.steps[0]!,
        {
          ...base.steps[0]!,
          dependsOn: ['image'],
          id: '7a53c981-fc9d-4d85-aab4-8363b5ee1a8c',
          modelIdentifier: 'bytedance/seedance-1-pro-fast',
          stepIndex: 1,
          stepKey: 'video',
          stepKind: 'video',
        },
      ],
    };

    const response = serializeRunWithSteps(record) as SerializedRunResponse;

    expect(Object.keys(response.input)).toEqual([
      'chain_models',
      'image_model_input',
      'video_model_input',
    ]);
    expect(response.input.chain_models).toEqual({
      image_model: 'bfl/flux-1.1-pro',
      video_model: 'bytedance/seedance-1-pro-fast',
    });
    expect(response.input).not.toHaveProperty('image_model');
    expect(response.input).not.toHaveProperty('video_model');
  });
});

type SerializedRunResponse = {
  current_step_key: string;
  error?: Record<string, unknown>;
  input: Record<string, unknown>;
  mode: string;
  steps: Array<Record<string, unknown>>;
  timeline: Array<Record<string, unknown>>;
};

function createRunWithSteps(
  overrides: {
    run?: Partial<ChainRunWithSteps['run']>;
    step?: Partial<ChainRunWithSteps['steps'][number]>;
    steps?: ChainRunWithSteps['steps'];
  } = {},
): ChainRunWithSteps {
  const now = new Date().toISOString();

  return {
    run: {
      apiKeyId: null,
      apiKeyPrefix: 'bchn_alpha',
      callbackClaimedAt: null,
      callbackStatus: null,
      callbackUrl: null,
      chainSlug: 'chain',
      chainVersion: '2026-06-01',
      clientRequestId: null,
      completedAt: null,
      createdAt: now,
      currentStepKey: null,
      errorCode: null,
      errorMessage: null,
      estimate: null,
      executionConfig: { type: 'self_control' },
      id: 'af252a34-977d-4fc5-81ac-502d2fb94421',
      idempotencyKeyHash: null,
      input: {
        image_model: 'bytedance/seedream-4.5',
        image_model_input: {
          generation_prompt: 'A product render',
        },
        video_model_input: {
          generation_duration: 4,
        },
      },
      metadata: {},
      output: null,
      status: 'queued',
      updatedAt: now,
      byokCredentials: null,
      ...overrides.run,
    },
    steps: overrides.steps ?? [
      {
        babyseaGenerationId: null,
        babyseaIdempotencyReplayed: null,
        babyseaPredictionId: null,
        babyseaRequestId: null,
        completedAt: null,
        createdAt: now,
        dependsOn: [],
        errorCode: null,
        errorMessage: null,
        id: '7a53c981-fc9d-4d85-aab4-8363b5ee1a8b',
        modelIdentifier: 'bytedance/seedream-4.5',
        outputFiles: [],
        providerMetadata: null,
        providerOrder: [],
        providerUsed: null,
        requestParams: null,
        runId: 'af252a34-977d-4fc5-81ac-502d2fb94421',
        startedAt: null,
        status: 'queued',
        stepIndex: 0,
        stepKey: 'image',
        stepKind: 'image',
        updatedAt: now,
        ...overrides.step,
      },
    ],
    agentCheckpoints: [],
  };
}

function chainAgentRecord(
  mode: 'autopilot' | 'copilot',
  options: {
    videoModel?: string;
    videoModelInput?: JsonObject;
  } = {},
): ChainRunWithSteps {
  const videoModel = options.videoModel ?? 'bytedance/seedance-1.5-pro';
  const videoModelInput = options.videoModelInput ?? {
    generation_duration: 4,
    generation_prompt: 'A user-filled downstream video prompt.',
  };
  const base = createRunWithSteps({
    run: {
      executionConfig: {
        type: 'chain_agent',
        mode,
        provider: 'bedrock',
        modelIdentifier: 'us.amazon.nova-2-lite-v1:0',
      },
      input: {
        image_model: 'bytedance/seedream-4.5',
        image_model_input: {
          generation_prompt: 'A premium product render',
        },
        video_model: videoModel,
        video_model_input: videoModelInput,
      },
      status: 'running',
    },
    step: {
      babyseaGenerationId: 'gen_agent_image',
      completedAt: new Date().toISOString(),
      outputFiles: ['data:image/png;base64,aW1hZ2U='],
      requestParams: { generation_prompt: 'A premium product render' },
      status: 'succeeded',
    },
  });

  return {
    ...base,
    steps: [
      base.steps[0]!,
      {
        ...base.steps[0]!,
        babyseaGenerationId: null,
        completedAt: null,
        dependsOn: ['image'],
        id: '5f1c6f0a-95c5-4f1d-9f74-8f2f5b8f1c12',
        modelIdentifier: videoModel,
        outputFiles: [],
        requestParams: null,
        startedAt: null,
        status: 'queued',
        stepIndex: 1,
        stepKey: 'video',
        stepKind: 'video',
      },
    ],
  };
}

function createPromptAgent(input: {
  onContext?: (context: Parameters<ChainAgent['suggestNextStep']>[0]) => void;
  observability?: JsonObject;
  selectedParams: JsonObject;
  selectedPrompt: string;
}): ChainAgent {
  return {
    suggestNextStep: async (context) => {
      input.onContext?.(context);

      return {
        observations: { mood: 'premium' },
        observability: input.observability ?? {},
        rawText: '{}',
        selectedParams: input.selectedParams,
        selectedPrompt: input.selectedPrompt,
        suggestions: [
          {
            title: 'Cinematic',
            prompt: input.selectedPrompt,
          },
        ],
      };
    },
  };
}

function createMutableAgentStore(
  initialRecord: ChainRunWithSteps,
  setRecord: (record: ChainRunWithSteps) => void,
) {
  let currentRecord = initialRecord;
  const updateRecord = (
    updater: (record: ChainRunWithSteps) => ChainRunWithSteps,
  ) => {
    currentRecord = updater(currentRecord);
    setRecord(currentRecord);
  };

  return {
    claimQueuedStep: async (stepId: string, patch: Record<string, unknown>) => {
      const step = currentRecord.steps.find(
        (candidate) => candidate.id === stepId && candidate.status === 'queued',
      );

      if (!step) return null;

      const updatedStep = {
        ...step,
        ...patch,
      } as ChainRunWithSteps['steps'][number];
      updateRecord((record) => ({
        ...record,
        steps: record.steps.map((candidate) =>
          candidate.id === stepId ? updatedStep : candidate,
        ),
      }));

      return updatedStep;
    },
    createAgentCheckpoint: async (input: {
      inputSnapshot: JsonObject;
      mode: 'autopilot' | 'copilot';
      modelIdentifier: string;
      output: JsonObject;
      previousStepKey: string;
      provider: 'bedrock';
      runId: string;
      selectedParams?: JsonObject | null;
      selectedPrompt?: string | null;
      status: 'approved' | 'suggested';
      stepKey: string;
    }) => {
      const now = new Date().toISOString();
      const checkpoint = {
        id: '33333333-3333-4333-8333-333333333333',
        appliedAt: null,
        approvedAt: input.status === 'approved' ? now : null,
        createdAt: now,
        errorCode: null,
        errorMessage: null,
        inputSnapshot: input.inputSnapshot,
        mode: input.mode,
        modelIdentifier: input.modelIdentifier,
        output: input.output,
        previousStepKey: input.previousStepKey,
        provider: input.provider,
        runId: input.runId,
        selectedParams: input.selectedParams ?? null,
        selectedPrompt: input.selectedPrompt ?? null,
        status: input.status,
        stepKey: input.stepKey,
        updatedAt: now,
      } satisfies ChainRunWithSteps['agentCheckpoints'][number];
      updateRecord((record) => ({
        ...record,
        agentCheckpoints: [...record.agentCheckpoints, checkpoint],
      }));

      return checkpoint;
    },
    getAgentCheckpointForStep: async (runId: string, stepKey: string) =>
      currentRecord.agentCheckpoints.find(
        (checkpoint) =>
          checkpoint.runId === runId && checkpoint.stepKey === stepKey,
      ) ?? null,
    getRunWithSteps: async () => currentRecord,
    markAgentCheckpointApplied: async (checkpointId: string) => {
      let updated = null as
        ChainRunWithSteps['agentCheckpoints'][number] | null;
      updateRecord((record) => ({
        ...record,
        agentCheckpoints: record.agentCheckpoints.map((checkpoint) => {
          if (checkpoint.id !== checkpointId) return checkpoint;
          updated = {
            ...checkpoint,
            appliedAt: new Date().toISOString(),
            status: 'applied',
          };
          return updated;
        }),
      }));
      return updated;
    },
    recordAuditEvent: async () => undefined,
    updateActiveRun: async (_runId: string, patch: Record<string, unknown>) => {
      if (
        !['queued', 'running', 'awaiting_agent'].includes(
          currentRecord.run.status,
        )
      ) {
        return null;
      }

      updateRecord((record) => ({
        ...record,
        run: { ...record.run, ...patch },
      }));

      return currentRecord.run;
    },
    updateQueuedStep: async (
      stepId: string,
      patch: Record<string, unknown>,
    ) => {
      const step = currentRecord.steps.find(
        (candidate) => candidate.id === stepId && candidate.status === 'queued',
      );

      if (!step) return null;

      const updatedStep = {
        ...step,
        ...patch,
      } as ChainRunWithSteps['steps'][number];
      updateRecord((record) => ({
        ...record,
        steps: record.steps.map((candidate) =>
          candidate.id === stepId ? updatedStep : candidate,
        ),
      }));

      return updatedStep;
    },
    updateRunningStep: async (
      stepId: string,
      patch: Record<string, unknown>,
    ) => {
      const step = currentRecord.steps.find(
        (candidate) =>
          candidate.id === stepId && candidate.status === 'running',
      );

      if (!step) return null;

      const updatedStep = {
        ...step,
        ...patch,
      } as ChainRunWithSteps['steps'][number];
      updateRecord((record) => ({
        ...record,
        steps: record.steps.map((candidate) =>
          candidate.id === stepId ? updatedStep : candidate,
        ),
      }));

      return updatedStep;
    },
  };
}
