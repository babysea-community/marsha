import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { NextRequest } from 'next/server';

import { POST as cancelRunRoute } from '@/app/api/v1/chains/cancel/[runId]/route';
import { POST as continueRunRoute } from '@/app/api/v1/chains/continue/[runId]/route';
import { GET as getRunRoute } from '@/app/api/v1/chains/get/[runId]/route';
import { POST as createRunRoute } from '@/app/api/v1/chains/runs/route';
import { requireOwnerSession } from '@/lib/auth/owner';
import {
  getCanvas,
  getWorkspaceCanvas,
  recordWorkspaceFlowRun,
  renameCanvas,
  saveCanvas,
  saveWorkspaceCanvas,
  type SaveCanvasInput,
} from '@/lib/canvas/canvas-store';
import type { StoredCanvasNode } from '@/lib/canvas/canvas-library';
import { formatPublicModelName } from '@/lib/models/display';
import { chainFieldModeForRole } from '@/lib/models/chain-schema';
import type { ModelProvider } from '@/lib/models/model-catalog';
import { listModelCatalog } from '@/lib/models/model-library';
import {
  getMediaDrivenSchemaOptionsForRole,
  getSemanticModelSchemaFields,
  isImageInputCapableModel,
  isImageToVideoChainModel,
  isVideoToVideoChainModel,
  semanticFieldJsonSchema,
} from '@/lib/models/semantic-schema';
import { AppError } from '@/lib/utils/errors';
import { getAppApiKeys, getEnv, type AppEnv } from '@/lib/utils/env';
import type { ByokProviderName } from '@/lib/providers';

import { Canvas } from './canvas';
import type { FieldGroup, FieldSpec, CanvasModel, StepRole } from './canvas';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Chain' };

const PROVIDER_LABELS: Record<string, string> = {
  'black-forest-labs': 'Black Forest Labs',
  'alibaba-cloud': 'Alibaba Cloud',
  byteplus: 'BytePlus',
  google: 'Google',
  openai: 'OpenAI',
  runway: 'Runway',
};

const INTERNAL_ROUTE_ORIGIN = 'http://localhost';
type InternalRequestInit = ConstructorParameters<typeof NextRequest>[1];
const PUBLIC_OUTPUT_ROUTE_PREFIX = '/api/v1/chains/get/';
const DASHBOARD_OUTPUT_ROUTE_PREFIX = '/api/dashboard/chains/get/';

function rolesForModel(
  modelIdentifier: string,
  kind: 'image' | 'video',
): StepRole[] {
  if (kind === 'image') {
    const roles: StepRole[] = ['image'];
    if (isImageInputCapableModel(modelIdentifier)) {
      roles.push('refine');
    }
    return roles;
  }

  const roles: StepRole[] = [];
  if (isImageToVideoChainModel(modelIdentifier)) {
    roles.push('video');
  }
  if (isVideoToVideoChainModel(modelIdentifier)) {
    roles.push('modify');
  }
  return roles;
}

type CanvasRuntimeConfig = {
  byokProviders: ByokProviderName[];
  providerMode: 'babysea' | 'byok';
};

function listCanvasModels(runtime: CanvasRuntimeConfig): CanvasModel[] {
  const models: CanvasModel[] = [];
  for (const entry of listModelCatalog()) {
    const roles = rolesForModel(entry.modelIdentifier, entry.kind);
    if (roles.length === 0) {
      continue;
    }
    const providerName = byokProviderName(entry.provider);
    const available =
      runtime.providerMode === 'babysea'
        ? entry.babyseaCompatible !== false
        : runtime.byokProviders.includes(providerName);

    models.push({
      available,
      id: entry.modelIdentifier,
      label: formatPublicModelName(entry.modelIdentifier),
      provider: entry.provider,
      providerLabel: PROVIDER_LABELS[entry.provider] ?? entry.provider,
      kind: entry.kind,
      roles,
      unavailableReason: available
        ? null
        : runtime.providerMode === 'babysea'
          ? 'This model requires BYOK mode.'
          : `${PROVIDER_LABELS[entry.provider] ?? entry.provider} API key is not configured.`,
    });
  }
  return models.sort((a, b) => a.label.localeCompare(b.label));
}

function byokProviderName(provider: ModelProvider): ByokProviderName {
  switch (provider) {
    case 'alibaba-cloud':
      return 'alibabacloud';
    case 'black-forest-labs':
      return 'bfl';
    case 'byteplus':
    case 'google':
    case 'openai':
    case 'runway':
      return provider;
  }
}

function configuredByokProvidersForCanvas(env: AppEnv) {
  const providers: ByokProviderName[] = [];

  if (env.DASHSCOPE_API_KEY) providers.push('alibabacloud');
  if (env.BFL_API_KEY) providers.push('bfl');
  if (env.ARK_API_KEY) providers.push('byteplus');
  if (env.GOOGLE_API_KEY || env.GEMINI_API_KEY) providers.push('google');
  if (env.OPENAI_API_KEY) providers.push('openai');
  if (env.RUNWAYML_API_SECRET) providers.push('runway');

  return providers;
}

// ----------------------------------------------------------------------------
// Field derivation
// ----------------------------------------------------------------------------
//
// Node cards are generated from the Semantic Lady schema of the selected
// model, so every field, enum option, numeric range, and default matches
// exactly what the run API validates. Both BYOK and BabySea modes speak the
// same normalized generation_* contract.

function semanticFieldSpec(field: {
  name: string;
  type: string;
  enum?: readonly (string | number)[];
  min?: number;
  max?: number;
  default?: unknown;
  required?: boolean;
}): FieldSpec | null {
  const required = field.required === true;
  const schema = semanticFieldJsonSchema(field);
  const enumOptions = selectOptions(field.enum ?? []);

  if (enumOptions.length > 0) {
    return {
      name: field.name,
      type: 'select',
      options: enumOptions,
      schema,
      valueKind: enumOptions.every((option) => typeof option.value === 'number')
        ? 'number'
        : 'string',
      ...defaultFieldValue(field.default),
      ...(required ? { required } : {}),
    };
  }

  const boundedIntegerOptions = integerRangeOptions(field);

  if (boundedIntegerOptions.length > 0) {
    return {
      name: field.name,
      type: 'select',
      options: boundedIntegerOptions,
      schema,
      valueKind: 'number',
      ...defaultFieldValue(field.default),
      ...(required ? { required } : {}),
    };
  }

  if (field.type === 'enum') {
    return null;
  }

  if (field.type === 'integer' || field.type === 'number') {
    return {
      name: field.name,
      type: 'number',
      schema,
      valueKind: 'number',
      ...(typeof field.min === 'number' ? { min: field.min } : {}),
      ...(typeof field.max === 'number' ? { max: field.max } : {}),
      ...defaultFieldValue(field.default),
      ...(required ? { required } : {}),
    };
  }

  if (field.type === 'boolean') {
    return {
      name: field.name,
      type: 'boolean',
      schema,
      valueKind: 'boolean',
      ...defaultFieldValue(field.default),
    };
  }

  if (field.type === 'url-array' || field.type === 'string-array') {
    return {
      name: field.name,
      type: 'textarea',
      rows: 2,
      schema,
      valueKind: 'string-array',
      ...defaultFieldValue(field.default),
      ...(required ? { required } : {}),
    };
  }

  if (field.type === 'object') {
    return {
      name: field.name,
      type: 'textarea',
      rows: 4,
      schema,
      valueKind: 'json',
      ...defaultFieldValue(field.default),
      ...(required ? { required } : {}),
    };
  }

  if (field.type === 'string' || field.type === 'url') {
    const isPrompt = field.name.endsWith('_prompt');
    return {
      name: field.name,
      type: isPrompt ? 'textarea' : 'text',
      schema,
      valueKind: 'string',
      ...(isPrompt ? { rows: 3 } : {}),
      ...defaultFieldValue(field.default),
      ...(required ? { required } : {}),
    };
  }

  return null;
}

function selectOptions(values: readonly (string | number)[]) {
  return values.map((value) => ({ label: String(value), value }));
}

function integerRangeOptions(field: {
  type: string;
  min?: number;
  max?: number;
}) {
  if (
    field.type !== 'integer' ||
    typeof field.min !== 'number' ||
    typeof field.max !== 'number' ||
    !Number.isInteger(field.min) ||
    !Number.isInteger(field.max) ||
    field.max < field.min ||
    field.max - field.min > 60
  ) {
    return [];
  }

  return Array.from({ length: field.max - field.min + 1 }, (_, index) => {
    const value = field.min! + index;
    return { label: String(value), value };
  });
}

function defaultFieldValue(value: unknown): Pick<FieldSpec, 'default'> {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return { default: value };
  }

  if (Array.isArray(value)) {
    return { default: value.join('\n') };
  }

  if (value && typeof value === 'object') {
    return { default: JSON.stringify(value, null, 2) };
  }

  return {};
}

function deriveSemanticFields(modelId: string, role: StepRole): FieldGroup {
  const schema = getSemanticModelSchemaFields(modelId, {
    ...getMediaDrivenSchemaOptionsForRole(modelId, role),
    chainFieldMode: chainFieldModeForRole(role),
  });

  if (!schema) {
    // Defensive fallback: every catalog model ships a Semantic Lady schema.
    return {
      core: [
        {
          name: 'generation_prompt',
          type: 'textarea',
          required: true,
          rows: 3,
        },
      ],
      advanced: [],
    };
  }

  const core: FieldSpec[] = [];
  const advanced: FieldSpec[] = [];

  for (const field of schema) {
    const spec = semanticFieldSpec(field);
    if (!spec) continue;
    (field.tier === 'advanced' ? advanced : core).push(spec);
  }

  core.sort((a, b) =>
    a.name === 'generation_prompt'
      ? -1
      : b.name === 'generation_prompt'
        ? 1
        : 0,
  );

  return { core, advanced };
}

// ----------------------------------------------------------------------------
// Server actions (thin owner-gated proxies onto the app's own API)
// ----------------------------------------------------------------------------

async function getModelFieldsAction(
  modelId: string,
  role: StepRole,
): Promise<FieldGroup> {
  'use server';
  await requireOwnerSession();
  return deriveSemanticFields(modelId, role);
}

function callerKey(): string {
  const key = getAppApiKeys()[0];
  if (!key) {
    throw new Error('APP_API_KEY is not configured.');
  }
  return key;
}

function internalRequest(path: string, init?: InternalRequestInit) {
  return new NextRequest(new URL(path, INTERNAL_ROUTE_ORIGIN), init);
}

function withDashboardOutputUrls(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.startsWith(PUBLIC_OUTPUT_ROUTE_PREFIX)
      ? `${DASHBOARD_OUTPUT_ROUTE_PREFIX}${value.slice(PUBLIC_OUTPUT_ROUTE_PREFIX.length)}`
      : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => withDashboardOutputUrls(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        withDashboardOutputUrls(entryValue),
      ]),
    );
  }

  return value;
}

async function runChainAction(
  input: Record<string, unknown>,
  options?: {
    execution?: Record<string, unknown>;
    flowId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<{ ok: true; run: unknown } | { ok: false; error: string }> {
  'use server';
  const session = await requireOwnerSession();
  try {
    const response = await createRunRoute(
      internalRequest('/api/v1/chains/runs', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${callerKey()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          input,
          execution: options?.execution,
          ...(options?.metadata ? { metadata: options.metadata } : {}),
        }),
        cache: 'no-store',
      }),
    );
    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      return { ok: false, error: extractError(json) };
    }
    if (options?.flowId && typeof json.id === 'string') {
      await recordWorkspaceFlowRun(
        session.email,
        options.flowId,
        json.id,
      ).catch(() => undefined);
    }
    return { ok: true, run: withDashboardOutputUrls(json) };
  } catch (error) {
    return {
      ok: false,
      error: formatCanvasActionError(error),
    };
  }
}

async function continueAgentAction(
  runId: string,
  input: {
    checkpointId: string;
    selectedParams: Record<string, unknown>;
    selectedPrompt: string;
  },
): Promise<{ ok: true; run: unknown } | { ok: false; error: string }> {
  'use server';
  await requireOwnerSession();
  try {
    const response = await continueRunRoute(
      internalRequest('/api/v1/chains/continue/internal', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${callerKey()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          checkpoint_id: input.checkpointId,
          selected_params: input.selectedParams,
          selected_prompt: input.selectedPrompt,
        }),
        cache: 'no-store',
      }),
      { params: { runId } },
    );
    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      return { ok: false, error: extractError(json) };
    }
    return { ok: true, run: withDashboardOutputUrls(json) };
  } catch (error) {
    return {
      ok: false,
      error: formatCanvasActionError(error),
    };
  }
}

async function getRunAction(runId: string): Promise<unknown | null> {
  'use server';
  await requireOwnerSession();
  try {
    const response = await getRunRoute(
      internalRequest('/api/v1/chains/get/internal', {
        headers: { authorization: `Bearer ${callerKey()}` },
        cache: 'no-store',
      }),
      { params: { runId } },
    );
    if (!response.ok) {
      return null;
    }
    return withDashboardOutputUrls(await response.json());
  } catch {
    return null;
  }
}

async function cancelRunAction(runId: string): Promise<unknown | null> {
  'use server';
  await requireOwnerSession();
  try {
    const response = await cancelRunRoute(
      internalRequest('/api/v1/chains/cancel/internal', {
        method: 'POST',
        headers: { authorization: `Bearer ${callerKey()}` },
        cache: 'no-store',
      }),
      { params: { runId } },
    );
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

async function saveCanvasAction(
  input: SaveCanvasInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  'use server';
  const session = await requireOwnerSession();
  try {
    const saved = await saveCanvas(session.email, input);
    return { ok: true, id: saved.id };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof AppError
          ? error.message
          : 'Saving the canvas failed. Try again.',
    };
  }
}

async function saveWorkspaceAction(
  nodes: StoredCanvasNode[],
  saveVersion: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  'use server';
  const session = await requireOwnerSession();
  try {
    await saveWorkspaceCanvas(session.email, nodes, saveVersion);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof AppError
          ? error.message
          : 'Saving the workspace failed. Try again.',
    };
  }
}

async function recordFlowRunAction(
  flowId: string,
  runId: string,
): Promise<boolean> {
  'use server';
  const session = await requireOwnerSession();
  return await recordWorkspaceFlowRun(session.email, flowId, runId).catch(
    () => false,
  );
}

async function renameCanvasAction(
  canvasId: string,
  title: string,
): Promise<void> {
  'use server';
  const session = await requireOwnerSession();
  // Best effort: no-op when the flow has not been saved to the Library yet.
  await renameCanvas(session.email, canvasId, title).catch(() => undefined);
}

function extractError(json: Record<string, unknown>): string {
  const error = json.error;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Run failed to start.';
}

function formatCanvasActionError(error: unknown): string {
  if (error instanceof TypeError && error.message === 'fetch failed') {
    return 'The app API is not reachable from the canvas. On Vercel, check NEXT_PUBLIC_SITE_URL; locally, run the app on port 3011 or set PORT.';
  }

  return error instanceof Error ? error.message : 'Run failed.';
}

export async function CanvasPageView({ canvasId }: { canvasId?: string } = {}) {
  const session = await requireOwnerSession();
  const env = getEnv();
  const runtime: CanvasRuntimeConfig = {
    byokProviders:
      env.APP_PROVIDER_MODE === 'byok'
        ? configuredByokProvidersForCanvas(env)
        : [],
    providerMode: env.APP_PROVIDER_MODE === 'byok' ? 'byok' : 'babysea',
  };
  const storedCanvas = canvasId
    ? await getCanvas(session.email, canvasId)
    : null;

  if (canvasId && !storedCanvas) {
    redirect('/dashboard/chain');
  }

  // The base canvas page is the permanent workspace: its nodes and per-flow
  // run pointers come from the owner's workspace row in Aurora.
  const workspace = canvasId
    ? null
    : await getWorkspaceCanvas(session.email).catch(() => null);

  return (
    <>
      <Canvas
        canvasId={storedCanvas?.id}
        initialTitle={storedCanvas?.title ?? null}
        initialNodes={storedCanvas?.nodes ?? workspace?.nodes ?? null}
        initialRunId={storedCanvas?.runId ?? null}
        initialFlowRuns={workspace?.flowRuns ?? null}
        models={listCanvasModels(runtime)}
        providerMode={runtime.providerMode}
        byokProviders={runtime.byokProviders}
        getModelFieldsAction={getModelFieldsAction}
        runChainAction={runChainAction}
        getRunAction={getRunAction}
        continueAgentAction={continueAgentAction}
        cancelRunAction={cancelRunAction}
        saveCanvasAction={saveCanvasAction}
        saveWorkspaceAction={saveWorkspaceAction}
        recordFlowRunAction={recordFlowRunAction}
        renameCanvasAction={renameCanvasAction}
      />
    </>
  );
}

export default async function CanvasPage() {
  return <CanvasPageView />;
}
