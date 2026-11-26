'use client';

import '@xyflow/react/dist/style.css';

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import type {
  ChangeEvent,
  ComponentType,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  SVGProps,
  WheelEvent as ReactWheelEvent,
} from 'react';

import { FontAwesomeIcon } from '@/components/icons/font-awesome-icon';
import { InlineStamp as InlineBabySea } from '@/components/icons/inline-babysea';
import {
  InlineAlibabaCloud as InlineInferenceAlibabaCloud,
  InlineBlackForestLabsLight as InlineInferenceBlackForestLabsLight,
  InlineBytePlus as InlineInferenceBytePlus,
  InlineGoogle as InlineInferenceGoogle,
  InlineOpenAILight as InlineInferenceOpenAILight,
  InlineRunwayLight as InlineInferenceRunwayLight,
} from '@/components/icons/inline-inference';
import { InlineAmazonNova } from '@/components/icons/inline-llm';
import {
  InlineBlackForestLabsLight as InlineModelBlackForestLabsLight,
  InlineByteDance as InlineModelByteDance,
  InlineGoogle as InlineModelGoogle,
  InlineHappyHorseLight as InlineModelHappyHorseLight,
  InlineOpenAILight as InlineModelOpenAILight,
  InlineQwen as InlineModelQwen,
  InlineRunwayLight as InlineModelRunwayLight,
  InlineWan as InlineModelWan,
  InlineZImage as InlineModelZImage,
} from '@/components/icons/inline-model';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  createCanvasId,
  type StoredCanvasNode,
} from '@/lib/canvas/canvas-library';
import {
  validateCanvasFlowRun,
  type CanvasFlowRunValidation,
} from '@/lib/canvas/run-validation';
import {
  createCancelRunCurl,
  createGetRunCurl,
  createChainRunCurl,
  type ChainRunRequestExtras,
  createExampleStepInputFromValues,
  createListChainsCurl,
  createModelSchemaJsonFromFields,
  createStepInputFromValues,
} from '@/lib/chains/ui-request-shape';
import {
  createDefaultCanvasName,
  MAX_CANVAS_TITLE_LENGTH,
  normalizeCanvasTitle,
} from '@/lib/canvas/names';
import {
  isChainWiredSemanticFieldName,
  modelSchemaCacheKey,
} from '@/lib/models/chain-schema';
import { cn } from '@/lib/utils';

type ModelIconKey =
  | 'black-forest-labs'
  | 'bytedance'
  | 'google'
  | 'happyhorse'
  | 'openai'
  | 'qwen'
  | 'runway'
  | 'wan'
  | 'z';

type InferenceIconKey =
  | 'alibaba-cloud'
  | 'black-forest-labs'
  | 'byteplus'
  | 'google'
  | 'openai'
  | 'runway';

type ByokProviderKey =
  'alibabacloud' | 'bfl' | 'byteplus' | 'google' | 'openai' | 'runway';

type ProviderMode = 'babysea' | 'byok';

const MODEL_ICONS: Record<
  ModelIconKey,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  'black-forest-labs': InlineModelBlackForestLabsLight,
  bytedance: InlineModelByteDance,
  google: InlineModelGoogle,
  happyhorse: InlineModelHappyHorseLight,
  openai: InlineModelOpenAILight,
  qwen: InlineModelQwen,
  runway: InlineModelRunwayLight,
  wan: InlineModelWan,
  z: InlineModelZImage,
};

const INFERENCE_ICONS: Record<
  InferenceIconKey,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  'alibaba-cloud': InlineInferenceAlibabaCloud,
  'black-forest-labs': InlineInferenceBlackForestLabsLight,
  byteplus: InlineInferenceBytePlus,
  google: InlineInferenceGoogle,
  openai: InlineInferenceOpenAILight,
  runway: InlineInferenceRunwayLight,
};

function modelIcon(modelId: string | undefined) {
  if (!modelId) return undefined;

  const iconKey = getModelIconKey(modelId);

  return iconKey ? MODEL_ICONS[iconKey] : undefined;
}

function getModelIconKey(modelId: string): ModelIconKey | null {
  const [namespace = ''] = modelId.split('/');

  if (namespace === 'bfl' || namespace === 'black-forest-labs') {
    return 'black-forest-labs';
  }

  if (namespace === 'bytedance' || namespace === 'byteplus') {
    return 'bytedance';
  }

  if (namespace === 'google') {
    return 'google';
  }

  if (namespace === 'happyhorse') {
    return 'happyhorse';
  }

  if (namespace === 'qwen') {
    return 'qwen';
  }

  if (namespace === 'gpt' || namespace === 'openai') {
    return 'openai';
  }

  if (namespace === 'runway') {
    return 'runway';
  }

  if (namespace === 'wan') {
    return 'wan';
  }

  if (namespace === 'z') {
    return 'z';
  }

  return null;
}

function inferenceIcon(provider: string | undefined) {
  if (!provider || !isInferenceIconKey(provider)) return undefined;

  return INFERENCE_ICONS[provider];
}

function inferenceIconForByokProvider(provider: ByokProviderKey) {
  return INFERENCE_ICONS[byokProviderInferenceKey(provider)];
}

function byokProviderInferenceKey(provider: ByokProviderKey): InferenceIconKey {
  switch (provider) {
    case 'alibabacloud':
      return 'alibaba-cloud';
    case 'bfl':
      return 'black-forest-labs';
    case 'byteplus':
    case 'google':
    case 'openai':
    case 'runway':
      return provider;
  }
}

function isInferenceIconKey(value: string): value is InferenceIconKey {
  return value in INFERENCE_ICONS;
}

function handleDropdownWheel(event: ReactWheelEvent<HTMLElement>) {
  event.preventDefault();
  event.stopPropagation();

  const delta =
    event.deltaMode === 1
      ? event.deltaY * 16
      : event.deltaMode === 2
        ? event.deltaY * event.currentTarget.clientHeight
        : event.deltaY;
  const deltaX =
    event.deltaMode === 1
      ? event.deltaX * 16
      : event.deltaMode === 2
        ? event.deltaX * event.currentTarget.clientWidth
        : event.deltaX;

  event.currentTarget.scrollTop += delta;
  event.currentTarget.scrollLeft += deltaX;
}

// Custom model dropdown. A native <select> cannot render an SVG inside its
// <option> list, so this renders a button + popup so each option shows its
// model brand icon.
function ModelDropdown({
  options,
  value,
  disabled,
  onChange,
}: {
  options: CanvasModel[];
  value: string;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.id === value);
  const SelectedIcon = modelIcon(selected?.id);

  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (event: PointerEvent) => {
      const target = event.target as globalThis.Node | null;
      if (ref.current && target && !ref.current.contains(target)) {
        setOpen(false);
      }
    };
    // Capture phase so an outside click still closes the dropdown even when
    // React Flow's pane/nodes stop pointer-event propagation on the canvas.
    document.addEventListener('pointerdown', onDocPointerDown, true);
    return () =>
      document.removeEventListener('pointerdown', onDocPointerDown, true);
  }, [open]);

  return (
    <div className="nodrag relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className="flex h-8 w-full items-center gap-2 border border-border bg-input px-2.5 text-left text-xs text-foreground outline-none transition focus-visible:border-ring disabled:opacity-50"
      >
        {SelectedIcon ? (
          <SelectedIcon className="size-4 shrink-0" aria-hidden="true" />
        ) : null}
        <span className="min-w-0 flex-1 truncate">
          {selected?.label ?? 'Select a model'}
        </span>
        <FontAwesomeIcon
          className="size-3.5 shrink-0 text-muted-foreground"
          icon="chevron-down"
        />
      </button>

      {open ? (
        <div
          className="nodrag nopan nowheel absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto overscroll-contain border border-border bg-card shadow-xl"
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={handleDropdownWheel}
        >
          {options.map((option) => {
            const OptionIcon = modelIcon(option.id);
            const active = option.id === value;
            const unavailable = !option.available;
            const optionDisabled = disabled || unavailable;
            return (
              <button
                type="button"
                key={option.id}
                aria-disabled={optionDisabled}
                disabled={disabled}
                title={option.unavailableReason ?? undefined}
                onClick={() => {
                  if (optionDisabled) return;
                  onChange(option.id);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition hover:bg-muted',
                  active ? 'bg-muted text-foreground' : 'text-muted-foreground',
                  optionDisabled &&
                    'cursor-not-allowed opacity-45 hover:bg-transparent',
                )}
              >
                {OptionIcon ? (
                  <OptionIcon className="size-4 shrink-0" aria-hidden="true" />
                ) : (
                  <span className="size-4 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                <span className="shrink-0 text-[0.6rem] uppercase tracking-wide text-muted-foreground/70">
                  {option.providerLabel}
                </span>
                {unavailable ? (
                  <span className="shrink-0 border border-border px-1 py-0.5 text-[0.55rem] uppercase tracking-wide text-muted-foreground">
                    {unavailableModelBadge(option)}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function unavailableModelBadge(model: CanvasModel) {
  const reason = model.unavailableReason ?? '';

  if (reason.includes('BYOK')) return 'BYOK only';
  if (reason.includes('API key')) return 'Key missing';

  return 'Unavailable';
}

function FieldSelectDropdown({
  options,
  value,
  disabled,
  onChange,
}: {
  options: SelectOption[];
  value: FieldValue | undefined;
  disabled: boolean;
  onChange: (value: FieldValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find(
    (option) => String(option.value) === String(value ?? ''),
  );

  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (event: PointerEvent) => {
      const target = event.target as globalThis.Node | null;
      if (ref.current && target && !ref.current.contains(target)) {
        setOpen(false);
      }
    };
    // Capture phase so an outside click still closes the dropdown even when
    // React Flow's pane/nodes stop pointer-event propagation on the canvas.
    document.addEventListener('pointerdown', onDocPointerDown, true);
    return () =>
      document.removeEventListener('pointerdown', onDocPointerDown, true);
  }, [open]);

  return (
    <div className="nodrag relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((state) => !state)}
        className="flex h-8 w-full items-center gap-2 border border-border bg-input px-2.5 text-left text-xs text-foreground outline-none transition focus-visible:border-ring disabled:opacity-50"
      >
        <span className="min-w-0 flex-1 truncate">
          {selected?.label ?? 'Select'}
        </span>
        <FontAwesomeIcon
          className="size-3.5 shrink-0 text-muted-foreground"
          icon="chevron-down"
        />
      </button>

      {open ? (
        <div
          className="nodrag nopan nowheel absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto overscroll-contain border border-border bg-card shadow-xl"
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={handleDropdownWheel}
        >
          {options.map((option) => {
            const active = String(option.value) === String(value ?? '');

            return (
              <button
                type="button"
                key={`${option.label}:${String(option.value)}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center px-2.5 py-1.5 text-left text-xs transition hover:bg-muted',
                  active ? 'bg-muted text-foreground' : 'text-muted-foreground',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function RunModeDropdown({
  value,
  disabled,
  onChange,
}: {
  value: RunMode;
  disabled: boolean;
  onChange: (value: RunMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = RUN_MODE_OPTIONS.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (event: PointerEvent) => {
      const target = event.target as globalThis.Node | null;
      if (ref.current && target && !ref.current.contains(target)) {
        setOpen(false);
      }
    };
    // Capture phase so an outside click still closes the dropdown even when
    // React Flow's pane/nodes stop pointer-event propagation on the canvas.
    document.addEventListener('pointerdown', onDocPointerDown, true);
    return () =>
      document.removeEventListener('pointerdown', onDocPointerDown, true);
  }, [open]);

  return (
    <div className="nodrag relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((state) => !state)}
        className="flex h-8 w-full items-center gap-2 border border-border bg-input px-2.5 text-left text-xs text-foreground outline-none transition focus-visible:border-ring disabled:opacity-50"
      >
        <span className="min-w-0 flex-1 truncate">
          {selected?.label ?? 'Self Control'}
        </span>
        <FontAwesomeIcon
          className="size-3.5 shrink-0 text-muted-foreground"
          icon="chevron-down"
        />
      </button>

      {open ? (
        <div
          className="nodrag nopan nowheel absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto overscroll-contain border border-border bg-card shadow-xl"
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={handleDropdownWheel}
        >
          {RUN_MODE_OPTIONS.map((option) => {
            const active = option.value === value;

            return (
              <button
                type="button"
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  'nodrag flex w-full flex-col gap-0.5 px-2.5 py-1.5 text-left transition hover:bg-muted',
                  active ? 'bg-muted' : '',
                )}
              >
                <span className="truncate text-xs font-medium text-foreground">
                  {option.label}
                </span>
                <span className="text-[0.62rem] leading-snug text-muted-foreground">
                  {option.description}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Shared types (also imported by the app server page)
// ----------------------------------------------------------------------------

export type StepRole = 'image' | 'refine' | 'video' | 'modify';

export type FieldSpec = {
  name: string;
  type: 'text' | 'textarea' | 'number' | 'select' | 'boolean';
  required?: boolean;
  default?: string | number | boolean;
  options?: SelectOption[];
  schema?: Record<string, unknown>;
  valueKind?: 'string' | 'number' | 'boolean' | 'string-array' | 'json';
  min?: number;
  max?: number;
  rows?: number;
};

export type FieldGroup = { core: FieldSpec[]; advanced: FieldSpec[] };

export type CanvasModel = {
  available: boolean;
  id: string;
  label: string;
  provider: string;
  providerLabel: string;
  kind: 'image' | 'video';
  roles: StepRole[];
  unavailableReason: string | null;
};

type FieldValue = string | number | boolean;

type SelectOption = {
  label: string;
  value: FieldValue;
};

type RunStep = {
  step_key: string;
  status: string;
  generation_output_file?: string[];
  started_at?: string | null;
};

type RunMode = 'self_control' | 'agent_copilot' | 'agent_autopilot';

type AgentCheckpointSuggestion = {
  title?: string;
  prompt?: string;
  rationale?: string;
  params?: Record<string, unknown>;
};

type AgentCheckpoint = {
  id: string;
  step_key: string;
  status: string;
  suggestions?: AgentCheckpointSuggestion[];
  selected_prompt?: string | null;
  selected_params?: Record<string, unknown> | null;
};

function stringFieldValue(value: unknown): FieldValue | null {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.every((entry) => typeof entry === 'string')
      ? value.join('\n')
      : JSON.stringify(value, null, 2);
  }

  if (value && typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }

  return null;
}

type RunJson = {
  agent_checkpoints?: AgentCheckpoint[];
  error?: { message?: string | null } | null;
  execution?:
    | { type: 'self_control' }
    | { mode?: 'autopilot' | 'copilot'; type: 'chain_agent' }
    | null;
  id: string;
  status: string;
  steps?: RunStep[];
};

function runErrorMessage(run: RunJson) {
  return run.error?.message?.trim() || 'The run failed.';
}

// Last-known run snapshot per run id, held at module scope so it survives the
// canvas unmounting on client-side navigation (e.g. opening the Library and
// returning). On remount the resume effect seeds the run mode, step statuses,
// and agent checkpoints from this cache synchronously, so the agent runner
// mode and checkpoint cards repaint immediately instead of flashing
// self_control and popping in only after the first poll round-trip resolves.
const runSnapshotCache = new Map<string, RunJson>();

type CanvasProps = {
  byokProviders: ByokProviderKey[];
  canvasId?: string;
  initialTitle?: string | null;
  initialNodes?: StoredCanvasNode[] | null;
  initialRunId?: string | null;
  initialFlowRuns?: Record<string, string> | null;
  models: CanvasModel[];
  providerMode: ProviderMode;
  getModelFieldsAction: (
    modelId: string,
    role: StepRole,
  ) => Promise<FieldGroup>;
  runChainAction: (
    input: Record<string, unknown>,
    options?: {
      execution?: Record<string, unknown>;
      flowId?: string;
    },
  ) => Promise<{ ok: true; run: unknown } | { ok: false; error: string }>;
  getRunAction: (runId: string) => Promise<unknown | null>;
  continueAgentAction: (
    runId: string,
    input: {
      checkpointId: string;
      selectedParams: Record<string, unknown>;
      selectedPrompt: string;
    },
  ) => Promise<{ ok: true; run: unknown } | { ok: false; error: string }>;
  cancelRunAction: (runId: string) => Promise<unknown | null>;
  saveCanvasAction: (input: {
    id: string;
    runId?: string | null;
    title: string;
    nodes: StoredCanvasNode[];
    saveVersion: number;
  }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  saveWorkspaceAction: (
    nodes: StoredCanvasNode[],
    saveVersion: number,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  recordFlowRunAction: (flowId: string, runId: string) => Promise<boolean>;
  renameCanvasAction: (canvasId: string, title: string) => Promise<void>;
};

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const ROLE_RANK: Record<StepRole, number> = {
  image: 0,
  refine: 1,
  video: 2,
  modify: 3,
};
const ROLE_COLOR: Record<StepRole, string> = {
  image: '#f9a8d4',
  refine: '#67e8f9',
  video: '#c4b5fd',
  modify: '#fdba74',
};
const TERMINAL = new Set(['succeeded', 'failed', 'canceled']);
const LIBRARY_CANVAS_ID_VALUE = 'library_canvas_id';

function kindForRole(role: StepRole): 'image' | 'video' {
  return role === 'image' || role === 'refine' ? 'image' : 'video';
}

function defaultValue(field: FieldSpec): FieldValue {
  if (field.default !== undefined) return field.default;
  // Optional fields without documented defaults stay empty so compact() drops
  // them and the provider applies its own default.
  return '';
}

function nodeNeedsSchemaNormalization(
  node: FlowNode,
  group: FieldGroup | undefined,
) {
  if (!group) return false;

  const fields = [...group.core, ...group.advanced];
  const known = new Set(fields.map((field) => field.name));

  for (const key of Object.keys(node.data.values)) {
    if (!known.has(key)) return true;
  }

  return fields.some((field) => node.data.values[field.name] === undefined);
}

function normalizeNodeValues(node: FlowNode, group: FieldGroup) {
  const fields = [...group.core, ...group.advanced];
  const known = new Set(fields.map((field) => field.name));
  const values: Record<string, FieldValue> = {};

  for (const [key, value] of Object.entries(node.data.values)) {
    if (known.has(key)) {
      values[key] = value;
    }
  }

  for (const field of fields) {
    if (values[field.name] === undefined) {
      values[field.name] = defaultValue(field);
    }
  }

  return { ...node, data: { ...node.data, values } };
}

function genId(role: string): string {
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(16).slice(2, 10);
  return `${role}_${rand}`;
}

function genFlowId(): string {
  return genId('flow');
}

const FLOW_X = 40;
const FLOW_COL_W = 520;
const FLOW_CHECKPOINT_COL_W = 520;
const FLOW_ROW_H = 980;
const FLOW_UTILITY_STACK_Y = 420;

type AuxNodeType = 'checkpoint' | 'curl' | 'info' | 'runner';

function checkpointNodeId(flowId: string, role: StepRole) {
  return `checkpoint_${flowId}_${role}`;
}

function isPersistedCanvasNode(node: FlowNode) {
  return (
    node.type !== 'checkpoint' && node.type !== 'curl' && node.type !== 'runner'
  );
}

function snapshotNodes(nodes: FlowNode[]): StoredCanvasNode[] {
  // Utility cards are derived UI; info cards persist the flow name. Run ids
  // are transient UI state and never stored in canvas nodes.
  return nodes.filter(isPersistedCanvasNode).map((node) => ({
    id: node.id,
    role: node.data.role,
    modelId: node.data.modelId,
    flowId: node.data.flowId,
    values:
      node.type === 'info'
        ? stripFlowLibraryCanvasId(node.data.values)
        : node.data.values,
    position: node.position,
  }));
}

function stripFlowLibraryCanvasId(values: Record<string, FieldValue>) {
  const next = { ...values };
  delete next[LIBRARY_CANVAS_ID_VALUE];
  return next;
}

function restoreNodes(
  entries: StoredCanvasNode[],
  initialTitle?: string | null,
): FlowNode[] {
  return entries
    .filter(
      (entry) =>
        entry &&
        entry.id &&
        entry.role &&
        entry.flowId &&
        !entry.id.startsWith('checkpoint_'),
    )
    .map((entry) => {
      const type = entry.id.startsWith('info_') ? 'info' : 'model';
      const values = entry.values ?? {};

      return {
        id: entry.id,
        type,
        position: entry.position ?? { x: FLOW_X, y: 120 },
        data: {
          role: entry.role as StepRole,
          modelId: entry.modelId ?? '',
          flowId: entry.flowId,
          values:
            type === 'info' ? ensureInfoName(values, initialTitle) : values,
        },
      };
    });
}

function ensureInfoName(
  values: Record<string, FieldValue>,
  initialTitle?: string | null,
): Record<string, FieldValue> {
  const name = typeof values.name === 'string' ? values.name.trim() : '';
  if (name) return { ...values, name: normalizeCanvasTitle(name) };

  const savedTitle =
    typeof initialTitle === 'string' ? normalizeCanvasTitle(initialTitle) : '';

  return {
    ...values,
    name: savedTitle || createDefaultCanvasName(),
  };
}

/** Group model nodes by flow, each flow's nodes sorted by step rank. */
function flowsFrom(nodes: FlowNode[]): Map<string, FlowNode[]> {
  const flows = new Map<string, FlowNode[]>();
  for (const node of nodes) {
    if (node.type !== 'model') continue;
    const list = flows.get(node.data.flowId);
    if (list) {
      list.push(node);
    } else {
      flows.set(node.data.flowId, [node]);
    }
  }
  for (const list of flows.values()) {
    list.sort((a, b) => ROLE_RANK[a.data.role] - ROLE_RANK[b.data.role]);
  }
  return flows;
}

function needsFlowAuxReconcile(
  nodes: FlowNode[],
  runModeByFlow: ReadonlyMap<string, RunMode>,
) {
  const modelNodes = nodes.filter((node) => node.type === 'model');
  const auxById = new Map(
    nodes
      .filter((node) => node.type !== 'model')
      .map((node) => [node.id, node]),
  );
  const expectedAux = new Map<string, AuxNodeType>();

  for (const [flowId, flowNodes] of flowsFrom(modelNodes)) {
    const first = flowNodes[0];
    const last = flowNodes[flowNodes.length - 1];
    if (!first || !last) continue;

    expectedAux.set(`info_${flowId}`, 'info');
    if ((runModeByFlow.get(flowId) ?? 'self_control') !== 'self_control') {
      for (let index = 1; index < flowNodes.length; index += 1) {
        const target = flowNodes[index];
        if (target) {
          const checkpointId = checkpointNodeId(flowId, target.data.role);
          const existingCheckpoint = auxById.get(checkpointId);
          expectedAux.set(checkpointId, 'checkpoint');

          if (
            existingCheckpoint &&
            (existingCheckpoint.data.role !== target.data.role ||
              existingCheckpoint.data.modelId !== target.data.modelId ||
              existingCheckpoint.data.flowId !== flowId)
          ) {
            return true;
          }
        }
      }
    }
    expectedAux.set(`curl_${flowId}`, 'curl');
    expectedAux.set(`runner_${flowId}`, 'runner');
  }

  if (auxById.size !== expectedAux.size) return true;

  for (const [id, type] of expectedAux) {
    if (auxById.get(id)?.type !== type) return true;
  }

  return false;
}

function utilityCardPosition(last: FlowNode, kind: 'api' | 'runner') {
  return {
    x: last.position.x + FLOW_COL_W,
    y:
      kind === 'api' ? last.position.y + FLOW_UTILITY_STACK_Y : last.position.y,
  };
}

/** Re-place one flow's cards in rank order along its own row. */
function relayoutFlow(nodes: FlowNode[], flowId: string): FlowNode[] {
  const flowNodes = nodes
    .filter((node) => node.type === 'model' && node.data.flowId === flowId)
    .sort((a, b) => ROLE_RANK[a.data.role] - ROLE_RANK[b.data.role]);
  const rowY = Math.min(...flowNodes.map((node) => node.position.y));
  const positions = new Map<string, { x: number; y: number }>();
  const hasCheckpointCards = nodes.some(
    (node) => node.type === 'checkpoint' && node.data.flowId === flowId,
  );
  let x = FLOW_X + INFO_COL_W;

  flowNodes.forEach((node, index) => {
    if (hasCheckpointCards && index > 0) {
      positions.set(checkpointNodeId(flowId, node.data.role), {
        x,
        y: rowY,
      });
      x += FLOW_CHECKPOINT_COL_W;
    }

    positions.set(node.id, { x, y: rowY });
    x += FLOW_COL_W;
  });
  // Info card leads the flow; runner and API sit separately in the final
  // utility column. Checkpoints sit above their downstream model cards.
  positions.set(`info_${flowId}`, { x: FLOW_X, y: rowY });
  positions.set(`runner_${flowId}`, {
    x,
    y: rowY,
  });
  positions.set(`curl_${flowId}`, {
    x,
    y: rowY + FLOW_UTILITY_STACK_Y,
  });

  return nodes.map((node) =>
    positions.has(node.id)
      ? { ...node, position: positions.get(node.id)! }
      : node,
  );
}

function relayoutFlows(nodes: FlowNode[], flowIds: Iterable<string>) {
  let next = nodes;
  for (const flowId of flowIds) {
    next = relayoutFlow(next, flowId);
  }
  return next;
}

function nextFlowY(nodes: FlowNode[]): number {
  if (nodes.length === 0) return 120;
  return Math.max(...nodes.map((node) => node.position.y)) + FLOW_ROW_H;
}

function flowName(nodes: FlowNode[], flowId?: string): string {
  const infoNode = nodes.find(
    (node) => node.type === 'info' && (!flowId || node.data.flowId === flowId),
  );
  const name = infoNode?.data.values.name;
  return typeof name === 'string' && name.trim()
    ? normalizeCanvasTitle(name)
    : createDefaultCanvasName();
}

function duplicateFlowName(name: string) {
  const base = normalizeCanvasTitle(name) || createDefaultCanvasName();
  const suffix = ' copy';

  if (base.length + suffix.length <= MAX_CANVAS_TITLE_LENGTH) {
    return `${base}${suffix}`;
  }

  return `${base.slice(0, MAX_CANVAS_TITLE_LENGTH - suffix.length)}${suffix}`;
}

// ----------------------------------------------------------------------------
// Node data + context
// ----------------------------------------------------------------------------

type NodeData = {
  role: StepRole;
  modelId: string;
  flowId: string;
  values: Record<string, FieldValue>;
  [key: string]: unknown;
};

const RUNNER_COLOR = '#8b95a8';
const INFO_COLOR = RUNNER_COLOR;
// Width reserved for the flow info card column: 280px card + the same 120px
// gap that separates model cards (FLOW_COL_W 520 − card 400) and the runner.
const INFO_COL_W = 400;

type FlowNode = Node<NodeData>;

type NodeStatus = { status: string; outputs?: string[]; startedAt?: number };

type AgentCheckpointState = {
  checkpoint: AgentCheckpoint;
  runId: string;
};

type FlowMeta = {
  roles: Set<StepRole>;
  autoName: string;
};

type CanvasContextValue = {
  byokProviders: ByokProviderKey[];
  models: CanvasModel[];
  fieldsByModel: Record<string, FieldGroup | undefined>;
  runValidationByFlow: Record<string, CanvasFlowRunValidation | undefined>;
  statusByNode: Record<string, NodeStatus | undefined>;
  runningFlowIds: ReadonlySet<string>;
  runModeByFlow: ReadonlyMap<string, RunMode>;
  runIdsByFlow: ReadonlyMap<string, string>;
  agentCheckpointByNode: Record<string, AgentCheckpointState | undefined>;
  flowMeta: Record<string, FlowMeta | undefined>;
  flowCount: number;
  isSavedCanvas: boolean;
  providerMode: ProviderMode;
  updateModel: (id: string, modelId: string) => void;
  updateValue: (id: string, name: string, value: FieldValue) => void;
  moveFlowBy: (flowId: string, delta: { x: number; y: number }) => void;
  removeNode: (id: string) => void;
  removeFlow: (flowId: string) => void;
  duplicateFlow: (flowId: string) => void;
  createFlowCurl: (flowId: string) => string | null;
  renameCanvas: (flowId: string, title: string) => void;
  addNodeToFlow: (flowId: string, role: StepRole) => void;
  continueAgentCheckpoint: (
    flowId: string,
    role: StepRole,
    checkpointId: string,
    selectedPrompt: string,
    selectedParams: Record<string, unknown>,
    modelValues: Record<string, FieldValue>,
  ) => Promise<void>;
  runFlow: (flowId: string, save: boolean) => void;
  setRunMode: (flowId: string, mode: RunMode) => void;
  cancelFlow: (flowId: string) => void;
};

const CanvasContext = createContext<CanvasContextValue | null>(null);

function useCanvas(): CanvasContextValue {
  const value = useContext(CanvasContext);
  if (!value) {
    throw new Error('useCanvas outside provider');
  }
  return value;
}

// ----------------------------------------------------------------------------
// Field control
// ----------------------------------------------------------------------------

function FieldControl({
  field,
  value,
  disabled,
  settled,
  onChange,
}: {
  field: FieldSpec;
  value: FieldValue | undefined;
  disabled: boolean;
  settled?: boolean;
  onChange: (value: FieldValue) => void;
}) {
  const base =
    'nodrag w-full border border-border bg-input px-2.5 text-xs text-foreground outline-none focus-visible:border-ring disabled:opacity-50';

  if (field.type === 'textarea') {
    // generation_prompt is the primary field on every card, so it gets a taller
    // default box than secondary textareas (e.g. the negative prompt).
    const textareaMinHeight =
      field.name === 'generation_prompt' ? 'min-h-32' : 'min-h-20';
    // When the field is locked (during a run or under autopilot) or the step has
    // already succeeded, show the full prompt as an auto-height read-only block
    // so long prompts are not cropped inside a fixed-height textarea. This also
    // means the operator never has to drag the box open again after a run.
    if (disabled || settled) {
      const text = String(value ?? '').trim();
      // Prompts expand to show their full text when locked. File/URL and JSON
      // fields can hold very long values (a data URL, a list of links), so they
      // stay height-capped and scroll instead of stretching the card off-screen.
      const isPrompt = field.name.endsWith('_prompt');
      return (
        <div
          className={cn(
            base,
            textareaMinHeight,
            'whitespace-pre-wrap break-words py-2 leading-5',
            !isPrompt && 'nowheel max-h-24 overflow-y-auto overscroll-contain',
          )}
        >
          {text}
        </div>
      );
    }
    return (
      <TextInputControl
        as="textarea"
        className={cn(base, textareaMinHeight, 'resize-y py-1.5')}
        disabled={disabled}
        rows={field.rows ?? (field.name === 'generation_prompt' ? 5 : 3)}
        value={value}
        onChange={onChange}
      />
    );
  }
  if (field.type === 'select') {
    return (
      <FieldSelectDropdown
        options={field.options ?? []}
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }
  if (field.type === 'number') {
    return (
      <input
        type="number"
        className={cn(base, 'h-8')}
        min={field.min}
        max={field.max}
        value={value === undefined || value === '' ? '' : Number(value)}
        disabled={disabled}
        onChange={(event) =>
          onChange(event.target.value === '' ? '' : Number(event.target.value))
        }
      />
    );
  }
  if (field.type === 'boolean') {
    const checked = Boolean(value);
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'nodrag relative inline-flex h-6 w-11 items-center border transition',
          checked ? 'border-primary bg-primary/30' : 'border-border bg-input',
          disabled && 'opacity-50',
        )}
      >
        <span
          className={cn(
            'absolute size-4 transition',
            checked ? 'left-6 bg-primary' : 'left-1 bg-muted-foreground',
          )}
        />
      </button>
    );
  }
  return (
    <TextInputControl
      as="input"
      className={cn(base, 'h-8')}
      disabled={disabled}
      value={value}
      onChange={onChange}
    />
  );
}

function TextInputControl({
  as,
  className,
  disabled,
  rows,
  value,
  onChange,
}: {
  as: 'input' | 'textarea';
  className: string;
  disabled: boolean;
  rows?: number;
  value: FieldValue | undefined;
  onChange: (value: FieldValue) => void;
}) {
  const externalValue = String(value ?? '');
  const [draft, setDraft] = useState(externalValue);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(externalValue);
    }
  }, [externalValue]);

  const handleFocus = () => {
    focusedRef.current = true;
  };
  const handleBlur = () => {
    focusedRef.current = false;
    setDraft(externalValue);
  };
  const handleChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const next = event.target.value;
    setDraft(next);
    onChange(next);
  };

  const sharedProps = {
    className,
    disabled,
    onBlur: handleBlur,
    onChange: handleChange,
    onFocus: handleFocus,
    value: draft,
  };

  return as === 'textarea' ? (
    <textarea {...sharedProps} rows={rows ?? 3} />
  ) : (
    <input {...sharedProps} />
  );
}

function FieldRow({
  field,
  value,
  disabled,
  settled,
  onChange,
}: {
  field: FieldSpec;
  value: FieldValue | undefined;
  disabled: boolean;
  settled?: boolean;
  onChange: (value: FieldValue) => void;
}) {
  return (
    <div className="grid gap-1">
      <span className="font-mono text-[0.7rem] text-muted-foreground">
        {field.name}
        {field.required ? <span className="text-destructive"> *</span> : null}
      </span>
      <FieldControl
        field={field}
        value={value}
        disabled={disabled}
        settled={settled}
        onChange={onChange}
      />
    </div>
  );
}

function NodeSchemaJsonBlock({ value }: { value: Record<string, unknown> }) {
  const json = JSON.stringify(value, null, 2);

  return (
    <pre
      className="nodrag nopan nowheel max-h-80 cursor-auto overflow-auto overscroll-contain border border-border bg-[#050505] p-3 font-mono text-[0.65rem] leading-5 text-[#f8fafc]"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={handleDropdownWheel}
    >
      <code>{highlightJsonCode(json, 'node-schema-json')}</code>
    </pre>
  );
}

type CodeTokenTone =
  | 'command'
  | 'jsonKey'
  | 'literal'
  | 'number'
  | 'option'
  | 'punctuation'
  | 'string'
  | 'text';

const CODE_TOKEN_CLASSES: Record<CodeTokenTone, string> = {
  command: 'text-[#38bdf8]',
  jsonKey: 'text-[#60a5fa]',
  literal: 'text-[#f472b6]',
  number: 'text-[#fbbf24]',
  option: 'text-[#a78bfa]',
  punctuation: 'text-[#94a3b8]',
  string: 'text-[#34d399]',
  text: 'text-[#f8fafc]',
};

const JSON_LITERAL_TOKENS = new Set(['true', 'false', 'null']);

const SHELL_EXACT_TOKEN_TONES = new Map<string, CodeTokenTone>([
  ['curl', 'command'],
  ['\\', 'punctuation'],
]);

function NodeCurlBlock({ value }: { value: string }) {
  return (
    <pre
      className="nodrag nopan nowheel max-h-80 cursor-auto overflow-auto overscroll-contain border border-border bg-[#050505] p-3 font-mono text-[0.65rem] leading-5 text-[#f8fafc]"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={handleDropdownWheel}
    >
      <code>{highlightCurlCode(value)}</code>
    </pre>
  );
}

function highlightCurlCode(code: string) {
  const heredocMarker = "--data @- <<'JSON'\n";
  const heredocStart = code.indexOf(heredocMarker);

  if (heredocStart !== -1) {
    const jsonStart = heredocStart + heredocMarker.length;
    const jsonEnd = code.lastIndexOf('\nJSON');

    if (jsonEnd > jsonStart) {
      return [
        ...highlightShellCode(code.slice(0, jsonStart), 'node-curl-shell'),
        ...highlightJsonCode(code.slice(jsonStart, jsonEnd), 'node-curl-json'),
        ...highlightShellCode(code.slice(jsonEnd), 'node-curl-tail'),
      ];
    }
  }

  const dataMarker = "--data '";
  const dataStart = code.indexOf(dataMarker);

  if (dataStart === -1) {
    return highlightShellCode(code, 'node-curl');
  }

  const jsonStart = dataStart + dataMarker.length;
  const jsonEnd = code.lastIndexOf("'");

  if (jsonEnd <= jsonStart) {
    return highlightShellCode(code, 'node-curl');
  }

  return [
    ...highlightShellCode(code.slice(0, jsonStart), 'node-curl-shell'),
    ...highlightJsonCode(code.slice(jsonStart, jsonEnd), 'node-curl-json'),
    ...highlightShellCode(code.slice(jsonEnd), 'node-curl-tail'),
  ];
}

function highlightShellCode(source: string, keyPrefix: string) {
  return tokenizeCode(
    source,
    /(curl|--[a-z-]+|\\|'[^']*'|https?:\/\/[^\s']+|\$[A-Z_]+)/gi,
    (token) => {
      const exactTone = SHELL_EXACT_TOKEN_TONES.get(token);

      if (exactTone) return exactTone;
      if (token.startsWith('--')) return 'option';
      if (token.startsWith('http') || token.startsWith("'")) return 'string';
      if (token.startsWith('$')) return 'literal';
      return 'text';
    },
    keyPrefix,
  );
}

function highlightJsonCode(source: string, keyPrefix: string) {
  return tokenizeCode(
    source,
    /("(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}[\]:,])/g,
    (token, index) => {
      if (token.startsWith('"') && token.endsWith('"')) {
        return source.slice(index + token.length).match(/^\s*:/)
          ? 'jsonKey'
          : 'string';
      }
      if (/^-?\d/.test(token)) return 'number';
      if (JSON_LITERAL_TOKENS.has(token)) return 'literal';
      if ('{}[]:,'.includes(token)) return 'punctuation';
      return 'text';
    },
    keyPrefix,
  );
}

function tokenizeCode(
  source: string,
  pattern: RegExp,
  toneForToken: (token: string, index: number) => CodeTokenTone,
  keyPrefix: string,
) {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let tokenIndex = 0;

  for (const match of source.matchAll(pattern)) {
    const token = match[0];
    const index = match.index ?? 0;

    if (index > lastIndex) {
      nodes.push(source.slice(lastIndex, index));
    }

    const tone = toneForToken(token, index);
    nodes.push(
      <span
        className={CODE_TOKEN_CLASSES[tone]}
        key={`${keyPrefix}-${tokenIndex}`}
      >
        {token}
      </span>,
    );

    lastIndex = index + token.length;
    tokenIndex += 1;
  }

  if (lastIndex < source.length) {
    nodes.push(source.slice(lastIndex));
  }

  return nodes;
}

function createNodeSchemaJson({
  fields,
  modelId,
  modelLabel,
}: {
  fields: FieldSpec[];
  modelId: string;
  modelLabel: string;
}) {
  return createModelSchemaJsonFromFields({
    fields,
    modelId,
    modelLabel,
  });
}

// ----------------------------------------------------------------------------
// Media preview
// ----------------------------------------------------------------------------

function MediaPreview({ url, kind }: { url: string; kind: 'image' | 'video' }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (failed) {
    return <MediaUnavailable kind={kind} />;
  }
  return (
    <div className="relative">
      {kind === 'video' ? (
        <video
          src={url}
          controls
          preload="metadata"
          onError={() => setFailed(true)}
          onLoadedMetadata={() => setLoaded(true)}
          // nodrag: without it ReactFlow treats the player as a drag handle:
          // grab cursor over the whole video and clicks on the controls drag
          // the card instead of playing/scrubbing.
          className="nodrag aspect-video w-full cursor-auto bg-black object-contain"
        />
      ) : (
        <img
          src={url}
          alt="output"
          onError={() => setFailed(true)}
          onLoad={() => setLoaded(true)}
          className="aspect-video w-full bg-black object-contain"
        />
      )}
      {/* Until the media loads, cover the slot (and the browser's alt text /
          blank frame) with an explicit loading state. */}
      {!loaded ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black text-muted-foreground">
          <FontAwesomeIcon className="size-4 animate-spin" icon="spinner" />
          <span className="text-[0.65rem] leading-4">Loading…</span>
        </div>
      ) : null}
    </div>
  );
}

// Provider delivery URLs expire (inference providers remove outputs after a
// retention window). Show a media-kind icon instead of a broken element.
function MediaUnavailable({
  kind,
  className,
}: {
  kind: 'image' | 'video';
  className?: string;
}) {
  const icon = kind === 'video' ? 'video' : 'image';

  return (
    <div
      className={cn(
        'flex aspect-video w-full flex-col items-center justify-center gap-1.5 bg-black text-muted-foreground',
        className,
      )}
    >
      <FontAwesomeIcon className="size-5" icon={icon} />
      <span className="px-2 text-center text-[0.65rem] leading-4">
        Removed by your inference. Set up storage to keep outputs longer.
      </span>
    </div>
  );
}

// Realtime elapsed timer shown while a step processes. Providers report
// discrete run statuses (queued/running/succeeded), not a fractional percent,
// so we derive the elapsed time from the server step start time (started_at).
// Anchoring to the server timestamp (not mount time) keeps the counter precise
// and resumes correctly after a remount or page switch instead of restarting
// from zero.
function NodeProcessingIndicator({ startedAt }: { startedAt?: number }) {
  // Tick once a second purely to re-render; the displayed value is always
  // recomputed from `now - startedAt`.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const base = startedAt ?? now;
  const seconds = Math.max(0, Math.floor((now - base) / 1000));
  const label = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <>
      <FontAwesomeIcon className="size-5 animate-spin" icon="spinner" />
      <span className="text-[0.65rem] leading-4">Processing… {label}</span>
    </>
  );
}

// Always-visible results slot: shows outputs once ready, otherwise the live
// queued/processing/failed state so a running model card is observable.
function NodeResults({
  kind,
  outputs,
  running,
  status,
  startedAt,
  thinking,
}: {
  kind: 'image' | 'video';
  outputs?: string[];
  running: boolean;
  status?: string;
  startedAt?: number;
  thinking?: boolean;
}) {
  if (outputs?.length) {
    return (
      <div className="grid gap-2 border border-border p-2">
        {outputs.map((outputUrl) => (
          <MediaPreview key={outputUrl} url={outputUrl} kind={kind} />
        ))}
      </div>
    );
  }

  // While Amazon Nova is still reasoning about this step it has not started
  // processing yet, so show the same "thinking" state as the checkpoint badge
  // instead of a misleading "Queued".
  const effective = thinking
    ? 'thinking'
    : (status ?? (running ? 'queued' : 'idle'));

  return (
    <div className="border border-border p-2">
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-1.5 bg-black text-muted-foreground">
        {effective === 'thinking' ? (
          <>
            <InlineAmazonNova
              className="size-5 animate-pulse"
              aria-hidden="true"
            />
            <span className="text-[0.65rem] leading-4">Thinking…</span>
          </>
        ) : effective === 'running' ? (
          <NodeProcessingIndicator startedAt={startedAt} />
        ) : effective === 'queued' ? (
          <>
            <FontAwesomeIcon className="size-4 animate-pulse" icon="clock" />
            <span className="text-[0.65rem] leading-4">Queued</span>
          </>
        ) : effective === 'failed' ? (
          <>
            <FontAwesomeIcon
              className="size-5 text-rose-300"
              icon="triangle-exclamation"
            />
            <span className="text-[0.65rem] leading-4">Failed</span>
          </>
        ) : effective === 'skipped' || effective === 'canceled' ? (
          <>
            <FontAwesomeIcon
              className="size-5"
              icon={kind === 'video' ? 'video' : 'image'}
            />
            <span className="text-[0.65rem] capitalize leading-4">
              {effective}
            </span>
          </>
        ) : (
          <>
            <FontAwesomeIcon
              className="size-5"
              icon={kind === 'video' ? 'video' : 'image'}
            />
            <span className="text-[0.65rem] leading-4">No results yet</span>
          </>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Custom node
// ----------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  canceled: 'Canceled',
  skipped: 'Skipped',
};

function ModelNodeComponent({ id, data }: NodeProps) {
  const node = data as NodeData;
  const { role, modelId, values, flowId } = node;
  const {
    models,
    fieldsByModel,
    statusByNode,
    runningFlowIds,
    runModeByFlow,
    agentCheckpointByNode,
    flowMeta,
    isSavedCanvas,
    updateModel,
    updateValue,
    removeNode,
    addNodeToFlow,
  } = useCanvas();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [schemaCopied, setSchemaCopied] = useState(false);

  const kind = kindForRole(role);
  const color = ROLE_COLOR[role];
  const options = models.filter((model) => model.roles.includes(role));
  const model = models.find((entry) => entry.id === modelId);
  const liveGroup = fieldsByModel[modelSchemaCacheKey(role, modelId)];
  const nodeStatus = statusByNode[id];
  const HeaderIcon = inferenceIcon(model?.provider);
  const meta = flowMeta[flowId];
  const running = runningFlowIds.has(flowId);
  const runMode = runModeByFlow.get(flowId) ?? 'self_control';
  const lockedByAutopilot = runMode === 'agent_autopilot' && role !== 'image';
  const fieldControlsDisabled = running || lockedByAutopilot;
  // Keep the prompt (and any textarea) fully expanded after a successful run so
  // the operator never has to drag the box open again to read what was sent.
  const nodeSucceeded = nodeStatus?.status === 'succeeded';
  // Steps after the base image wait on an Amazon Nova checkpoint. While the flow
  // runs and this role's checkpoint has not arrived yet, Nova is still reasoning
  // ("thinking") and the step is not processing, so the results slot mirrors the
  // checkpoint badge instead of showing a misleading "Queued".
  const agentThinking =
    running &&
    runMode !== 'self_control' &&
    role !== 'image' &&
    !nodeStatus &&
    !agentCheckpointByNode[checkpointNodeId(flowId, role)];
  const addableRole: StepRole | null =
    role === 'image' && !meta?.roles.has('refine')
      ? 'refine'
      : role === 'video' && !meta?.roles.has('modify')
        ? 'modify'
        : null;

  // Keep the last loaded field group visible while a newly selected model's
  // schema loads, so the card does not collapse to a "Loading" box and jump.
  const [stickyGroup, setStickyGroup] = useState(liveGroup);
  useEffect(() => {
    if (liveGroup) setStickyGroup(liveGroup);
  }, [liveGroup]);
  const group = liveGroup ?? stickyGroup;
  const loading = !liveGroup;
  const schemaFields = group
    ? [...group.core, ...group.advanced].filter((field) =>
        shouldRenderFieldForRole(field, role),
      )
    : [];
  const schemaJson = group
    ? createNodeSchemaJson({
        fields: schemaFields,
        modelId,
        modelLabel: model?.label ?? modelId,
      })
    : null;

  const copySchema = useCallback(async () => {
    if (!schemaJson) return;

    try {
      await navigator.clipboard.writeText(JSON.stringify(schemaJson, null, 2));
      setSchemaCopied(true);
      window.setTimeout(() => setSchemaCopied(false), 1600);
    } catch {
      toast.error('Copying the JSON schema failed.');
    }
  }, [schemaJson]);

  return (
    <div className="group relative w-[400px] border border-border bg-card shadow-lg">
      <div className="h-1.5 w-full" style={{ backgroundColor: color }} />
      {/* Every model card receives a rope: image_model from the flow's
          canvas_flow card, later steps from the previous model card. */}
      <Handle
        type="target"
        position={Position.Left}
        className="!size-3 !border-2 !border-background"
        style={{ backgroundColor: color }}
      />
      {/* Every model card connects forward, to the next step or to the
          flow's runner card, so all roles render a source handle. */}
      <Handle
        type="source"
        position={Position.Right}
        className="!size-3 !border-2 !border-background"
        style={{ backgroundColor: color }}
      />

      {/* Large round add button to the right of image/video cards makes the
          next optional step discoverable: refine after image, modify after
          video. */}
      {addableRole && !running && !isSavedCanvas ? (
        <div className="group/add absolute right-0 top-1/2 z-10 -translate-y-1/2 translate-x-[calc(100%+20px)]">
          <button
            type="button"
            aria-label={`Add ${addableRole}_model`}
            onClick={() => addNodeToFlow(flowId, addableRole)}
            className="nodrag flex size-12 items-center justify-center rounded-full border-2 bg-card shadow-lg transition hover:scale-110"
            style={{
              borderColor: ROLE_COLOR[addableRole],
              color: ROLE_COLOR[addableRole],
            }}
          >
            <FontAwesomeIcon className="size-5" icon="plus" />
          </button>
          <span className="pointer-events-none absolute left-1/2 top-full mt-1.5 hidden -translate-x-1/2 whitespace-nowrap border border-border bg-card px-2 py-0.5 text-[0.6rem] font-medium text-foreground shadow-xl group-hover/add:block">
            {addableRole}_model
          </span>
        </div>
      ) : null}

      {/* Section 1: card name + status badge, vertically centered */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="font-mono text-xs font-semibold" style={{ color }}>
          {role}_model
        </div>
        <div className="flex items-center gap-1.5">
          {nodeStatus ? (
            <span
              className={cn(
                'border px-1.5 py-0.5 text-[0.6rem] font-medium uppercase tracking-wide',
                nodeStatus.status === 'succeeded' &&
                  'border-emerald-300 text-emerald-300',
                nodeStatus.status === 'failed' &&
                  'border-rose-300 text-rose-300',
                nodeStatus.status === 'running' &&
                  'border-sky-300 text-sky-300 animate-pulse',
                (nodeStatus.status === 'queued' ||
                  nodeStatus.status === 'skipped' ||
                  nodeStatus.status === 'canceled') &&
                  'border-border text-muted-foreground',
              )}
            >
              {STATUS_LABELS[nodeStatus.status] ?? nodeStatus.status}
            </span>
          ) : null}
          {/* image_model and video_model are always required, so they have no
              delete control. refine_model and modify_model are optional. */}
          {role === 'refine' || role === 'modify' ? (
            <span className="group/remove relative">
              <button
                type="button"
                aria-label="Remove"
                disabled={running || isSavedCanvas}
                onClick={() => removeNode(id)}
                className="nodrag flex size-6 items-center justify-center border border-transparent text-muted-foreground transition hover:border-border hover:text-destructive disabled:opacity-40"
              >
                <FontAwesomeIcon className="size-3" icon="trash" />
              </button>
              {isSavedCanvas ? (
                <span className="pointer-events-none absolute right-0 top-full z-20 mt-1.5 hidden w-56 border border-border bg-card px-2.5 py-1.5 text-center text-[0.65rem] leading-4 text-foreground shadow-xl group-hover/remove:block">
                  Saved canvases keep their structure. Edit this flow on the
                  Canvas page instead.
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      </div>

      {/* Section 2: inference provider name, its own separated section */}
      {model ? (
        <div className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-[0.65rem] text-muted-foreground">
          {HeaderIcon ? (
            <HeaderIcon className="size-3.5" aria-hidden="true" />
          ) : null}
          {model.providerLabel}
        </div>
      ) : null}

      {/* Section 3: model select + schema fields */}
      <div className="space-y-3 p-3">
        <div className="grid gap-1">
          <span className="font-mono text-[0.7rem] text-muted-foreground">
            model
          </span>
          <ModelDropdown
            options={options}
            value={modelId}
            disabled={running}
            onChange={(next) => updateModel(id, next)}
          />
        </div>

        {!group ? (
          <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
            <FontAwesomeIcon className="size-3.5 animate-spin" icon="spinner" />
            Loading schema…
          </div>
        ) : (
          <>
            {loading ? (
              <div className="h-0.5 w-full overflow-hidden bg-border">
                <div className="h-full w-1/3 animate-pulse bg-primary" />
              </div>
            ) : null}
            {group.core
              .filter((field) => shouldRenderFieldForRole(field, role))
              .map((field) => (
                <FieldRow
                  key={field.name}
                  field={field}
                  value={values[field.name]}
                  disabled={fieldControlsDisabled}
                  settled={nodeSucceeded}
                  onChange={(value) => updateValue(id, field.name, value)}
                />
              ))}

            {group.advanced.length > 0 ? (
              <div className="border border-border">
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((open) => !open)}
                  className="nodrag flex w-full items-center justify-between px-2.5 py-1.5 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground transition hover:text-foreground"
                >
                  <span>Advanced · {group.advanced.length}</span>
                  <FontAwesomeIcon
                    className={cn(
                      'size-3.5 transition-transform',
                      advancedOpen && 'rotate-180',
                    )}
                    icon="chevron-down"
                  />
                </button>
                {advancedOpen ? (
                  <div className="space-y-3 border-t border-border p-2.5">
                    {group.advanced
                      .filter((field) => shouldRenderFieldForRole(field, role))
                      .map((field) => (
                        <FieldRow
                          key={field.name}
                          field={field}
                          value={values[field.name]}
                          disabled={fieldControlsDisabled}
                          settled={nodeSucceeded}
                          onChange={(value) =>
                            updateValue(id, field.name, value)
                          }
                        />
                      ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {schemaJson ? (
              <div className="border border-border">
                <button
                  type="button"
                  aria-expanded={schemaOpen}
                  onClick={() => setSchemaOpen((open) => !open)}
                  className={cn(
                    'nodrag flex w-full items-center justify-between gap-3 px-2.5 py-1.5 text-left font-mono text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground transition hover:text-foreground',
                    schemaOpen && 'border-b border-border',
                  )}
                >
                  <span>JSON Schema</span>
                  <FontAwesomeIcon
                    className={cn(
                      'size-3.5 transition-transform',
                      schemaOpen && 'rotate-180',
                    )}
                    icon="chevron-down"
                  />
                </button>
                {schemaOpen ? (
                  <div className="p-2.5">
                    <div className="mb-2 flex justify-end">
                      <Button
                        aria-label={
                          schemaCopied ? 'Schema copied' : 'Copy schema'
                        }
                        className="nodrag h-7 px-2 text-[0.65rem]"
                        size="sm"
                        title={schemaCopied ? 'Copied' : 'Copy'}
                        variant="ghost"
                        onClick={() => void copySchema()}
                      >
                        <FontAwesomeIcon
                          icon={schemaCopied ? 'check' : 'copy'}
                        />
                        {schemaCopied ? 'Copied' : 'Copy'}
                      </Button>
                    </div>
                    <NodeSchemaJsonBlock value={schemaJson} />
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}

        {running || nodeStatus ? (
          <div className="grid gap-1">
            <span className="font-mono text-[0.7rem] text-muted-foreground">
              results
            </span>
            <NodeResults
              kind={kind}
              running={running}
              status={nodeStatus?.status}
              outputs={nodeStatus?.outputs}
              startedAt={nodeStatus?.startedAt}
              thinking={agentThinking}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AgentCheckpointPanel({
  checkpoint,
  mode,
  disabled,
  fields,
  pending,
  onApprove,
}: {
  checkpoint: AgentCheckpoint;
  mode: RunMode;
  disabled: boolean;
  fields: FieldSpec[];
  pending: boolean;
  onApprove: (
    prompt: string,
    params: Record<string, unknown>,
    modelValues: Record<string, FieldValue>,
  ) => Promise<void>;
}) {
  const suggestions = checkpoint.suggestions ?? [];
  const isAutopilot = mode === 'agent_autopilot';
  const promptField = hasProposedField(fields, 'generation_prompt');
  const promptVisible = suggestions.length > 0 || promptField;
  const paramFields = fields.filter(
    (field) => field.name !== 'generation_prompt',
  );

  // Seed the editable form from the agent's proposal. The parent remounts this
  // panel via `key={checkpoint.id}`, so a new checkpoint always starts fresh.
  const [values, setValues] = useState<Record<string, FieldValue>>(() => {
    const proposed = proposedParamsForSelection(
      checkpoint.selected_params ?? {},
      undefined,
      fields,
    );
    const initial: Record<string, FieldValue> = {};
    for (const field of paramFields) {
      initial[field.name] = checkpointFieldValue(proposed[field.name], field);
    }
    return initial;
  });
  const [locked, setLocked] = useState<Record<string, boolean>>({});
  // Prompt picker: one of the agent suggestions, or 'custom' for a user prompt.
  const [promptChoice, setPromptChoice] = useState<number | 'custom'>(() => {
    if (suggestions.length === 0) return 'custom';
    const matchIndex = suggestions.findIndex(
      (suggestion) => suggestion.prompt === checkpoint.selected_prompt,
    );
    return matchIndex >= 0 ? matchIndex : 0;
  });
  const [customPrompt, setCustomPrompt] = useState(() =>
    suggestions.length === 0 ? (checkpoint.selected_prompt ?? '') : '',
  );
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);

  const effectivePrompt = (
    promptChoice === 'custom'
      ? customPrompt
      : (suggestions[promptChoice]?.prompt ?? '')
  ).trim();
  const promptValue = promptVisible
    ? effectivePrompt
    : (checkpoint.selected_prompt ?? '').trim();

  // Copilot approval is gated on the operator locking every proposed field; the
  // prompt is auto-locked the moment one is picked.
  const allParamsLocked = paramFields.every((field) => locked[field.name]);

  // Drive the button + status line from the server checkpoint status so they
  // stay correct once the step finishes (and survive a panel remount), instead
  // of relying only on the local approving/approved flags.
  const stepDone = !pending && checkpoint.status === 'applied';
  const stepFailed = !pending && checkpoint.status === 'failed';
  // Terminal server states win over the local optimistic flags, so once the
  // step is applied/failed the button stops spinning and shows a static icon
  // instead of staying in the "processing" state because `approved` lingers.
  const stepProcessing =
    !stepDone &&
    !stepFailed &&
    (approving || approved || (!pending && checkpoint.status === 'approved'));
  const stepApproved = stepProcessing || stepDone || stepFailed;
  const stepHint = stepFailed
    ? isAutopilot
      ? 'Autopilot step failed.'
      : 'Agent step failed.'
    : stepDone
      ? 'Step complete.'
      : stepProcessing
        ? isAutopilot
          ? 'Autopilot is running this step…'
          : 'Agent step sent, processing…'
        : isAutopilot
          ? 'Autopilot runs this step automatically.'
          : allParamsLocked
            ? 'Agent ready to continue.'
            : 'Pick a prompt and lock every proposed field to enable Approve.';

  const chooseSuggestion = (index: number) => {
    setPromptChoice(index);
    const suggestion = suggestions[index];
    if (!suggestion?.params) return;

    setValues((current) => {
      const next = { ...current };
      for (const [key, raw] of Object.entries(suggestion.params ?? {})) {
        if (locked[key]) continue;
        const field = paramFields.find((candidate) => candidate.name === key);
        if (field) {
          next[key] = checkpointFieldValue(raw, field);
        }
      }
      return next;
    });
  };

  const approve = async () => {
    if (stepApproved) return;
    if (!promptValue) {
      toast.error('Choose or write an Agentic Workflow prompt first.');
      return;
    }

    setApproving(true);
    try {
      const params = coerceCheckpointParams(values, paramFields);
      if (promptField) {
        params.generation_prompt = promptValue;
      }
      // Display-form values so the step's model card can update instantly.
      const modelValues: Record<string, FieldValue> = { ...values };
      if (promptField) {
        modelValues.generation_prompt = promptValue;
      }
      await onApprove(promptValue, params, modelValues);
      setApproved(true);
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="space-y-2 p-3">
      {pending ? (
        <p className="text-[0.65rem] leading-4 text-muted-foreground">
          {isAutopilot
            ? 'Waiting for the previous step output. The agent will write and run this step automatically.'
            : 'Waiting for the previous step output. The agent will propose a prompt and fields here for you to review and approve.'}
        </p>
      ) : null}

      {!pending && promptVisible ? (
        <div className="grid gap-1.5">
          <span className="text-[0.62rem] font-medium uppercase tracking-wide text-muted-foreground">
            prompt
          </span>
          {suggestions.map((suggestion, index) => (
            <button
              type="button"
              key={`${checkpoint.id}:${index}`}
              disabled={disabled || approving}
              onClick={() => chooseSuggestion(index)}
              className={cn(
                'nodrag border px-2 py-1.5 text-left text-[0.65rem] leading-4 transition disabled:opacity-60',
                promptChoice === index
                  ? 'border-ring bg-muted text-foreground'
                  : 'border-border text-muted-foreground hover:border-ring hover:text-foreground',
              )}
            >
              <span className="block font-medium text-foreground">
                {suggestion.title || `Option ${index + 1}`}
              </span>
              <span className="mt-1 block whitespace-pre-wrap break-words">
                {suggestion.prompt}
              </span>
            </button>
          ))}
          {!isAutopilot ? (
            <button
              type="button"
              disabled={disabled || approving}
              onClick={() => setPromptChoice('custom')}
              className={cn(
                'nodrag border px-2 py-1.5 text-left text-[0.65rem] leading-4 transition disabled:opacity-60',
                promptChoice === 'custom'
                  ? 'border-ring bg-muted text-foreground'
                  : 'border-border text-muted-foreground hover:border-ring hover:text-foreground',
              )}
            >
              <span className="block font-medium text-foreground">
                Your prompt
              </span>
              <span className="mt-1 block">
                Write a custom prompt for this step.
              </span>
            </button>
          ) : null}
          {!isAutopilot && promptChoice === 'custom' ? (
            <TextInputControl
              as="textarea"
              className="nodrag min-h-20 w-full resize-y border border-border bg-input px-2.5 py-1.5 text-xs text-foreground outline-none focus-visible:border-ring disabled:opacity-50"
              disabled={disabled || approving}
              rows={3}
              value={customPrompt}
              onChange={(value) => setCustomPrompt(String(value ?? ''))}
            />
          ) : null}
        </div>
      ) : null}

      {!pending && paramFields.length > 0 ? (
        <div className="grid gap-2 border border-border p-2">
          <span className="text-[0.62rem] font-medium uppercase tracking-wide text-muted-foreground">
            proposed_fields
          </span>
          {paramFields.map((field) => {
            const fieldLocked = Boolean(locked[field.name]);

            return (
              <div key={field.name} className="grid gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[0.7rem] text-muted-foreground">
                    {field.name}
                    {field.required ? (
                      <span className="text-destructive"> *</span>
                    ) : null}
                  </span>
                  {!isAutopilot ? (
                    <label className="nodrag flex shrink-0 cursor-pointer items-center gap-1 text-[0.6rem] text-muted-foreground">
                      <input
                        type="checkbox"
                        className="nodrag size-3 accent-primary"
                        checked={fieldLocked}
                        disabled={disabled || approving}
                        onChange={(event) =>
                          setLocked((current) => ({
                            ...current,
                            [field.name]: event.target.checked,
                          }))
                        }
                      />
                      lock
                    </label>
                  ) : null}
                </div>
                <FieldControl
                  field={field}
                  value={values[field.name]}
                  disabled={disabled || approving || fieldLocked}
                  onChange={(next) =>
                    setValues((current) => ({
                      ...current,
                      [field.name]: next,
                    }))
                  }
                />
              </div>
            );
          })}
        </div>
      ) : null}

      {!pending ? (
        <div className="grid gap-1">
          {!isAutopilot ? (
            <Button
              className="nodrag w-full"
              size="sm"
              disabled={
                disabled || stepApproved || !promptValue || !allParamsLocked
              }
              onClick={approve}
            >
              <FontAwesomeIcon
                className={stepProcessing ? 'animate-spin' : undefined}
                icon={
                  stepProcessing
                    ? 'spinner'
                    : stepFailed
                      ? 'triangle-exclamation'
                      : 'check'
                }
              />
              {stepApproved ? 'Approved' : 'Approve & continue'}
            </Button>
          ) : null}
          <p className="px-0.5 text-[0.6rem] leading-4 text-muted-foreground">
            {stepHint}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function proposedParamsForSelection(
  checkpointParams: Record<string, unknown>,
  selected: AgentCheckpointSuggestion | undefined,
  fields: FieldSpec[],
) {
  const params = completeProposedParams(fields, {
    ...completeProposedParams(fields, checkpointParams),
    ...(selected?.params ?? {}),
  });

  if (selected?.prompt && hasProposedField(fields, 'generation_prompt')) {
    params.generation_prompt = selected.prompt;
  }

  return params;
}

function completeProposedParams(
  fields: FieldSpec[],
  params: Record<string, unknown>,
) {
  const completed = { ...params };

  for (const field of fields) {
    if (completed[field.name] !== undefined && completed[field.name] !== null) {
      continue;
    }

    const fallback = proposedFieldFallback(field);
    if (fallback !== undefined) {
      completed[field.name] = fallback;
    }
  }

  return completed;
}

function proposedFieldFallback(field: FieldSpec): unknown {
  if (field.default !== undefined) return field.default;

  if (field.type === 'select') {
    return field.options?.[0]?.value ?? '';
  }

  if (field.type === 'boolean') return false;
  if (field.valueKind === 'number' || field.type === 'number') {
    return field.min ?? 0;
  }
  if (field.valueKind === 'string-array') return [];
  if (field.valueKind === 'json') return {};

  return '';
}

function hasProposedField(fields: FieldSpec[], fieldName: string) {
  return fields.some((field) => field.name === fieldName);
}

function checkpointFieldValue(value: unknown, field: FieldSpec): FieldValue {
  const resolved =
    value === undefined || value === null
      ? proposedFieldFallback(field)
      : value;

  if (
    typeof resolved === 'string' ||
    typeof resolved === 'number' ||
    typeof resolved === 'boolean'
  ) {
    return resolved;
  }

  if (resolved === undefined || resolved === null) {
    return '';
  }

  return JSON.stringify(resolved);
}

function coerceCheckpointParams(
  values: Record<string, FieldValue>,
  fields: FieldSpec[],
): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  for (const field of fields) {
    const value = values[field.name];
    if (value === undefined) {
      continue;
    }

    if (field.valueKind === 'number' || field.type === 'number') {
      if (typeof value === 'number') {
        params[field.name] = value;
      } else {
        const numeric = Number(value);
        params[field.name] = Number.isFinite(numeric) ? numeric : value;
      }
      continue;
    }

    if (field.valueKind === 'string-array') {
      params[field.name] = normalizeStringArrayValue(value);
      continue;
    }

    if (field.valueKind === 'json' && typeof value === 'string') {
      try {
        params[field.name] = JSON.parse(value);
      } catch {
        params[field.name] = value;
      }
      continue;
    }

    params[field.name] = value;
  }

  return params;
}

function CheckpointNodeComponent({ data }: NodeProps) {
  const node = data as NodeData;
  const { flowId, role } = node;
  const {
    agentCheckpointByNode,
    continueAgentCheckpoint,
    fieldsByModel,
    runningFlowIds,
    runModeByFlow,
  } = useCanvas();
  const runMode = runModeByFlow.get(flowId) ?? 'self_control';
  const state = agentCheckpointByNode[checkpointNodeId(flowId, role)];
  const running = runningFlowIds.has(flowId);
  const agentStatus = state ? 'done' : running ? 'thinking' : 'waiting';
  const checkpoint =
    state?.checkpoint ?? createPendingCheckpointPlaceholder(role, runMode);
  const fieldGroup = fieldsByModel[modelSchemaCacheKey(role, node.modelId)];
  const fields = fieldGroup
    ? [...fieldGroup.core, ...fieldGroup.advanced].filter((field) =>
        shouldRenderFieldForRole(field, role),
      )
    : [];

  return (
    <div className="w-[400px] border border-border bg-card shadow-lg">
      <div className="h-1.5 w-full" style={{ backgroundColor: RUNNER_COLOR }} />
      <Handle
        type="target"
        position={Position.Left}
        className="!size-3 !border-2 !border-background"
        style={{ backgroundColor: RUNNER_COLOR }}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!size-3 !border-2 !border-background"
        style={{ backgroundColor: RUNNER_COLOR }}
      />

      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div
          className="font-mono text-xs font-semibold"
          style={{ color: RUNNER_COLOR }}
        >
          checkpoint_{role}
        </div>
        <span
          className={cn(
            'border px-1.5 py-0.5 text-[0.6rem] font-medium uppercase tracking-wide',
            agentStatus === 'thinking' &&
              'animate-pulse border-primary text-primary',
            agentStatus === 'done' && 'border-emerald-300 text-emerald-300',
            agentStatus === 'waiting' && 'border-border text-muted-foreground',
          )}
        >
          {agentStatus}
        </span>
      </div>

      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-[0.65rem] text-muted-foreground">
        <InlineAmazonNova className="size-3.5" aria-hidden="true" />
        Amazon Nova
        <span className="border border-border px-1.5 py-0.5 text-[0.6rem] font-medium uppercase tracking-wide text-muted-foreground">
          {runMode === 'agent_autopilot' ? 'Autopilot' : 'Copilot'}
        </span>
      </div>

      <AgentCheckpointPanel
        key={checkpoint.id}
        checkpoint={checkpoint}
        mode={runMode}
        disabled={!running || runMode !== 'agent_copilot' || !state}
        fields={fields}
        pending={!state}
        onApprove={async (prompt, params, modelValues) => {
          if (!state) return;
          await continueAgentCheckpoint(
            flowId,
            role,
            state.checkpoint.id,
            prompt,
            params,
            modelValues,
          );
        }}
      />
    </div>
  );
}

function createPendingCheckpointPlaceholder(
  role: StepRole,
  mode: RunMode,
): AgentCheckpoint {
  return {
    id: checkpointNodeId('pending', role),
    selected_params: null,
    selected_prompt: null,
    status: mode === 'agent_autopilot' ? 'approved' : 'suggested',
    step_key: role,
    suggestions: [],
  };
}

type ApiCurlKey = 'cancel' | 'create' | 'get' | 'list';

type ApiCurlSection = {
  key: ApiCurlKey;
  label: string;
  value: string | null;
};

function CurlNodeComponent({ data }: NodeProps) {
  const { flowId } = data as NodeData;
  const { createFlowCurl, runIdsByFlow } = useCanvas();
  const [openSections, setOpenSections] = useState<
    Partial<Record<ApiCurlKey, boolean>>
  >({});
  const [copiedKey, setCopiedKey] = useState<ApiCurlKey | null>(null);
  const curlText = createFlowCurl(flowId);
  const runId = runIdsByFlow.get(flowId);
  const sections = useMemo<ApiCurlSection[]>(
    () => [
      { key: 'list', label: 'List chains', value: createListChainsCurl() },
      { key: 'create', label: 'Create chain', value: curlText },
      { key: 'get', label: 'Get run', value: createGetRunCurl({ runId }) },
      {
        key: 'cancel',
        label: 'Cancel run',
        value: createCancelRunCurl({ runId }),
      },
    ],
    [curlText, runId],
  );

  const copyApiRequest = useCallback(async (key: ApiCurlKey, value: string) => {
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1600);
    } catch {
      toast.error('Copying the API request failed.');
    }
  }, []);

  const toggleSection = useCallback((key: ApiCurlKey) => {
    setOpenSections((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  return (
    <div className="w-[400px] border border-border bg-card shadow-lg">
      <div className="h-1.5 w-full" style={{ backgroundColor: RUNNER_COLOR }} />
      <Handle
        type="target"
        position={Position.Left}
        className="!size-3 !border-2 !border-background"
        style={{ backgroundColor: RUNNER_COLOR }}
      />

      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div
          className="font-mono text-xs font-semibold"
          style={{ color: RUNNER_COLOR }}
        >
          api
        </div>
      </div>

      <div className="space-y-2 p-3">
        <p className="text-[0.65rem] leading-4 text-muted-foreground">
          Chain API requests for this canvas flow.
        </p>
        {sections.map((section) => (
          <ApiCurlDropdown
            copied={copiedKey === section.key}
            key={section.key}
            label={section.label}
            open={Boolean(openSections[section.key])}
            value={section.value}
            onCopy={() => {
              if (section.value) {
                void copyApiRequest(section.key, section.value);
              }
            }}
            onToggle={() => toggleSection(section.key)}
          />
        ))}
      </div>
    </div>
  );
}

function ApiCurlDropdown({
  copied,
  label,
  open,
  value,
  onCopy,
  onToggle,
}: {
  copied: boolean;
  label: string;
  open: boolean;
  value: string | null;
  onCopy: () => void;
  onToggle: () => void;
}) {
  return (
    <div className="border border-border">
      <button
        type="button"
        aria-expanded={open}
        disabled={!value}
        onClick={onToggle}
        className={cn(
          'nodrag flex w-full items-center justify-between gap-3 px-2.5 py-1.5 text-left font-mono text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground transition hover:text-foreground disabled:opacity-50',
          open && 'border-b border-border',
        )}
      >
        <span>{label}</span>
        <FontAwesomeIcon
          className={cn('size-3.5 transition-transform', open && 'rotate-180')}
          icon="chevron-down"
        />
      </button>
      {open && value ? (
        <div className="p-2.5">
          <div className="mb-2 flex justify-end">
            <Button
              aria-label={copied ? `${label} copied` : `Copy ${label}`}
              className="nodrag h-7 px-2 text-[0.65rem]"
              size="sm"
              title={copied ? 'Copied' : 'Copy'}
              variant="ghost"
              onClick={onCopy}
            >
              <FontAwesomeIcon icon={copied ? 'check' : 'copy'} />
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <NodeCurlBlock value={value} />
        </div>
      ) : null}
    </div>
  );
}

// Dedicated per-flow runner card, rendered as the last node of every flow.
// It is derived from the flow (never persisted) and carries the run
// controls: "Run only" executes in place; "RUN + SAVE" also publishes the
// flow to the Library.
function RunnerNodeComponent({ data }: NodeProps) {
  const { flowId } = data as NodeData;
  const {
    runningFlowIds,
    runFlow,
    cancelFlow,
    removeFlow,
    duplicateFlow,
    flowCount,
    isSavedCanvas,
    runValidationByFlow,
  } = useCanvas();
  const running = runningFlowIds.has(flowId);
  const runValidation = runValidationByFlow[flowId] ?? {
    ok: false,
    reason: 'Loading this flow.',
  };
  const runDisabledReason = runValidation.ok ? null : runValidation.reason;
  const runDisabled = running || runDisabledReason !== null;
  // The last flow on the workspace cannot be removed (Reset canvas is the
  // explicit wipe), and saved canvases are deleted from the Library instead.
  const removeDisabledReason = isSavedCanvas
    ? 'Remove this canvas flow from its card in the Library page.'
    : flowCount <= 1
      ? 'You cannot remove the last canvas flow.'
      : null;

  return (
    <div className="w-[280px] border border-border bg-card shadow-lg">
      <div className="h-1.5 w-full" style={{ backgroundColor: RUNNER_COLOR }} />
      <Handle
        type="target"
        position={Position.Left}
        className="!size-3 !border-2 !border-background"
        style={{ backgroundColor: RUNNER_COLOR }}
      />

      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div
          className="font-mono text-xs font-semibold"
          style={{ color: RUNNER_COLOR }}
        >
          runner
        </div>
        {running ? (
          <span className="border border-primary px-1.5 py-0.5 text-[0.6rem] font-medium uppercase tracking-wide text-primary animate-pulse">
            Running
          </span>
        ) : null}
      </div>

      <div className="space-y-2 p-3">
        <p className="text-[0.65rem] leading-4 text-muted-foreground">
          <RunnerActionLabel>Run only</RunnerActionLabel> keeps results here.{' '}
          <RunnerActionLabel>RUN + SAVE</RunnerActionLabel> publishes this flow
          as a new Canvas card in Library page each time.
        </p>
        <span className="group relative block">
          <Button
            className="nodrag w-full"
            size="sm"
            variant="outline"
            disabled={runDisabled}
            onClick={() => runFlow(flowId, false)}
          >
            <FontAwesomeIcon icon="play" />
            Run only
          </Button>
          {runDisabledReason && !running ? (
            <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 hidden w-64 -translate-x-1/2 border border-border bg-card px-2.5 py-1.5 text-center text-[0.65rem] leading-4 text-foreground shadow-xl group-hover:block">
              {runDisabledReason}
            </span>
          ) : null}
        </span>
        <span className="group relative block">
          <Button
            className="nodrag w-full"
            size="sm"
            disabled={runDisabled}
            onClick={() => runFlow(flowId, true)}
          >
            <FontAwesomeIcon icon="floppy-disk" />
            RUN + SAVE
          </Button>
          {runDisabledReason && !running ? (
            <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 hidden w-64 -translate-x-1/2 border border-border bg-card px-2.5 py-1.5 text-center text-[0.65rem] leading-4 text-foreground shadow-xl group-hover:block">
              {runDisabledReason}
            </span>
          ) : null}
        </span>
        <span className="group relative block">
          <Button
            className="nodrag w-full"
            size="sm"
            variant="outline"
            disabled={isSavedCanvas}
            onClick={() => duplicateFlow(flowId)}
          >
            <FontAwesomeIcon icon="copy" />
            Duplicate
          </Button>
          {isSavedCanvas ? (
            <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 hidden w-60 -translate-x-1/2 border border-border bg-card px-2.5 py-1.5 text-center text-[0.65rem] leading-4 text-foreground shadow-xl group-hover:block">
              Duplicate flows from the workspace canvas.
            </span>
          ) : null}
        </span>
        {running ? (
          <Button
            className="nodrag w-full"
            size="sm"
            variant="destructive"
            onClick={() => cancelFlow(flowId)}
          >
            <FontAwesomeIcon icon="square" />
            Cancel
          </Button>
        ) : null}
        <span className="group relative block">
          <Button
            className="nodrag w-full"
            size="sm"
            variant="ghost"
            disabled={running || removeDisabledReason !== null}
            onClick={() => removeFlow(flowId)}
          >
            <FontAwesomeIcon icon="trash" />
            Remove this flow
          </Button>
          {removeDisabledReason ? (
            <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 hidden w-60 -translate-x-1/2 border border-border bg-card px-2.5 py-1.5 text-center text-[0.65rem] leading-4 text-foreground shadow-xl group-hover:block">
              {removeDisabledReason}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}

const RUN_MODE_OPTIONS: Array<{
  label: string;
  description: string;
  value: RunMode;
}> = [
  {
    label: 'Self Control',
    description: 'You write every step; Marsha runs the chain as-is.',
    value: 'self_control',
  },
  {
    label: 'Agentic · Copilot',
    description: 'The agent proposes each next step; you approve or edit it.',
    value: 'agent_copilot',
  },
  {
    label: 'Agentic · Autopilot',
    description:
      'The agent writes and runs every next step. Pick the model on each card, the agent runs the model you display.',
    value: 'agent_autopilot',
  },
];

function RunnerActionLabel({ children }: { children: ReactNode }) {
  return (
    <code className="border border-border bg-muted/40 px-1 py-0.5 font-mono text-[0.62rem] text-foreground">
      {children}
    </code>
  );
}

// Flow info card: the first card of every flow. It carries the flow's Library
// identity after publish, and the name (pencil to edit) becomes the Library
// title on "RUN + SAVE".
function InfoNodeComponent({ id, data }: NodeProps) {
  const node = data as NodeData;
  const { flowId, values } = node;
  const {
    byokProviders,
    flowMeta,
    providerMode,
    runModeByFlow,
    setRunMode,
    updateValue,
    moveFlowBy,
    runningFlowIds,
    renameCanvas,
  } = useCanvas();
  const { getZoom } = useReactFlow();
  const running = runningFlowIds.has(flowId);
  const runMode = runModeByFlow.get(flowId) ?? 'self_control';
  const nameValue = typeof values.name === 'string' ? values.name : '';
  const modelContextValue =
    typeof values.model_context === 'string' ? values.model_context : '';
  const autoName = flowMeta[flowId]?.autoName ?? 'Untitled canvas';

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(nameValue);
  const dragRef = useRef<{
    clientX: number;
    clientY: number;
    pointerId: number;
  } | null>(null);

  const commit = () => {
    setEditing(false);
    const trimmed = normalizeCanvasTitle(draft);
    const title = trimmed || autoName;
    setDraft(title);
    updateValue(id, 'name', title);
    // Saved canvas pages use the route Library id. Workspace flows that have
    // already been published carry their Library id on the info card, so a
    // later rename updates the Library card immediately too.
    renameCanvas(flowId, title);
  };
  const startFlowDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
    };
  };
  const moveFlowDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    event.preventDefault();
    event.stopPropagation();

    const zoom = getZoom() || 1;
    const delta = {
      x: (event.clientX - drag.clientX) / zoom,
      y: (event.clientY - drag.clientY) / zoom,
    };

    if (delta.x !== 0 || delta.y !== 0) {
      moveFlowBy(flowId, delta);
    }

    dragRef.current = {
      ...drag,
      clientX: event.clientX,
      clientY: event.clientY,
    };
  };
  const endFlowDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const clearLostFlowDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  };

  return (
    <div className="relative w-[280px]">
      <div className="nodrag nopan absolute -top-16 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center">
        <button
          type="button"
          aria-label="Move canvas flow"
          title="Move canvas flow"
          className="nodrag nopan flex size-12 touch-none select-none items-center justify-center border border-border bg-card text-muted-foreground shadow-xl transition hover:border-primary hover:text-foreground active:cursor-grabbing"
          onPointerDown={startFlowDrag}
          onPointerMove={moveFlowDrag}
          onPointerUp={endFlowDrag}
          onPointerCancel={endFlowDrag}
          onLostPointerCapture={clearLostFlowDrag}
        >
          <FontAwesomeIcon className="size-5" icon="up-down-left-right" />
        </button>
        <svg
          className="h-5 w-4 overflow-visible"
          viewBox="0 0 16 20"
          aria-hidden="true"
        >
          <path
            d="M8 0 V18"
            fill="none"
            stroke="#475067"
            strokeLinecap="round"
            strokeWidth="2"
          />
          <circle cx="8" cy="18" r="3" fill="#475067" />
        </svg>
      </div>

      <div className="border border-border bg-card shadow-lg">
        <div className="h-1.5 w-full" style={{ backgroundColor: INFO_COLOR }} />
        <Handle
          type="source"
          position={Position.Right}
          className="!size-3 !border-2 !border-background"
          style={{ backgroundColor: INFO_COLOR }}
        />

        <div className="border-b border-border px-3 py-2.5">
          <div
            className="font-mono text-xs font-semibold"
            style={{ color: INFO_COLOR }}
          >
            canvas_flow
          </div>
        </div>

        <div className="space-y-3 p-3">
          <div className="grid gap-1">
            <span className="font-mono text-[0.7rem] text-muted-foreground">
              canvas_name
            </span>
            {editing ? (
              <input
                autoFocus
                maxLength={MAX_CANVAS_TITLE_LENGTH}
                className="nodrag h-8 w-full border border-border bg-input px-2.5 text-xs text-foreground outline-none focus-visible:border-ring"
                value={draft}
                placeholder={autoName}
                onChange={(event) =>
                  setDraft(event.target.value.slice(0, MAX_CANVAS_TITLE_LENGTH))
                }
                onBlur={commit}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commit();
                  if (event.key === 'Escape') {
                    setDraft(nameValue);
                    setEditing(false);
                  }
                }}
              />
            ) : (
              <div className="flex items-start justify-between gap-1.5">
                <p className="min-w-0 flex-1 break-words text-xs leading-5 text-foreground [overflow-wrap:anywhere]">
                  {nameValue || autoName}
                </p>
                <button
                  type="button"
                  aria-label="Rename canvas"
                  disabled={running}
                  onClick={() => {
                    setDraft(nameValue || autoName);
                    setEditing(true);
                  }}
                  className="nodrag flex size-6 shrink-0 cursor-pointer items-center justify-center border border-transparent text-muted-foreground transition hover:border-border hover:text-foreground disabled:opacity-40"
                >
                  <FontAwesomeIcon className="size-3" icon="pen-to-square" />
                </button>
              </div>
            )}
          </div>
          <CanvasModeBadge mode={providerMode} byokProviders={byokProviders} />
          <div className="grid gap-1">
            <span className="font-mono text-[0.7rem] text-muted-foreground">
              chain_runner
            </span>
            <RunModeDropdown
              disabled={running}
              value={runMode}
              onChange={(value) => setRunMode(flowId, value)}
            />
          </div>
          {runMode !== 'self_control' ? (
            <div className="grid gap-1">
              <span className="font-mono text-[0.7rem] text-muted-foreground">
                model_context
              </span>
              <p className="text-[0.62rem] leading-snug text-muted-foreground">
                Optional creative brief for the agent. Describe the style, mood,
                scene, wardrobe, color grade, and camera direction it should
                apply to every step the agent plans after your first model card;
                it reinterprets each of those steps around your brief while
                keeping the subject the same. Anything that must be visible from
                the first frame, such as text or a logo on clothing, belongs in
                your first model card&rsquo;s prompt (or a refine step), because
                the agent never rewrites your base image and video models cannot
                add detail that is not already in it.
              </p>
              {running ? (
                <div className="nodrag min-h-40 w-full whitespace-pre-wrap break-words border border-border bg-input px-2.5 py-2 text-xs leading-5 text-foreground">
                  {modelContextValue.trim()}
                </div>
              ) : (
                <textarea
                  rows={6}
                  maxLength={2000}
                  value={modelContextValue}
                  onChange={(event) =>
                    updateValue(id, 'model_context', event.target.value)
                  }
                  className="nodrag min-h-40 w-full resize-y border border-border bg-input px-2.5 py-1.5 text-xs leading-5 text-foreground outline-none focus-visible:border-ring disabled:opacity-40"
                />
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CanvasModeBadge({
  byokProviders,
  mode,
}: {
  byokProviders: readonly ByokProviderKey[];
  mode: ProviderMode;
}) {
  return (
    <div className="grid gap-1">
      <span className="font-mono text-[0.7rem] text-muted-foreground">
        provider_mode
      </span>
      <div className="flex items-center justify-between gap-2 border border-border bg-muted/30 px-2.5 py-2">
        <span className="font-mono text-[0.65rem] text-foreground">
          {mode === 'byok' ? 'byok_mode' : 'babysea_mode'}
        </span>
        <span className="flex min-w-0 shrink-0 items-center gap-1.5">
          {mode === 'babysea' ? (
            <InlineBabySea className="size-4" aria-hidden="true" />
          ) : (
            byokProviders.map((provider) => {
              const Icon = inferenceIconForByokProvider(provider);

              return (
                <Icon className="size-4" aria-hidden="true" key={provider} />
              );
            })
          )}
        </span>
      </div>
    </div>
  );
}

const ModelNode = memo(ModelNodeComponent);
const CheckpointNode = memo(CheckpointNodeComponent);
const CurlNode = memo(CurlNodeComponent);
const RunnerNode = memo(RunnerNodeComponent);
const InfoNode = memo(InfoNodeComponent);
const nodeTypes: NodeTypes = {
  checkpoint: CheckpointNode,
  model: ModelNode,
  curl: CurlNode,
  runner: RunnerNode,
  info: InfoNode,
};

// ----------------------------------------------------------------------------
// Canvas
// ----------------------------------------------------------------------------

function compact(values: Record<string, FieldValue>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) output[key] = trimmed;
    } else if (typeof value === 'boolean') {
      // Booleans pass through as-is (true AND false) so a model's documented
      // default (e.g. moderation flags) reaches the provider unchanged.
      output[key] = value;
    } else {
      output[key] = value;
    }
  }
  return output;
}

function normalizeRunParams(
  params: Record<string, unknown>,
  group: FieldGroup | undefined,
) {
  if (!group) return params;

  const next = { ...params };
  const fields = [...group.core, ...group.advanced];

  for (const field of fields) {
    const value = next[field.name];

    if (value === undefined) {
      continue;
    }

    if (field.valueKind === 'number') {
      if (typeof value === 'number') continue;
      const numberValue = Number(value);
      if (Number.isFinite(numberValue)) {
        next[field.name] = numberValue;
      }
      continue;
    }

    if (field.valueKind === 'string-array') {
      next[field.name] = normalizeStringArrayValue(value);
      continue;
    }

    if (field.valueKind === 'json' && typeof value === 'string') {
      try {
        next[field.name] = JSON.parse(value);
      } catch {
        throw new Error(`${field.name} must be valid JSON.`);
      }
    }
  }

  return next;
}

function normalizeStringArrayValue(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }

  if (typeof value !== 'string') {
    return value;
  }

  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeInitialImageInputArrays(params: Record<string, unknown>) {
  const inputImageFile = params.generation_input_image_file;
  if (typeof inputImageFile === 'string') {
    params.generation_input_image_file = [inputImageFile];
  }
}

function shouldRenderFieldForRole(field: FieldSpec, role: StepRole) {
  return (
    role === 'image' ||
    !isChainWiredSemanticFieldName(field.name) ||
    (field.name === 'generation_input_video_file' && field.required === true) ||
    (role === 'modify' &&
      field.name === 'generation_input_image_file' &&
      field.required === true)
  );
}

function buildFlowRunInput(
  nodes: FlowNode[],
  flowId: string,
  fieldsByModel: Record<string, FieldGroup | undefined>,
  options: { agentDownstreamInputs?: boolean } = {},
) {
  const flowNodes = nodes
    .filter((node) => node.type === 'model' && node.data.flowId === flowId)
    .sort((a, b) => ROLE_RANK[a.data.role] - ROLE_RANK[b.data.role]);
  const chainModels: Record<string, string> = {};
  const input: Record<string, unknown> = {
    chain_models: chainModels,
  };

  for (const node of flowNodes) {
    const group =
      fieldsByModel[modelSchemaCacheKey(node.data.role, node.data.modelId)];
    const schemaFields = group
      ? [...group.core, ...group.advanced].filter((field) =>
          shouldRenderFieldForRole(field, node.data.role),
        )
      : [];
    const values =
      options.agentDownstreamInputs && node.data.role !== 'image'
        ? resetAgentPlannedValues(node.data.values, schemaFields)
        : node.data.values;
    const params = normalizeRunParams(compact(values), group);

    if (node.data.role === 'image') {
      normalizeInitialImageInputArrays(params);
    } else {
      for (const key of Object.keys(params)) {
        if (key === 'generation_input_file') {
          delete params[key];
          continue;
        }

        if (
          isChainWiredSemanticFieldName(key) &&
          !schemaFields.some((field) => field.name === key)
        ) {
          delete params[key];
        }
      }
    }

    chainModels[`${node.data.role}_model`] = node.data.modelId;
    input[`${node.data.role}_model_input`] = createStepInputFromValues({
      fields: schemaFields,
      values: params,
    });
  }

  return { flowNodes, input };
}

function resetAgentPlannedValues(
  values: Record<string, FieldValue>,
  fields: FieldSpec[],
) {
  const fieldNames = new Set(fields.map((field) => field.name));

  return Object.fromEntries(
    Object.entries(values).filter(([key]) => !fieldNames.has(key)),
  ) as Record<string, FieldValue>;
}

function resetAgentPlannedFlowValues(
  nodes: FlowNode[],
  flowId: string,
  fieldsByModel: Record<string, FieldGroup | undefined>,
) {
  let changed = false;

  const next = nodes.map((node) => {
    if (node.type !== 'model' || node.data.flowId !== flowId) {
      return node;
    }

    if (node.data.role === 'image') {
      return node;
    }

    const group =
      fieldsByModel[modelSchemaCacheKey(node.data.role, node.data.modelId)];
    if (!group) {
      return node;
    }

    const schemaFields = [...group.core, ...group.advanced].filter((field) =>
      shouldRenderFieldForRole(field, node.data.role),
    );
    const values = resetAgentPlannedValues(node.data.values, schemaFields);

    if (Object.keys(values).length === Object.keys(node.data.values).length) {
      return node;
    }

    changed = true;
    return {
      ...node,
      data: {
        ...node.data,
        values,
      },
    };
  });

  return { changed, nodes: next };
}

function runModeExecution(mode: RunMode) {
  if (mode === 'self_control') {
    return { type: 'self_control' };
  }

  return {
    type: 'chain_agent',
    mode: mode === 'agent_copilot' ? 'copilot' : 'autopilot',
    provider: 'bedrock',
  };
}

function buildFlowCurlInput(
  nodes: FlowNode[],
  flowId: string,
  fieldsByModel: Record<string, FieldGroup | undefined>,
) {
  const flowNodes = nodes
    .filter((node) => node.type === 'model' && node.data.flowId === flowId)
    .sort((a, b) => ROLE_RANK[a.data.role] - ROLE_RANK[b.data.role]);
  const chainModels: Record<string, string> = {};
  const input: Record<string, unknown> = {
    chain_models: chainModels,
  };

  for (const node of flowNodes) {
    const group =
      fieldsByModel[modelSchemaCacheKey(node.data.role, node.data.modelId)];
    const schemaFields = group
      ? [...group.core, ...group.advanced].filter((field) =>
          shouldRenderFieldForRole(field, node.data.role),
        )
      : [];
    const params = normalizeRunParams(compact(node.data.values), group);

    chainModels[`${node.data.role}_model`] = node.data.modelId;
    input[`${node.data.role}_model_input`] = createExampleStepInputFromValues({
      fields: schemaFields,
      values: params,
    });
  }

  return input;
}

function createNodeCurl(
  input: Record<string, unknown>,
  extras?: ChainRunRequestExtras,
) {
  return createChainRunCurl(input, {}, extras);
}

function firstAvailableModelForRole(models: CanvasModel[], role: StepRole) {
  return (
    models.find((model) => model.available && model.roles.includes(role)) ??
    models.find((model) => model.roles.includes(role))
  );
}

function CanvasInner(props: CanvasProps) {
  const {
    byokProviders,
    canvasId,
    initialTitle,
    initialNodes,
    initialRunId,
    initialFlowRuns,
    models,
    providerMode,
    getModelFieldsAction,
    runChainAction,
    getRunAction,
    cancelRunAction,
    saveCanvasAction,
    saveWorkspaceAction,
    recordFlowRunAction,
    renameCanvasAction,
  } = props;
  const saveToastIdRef = useRef<string | number | null>(null);
  const { fitView, getInternalNode, setCenter, getZoom } = useReactFlow();
  const [confirm, confirmDialog] = useConfirm();

  const firstImage = firstAvailableModelForRole(models, 'image');
  const firstVideo = firstAvailableModelForRole(models, 'video');

  const buildDefaultFlow = useCallback(
    (y: number): FlowNode[] => {
      const flowId = genFlowId();
      const infoNode: FlowNode = {
        id: `info_${flowId}`,
        type: 'info',
        position: { x: FLOW_X, y },
        data: {
          role: 'image' as StepRole,
          modelId: '',
          flowId,
          values: { name: createDefaultCanvasName() },
        },
      };
      return [
        infoNode,
        firstImage && {
          id: genId('image'),
          type: 'model',
          position: { x: FLOW_X + INFO_COL_W, y },
          data: {
            role: 'image' as StepRole,
            modelId: firstImage.id,
            flowId,
            values: {},
          },
        },
        firstVideo && {
          id: genId('video'),
          type: 'model',
          position: { x: FLOW_X + INFO_COL_W + FLOW_COL_W, y },
          data: {
            role: 'video' as StepRole,
            modelId: firstVideo.id,
            flowId,
            values: {},
          },
        },
      ].filter(Boolean) as FlowNode[];
    },
    [firstImage, firstVideo],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [hydrated, setHydrated] = useState(false);
  const nodesRef = useRef<FlowNode[]>([]);
  nodesRef.current = nodes;
  const pendingFitFlowIdsRef = useRef<Set<string> | null>(null);

  const queueFitViewForFlows = useCallback((flowIds: string[]) => {
    pendingFitFlowIdsRef.current = new Set(flowIds.filter(Boolean));
  }, []);

  // Smoothly pan/zoom the viewport onto one or more flows. We wait (via rAF)
  // until React Flow has measured the target nodes, otherwise the animation
  // starts from 0x0 placeholder bounds and the view jumps around.
  const animateFitToFlows = useCallback(
    (flowIds: ReadonlySet<string>) => {
      const startedAt = Date.now();
      const step = () => {
        const targetNodes = nodesRef.current.filter((node) =>
          flowIds.has(node.data.flowId),
        );
        if (targetNodes.length === 0) return;

        // Only ever fit nodes React Flow has actually measured. A brand-new
        // card is registered with 0x0 bounds for a frame or two; including it
        // poisons the bounding box and makes fitView zoom the whole canvas far
        // out (the "slow zoom-out, new card not shown" bug). Wait until the new
        // card is measured so it is part of the fit, but cap the wait so a
        // stuck measurement can never hang the view.
        const measuredNodes = targetNodes.filter((node) => {
          const internal = getInternalNode(node.id);
          return Boolean(internal?.measured.width && internal?.measured.height);
        });
        if (
          measuredNodes.length < targetNodes.length &&
          Date.now() - startedAt < 1000
        ) {
          window.requestAnimationFrame(step);
          return;
        }

        const nodesToFit =
          measuredNodes.length > 0 ? measuredNodes : targetNodes;

        void fitView({
          nodes: nodesToFit,
          padding: 0.24,
          maxZoom: 0.95,
          duration: 200,
        });
      };
      window.requestAnimationFrame(step);
    },
    [fitView, getInternalNode],
  );

  useEffect(() => {
    const flowIds = pendingFitFlowIdsRef.current;
    if (!hydrated || !flowIds || flowIds.size === 0) return;
    if (!nodes.some((node) => flowIds.has(node.data.flowId))) return;

    pendingFitFlowIdsRef.current = null;
    animateFitToFlows(flowIds);
  }, [animateFitToFlows, hydrated, nodes]);

  useEffect(() => {
    if (!saveToastIdRef.current) return;

    const timeoutId = window.setTimeout(() => {
      if (saveToastIdRef.current) {
        toast.dismiss(saveToastIdRef.current);
        saveToastIdRef.current = null;
      }
    }, 2400);

    return () => window.clearTimeout(timeoutId);
  }, []);

  // Hydrate the canvas exactly once per mount. Both the permanent workspace
  // (base page) and saved canvases load their nodes from Aurora via the
  // server component; the default image → video flow only appears on a
  // genuinely empty workspace. The once-guard means later identity changes
  // of `initialNodes` (e.g. a router refresh re-serializing props) can never
  // blow away unsaved client state.
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    const restored =
      initialNodes && initialNodes.length > 0
        ? restoreNodes(initialNodes, initialTitle)
        : null;

    setNodes(
      restored && restored.length > 0 ? restored : buildDefaultFlow(120),
    );
    setHydrated(true);
  }, [initialNodes, initialTitle, buildDefaultFlow, setNodes]);

  // Durable autosave. A debounce alone loses work: the timer resets on every
  // keystroke/drag and unmount cancels the pending callback, so the last
  // burst of edits before a refresh/navigation silently died. Instead:
  //   - mark dirty on every change after hydration,
  //   - flush on a steady 1.5s interval whenever dirty (Notion-style),
  //   - flush via sendBeacon on pagehide/visibility-hidden so closing the
  //     tab mid-edit still persists the final state.
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const saveVersionRef = useRef(Date.now());
  const skipNextAutosaveRef = useRef(true);

  const nextSaveVersion = useCallback(() => {
    saveVersionRef.current += 1;
    return saveVersionRef.current;
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      return;
    }
    dirtyRef.current = true;
  }, [nodes, hydrated]);

  // Monotonic guard: bumped by Reset. A flush that started before the bump
  // must not write its (stale) snapshot after the reset's save; the
  // interval otherwise races the direct reset save and resurrects old flows.
  const saveGenerationRef = useRef(0);

  const flushWorkspace = useCallback(async () => {
    if (!dirtyRef.current || savingRef.current) return;
    dirtyRef.current = false;
    savingRef.current = true;
    const generation = saveGenerationRef.current;
    try {
      const snapshot = snapshotNodes(nodesRef.current);
      const title = flowName(nodesRef.current);
      if (generation !== saveGenerationRef.current) {
        // Reset happened while preparing; drop this stale snapshot.
        return;
      }
      const result = canvasId
        ? await saveCanvasAction({
            id: canvasId,
            title,
            nodes: snapshot,
            saveVersion: nextSaveVersion(),
          })
        : await saveWorkspaceAction(snapshot, nextSaveVersion());
      if (
        result &&
        'ok' in result &&
        !result.ok &&
        generation === saveGenerationRef.current
      ) {
        // Try again on the next tick rather than dropping the edit.
        dirtyRef.current = true;
      }
    } catch {
      if (generation === saveGenerationRef.current) {
        dirtyRef.current = true;
      }
    } finally {
      savingRef.current = false;
    }
  }, [canvasId, saveCanvasAction, saveWorkspaceAction, nextSaveVersion]);

  useEffect(() => {
    if (!hydrated) return;

    const intervalId = window.setInterval(() => {
      void flushWorkspace();
    }, 1500);

    // Last-chance flush when the page is being hidden or closed. Server
    // actions cannot run during unload, so this posts the snapshot to the
    // owner-authenticated workspace route via sendBeacon (fire-and-forget,
    // survives the page teardown). Only the base workspace needs it; saved
    // canvas pages keep the interval + action path.
    const flushOnExit = () => {
      if (!dirtyRef.current) return;
      // Server actions cannot run during page teardown; sendBeacon survives
      // it. The route saves either the workspace row or the saved canvas.
      try {
        const title = flowName(nodesRef.current);
        const payload = JSON.stringify({
          nodes: snapshotNodes(nodesRef.current),
          saveVersion: nextSaveVersion(),
          ...(canvasId
            ? {
                canvas: {
                  id: canvasId,
                  title,
                },
              }
            : {}),
        });
        const sent = navigator.sendBeacon(
          '/api/workspace',
          new Blob([payload], { type: 'application/json' }),
        );
        if (sent) dirtyRef.current = false;
      } catch {
        // keep dirty; the next interval tick retries if the page survives
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') flushOnExit();
    };

    window.addEventListener('pagehide', flushOnExit);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('pagehide', flushOnExit);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.clearInterval(intervalId);
      // Component unmount (client-side navigation): synchronous beacon so
      // the final state is not lost with the unmounted tree.
      flushOnExit();
    };
  }, [hydrated, canvasId, flushWorkspace, nextSaveVersion]);

  const [fieldsByModel, setFieldsByModel] = useState<
    Record<string, FieldGroup | undefined>
  >({});
  const [statusByNode, setStatusByNode] = useState<
    Record<string, NodeStatus | undefined>
  >({});
  const [runningFlows, setRunningFlows] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [runIdsByFlow, setRunIdsByFlow] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );
  const [runModeByFlow, setRunModeByFlow] = useState<
    ReadonlyMap<string, RunMode>
  >(new Map());
  const [agentCheckpointByNode, setAgentCheckpointByNode] = useState<
    Record<string, AgentCheckpointState | undefined>
  >({});
  const fieldsRef = useRef<Record<string, FieldGroup>>({});
  // Active run per flow; poll callbacks check it to drop stale responses.
  const flowRunIdRef = useRef(new Map<string, string>());
  const pollTimersRef = useRef(
    new Map<string, ReturnType<typeof setTimeout>>(),
  );
  const flowWrapperRef = useRef<HTMLDivElement>(null);

  // Form controls inside a node (textarea, number input) natively capture
  // wheel events, which blocks canvas zoom when the cursor is over a card.
  // Forward those wheel events to the React Flow zoom pane so zoom stays
  // active at any cursor position.
  useEffect(() => {
    const wrapper = flowWrapperRef.current;
    if (!wrapper) return undefined;

    const handleWheel = (event: globalThis.WheelEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || !target.closest('.react-flow__node')) {
        return;
      }
      if (target.closest('.nowheel')) {
        return;
      }
      const pane = wrapper.querySelector('.react-flow__pane');
      if (!pane) {
        return;
      }
      // Stop the textarea/input from scrolling or changing value, then replay
      // the wheel on the pane so React Flow zooms.
      event.preventDefault();
      pane.dispatchEvent(
        new WheelEvent('wheel', {
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
          clientX: event.clientX,
          clientY: event.clientY,
          ctrlKey: event.ctrlKey,
          bubbles: false,
          cancelable: true,
        }),
      );
    };

    wrapper.addEventListener('wheel', handleWheel, {
      passive: false,
      capture: true,
    });
    return () => {
      wrapper.removeEventListener('wheel', handleWheel, {
        capture: true,
      } as EventListenerOptions);
    };
  }, []);

  const ensureFields = useCallback(
    async (modelId: string, role: StepRole) => {
      const key = modelSchemaCacheKey(role, modelId);
      if (!modelId || fieldsRef.current[key]) return;
      const group = await getModelFieldsAction(modelId, role).catch(() => null);
      if (!group) return;
      fieldsRef.current[key] = group;
      setFieldsByModel((prev) => ({ ...prev, [key]: group }));
    },
    [getModelFieldsAction],
  );

  useEffect(() => {
    for (const node of nodes) {
      void ensureFields(node.data.modelId, node.data.role);
    }
  }, [nodes, ensureFields]);

  // Normalize EVERY node against its model's schema whenever nodes or loaded
  // schemas change: drop values the schema does not know, and fill every
  // missing field with the model's documented default. This runs for nodes
  // added after the schema was cached too; previously those never received
  // defaults, which produced empty fields (and broken payloads) for fields
  // whose schema default is required behavior.
  useEffect(() => {
    // Never replace a node object while a node is being dragged. If a card's
    // schema finishes loading mid-drag, normalizing it here swaps the dragged
    // node out from under React Flow's drag gesture, so it never receives the
    // drag-end and the card "sticks" to the cursor. Defer until the drag ends,
    // when this effect re-runs on the drag-end node change.
    if (nodes.some((node) => node.dragging)) {
      return;
    }

    if (
      !nodes.some((node) =>
        nodeNeedsSchemaNormalization(
          node,
          fieldsRef.current[
            modelSchemaCacheKey(node.data.role, node.data.modelId)
          ],
        ),
      )
    ) {
      return;
    }

    setNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        const group =
          fieldsRef.current[
            modelSchemaCacheKey(node.data.role, node.data.modelId)
          ];
        if (!group) return node;

        if (!nodeNeedsSchemaNormalization(node, group)) return node;

        changed = true;
        return normalizeNodeValues(node, group);
      });
      return changed ? next : current;
    });
  }, [nodes, fieldsByModel, setNodes]);

  useEffect(
    () => () => {
      for (const timer of pollTimersRef.current.values()) {
        clearTimeout(timer);
      }
      pollTimersRef.current.clear();
    },
    [],
  );

  const flows = useMemo(() => flowsFrom(nodes), [nodes]);

  const flowMeta = useMemo(() => {
    const meta: Record<string, FlowMeta> = {};
    for (const [flowId, flowNodes] of flows) {
      meta[flowId] = {
        roles: new Set(flowNodes.map((node) => node.data.role)),
        autoName: flowName(nodes, flowId),
      };
    }
    return meta;
  }, [flows, nodes]);

  const runValidationByFlow = useMemo(() => {
    const result: Record<string, CanvasFlowRunValidation | undefined> = {};

    for (const [flowId, flowNodes] of flows) {
      result[flowId] = validateCanvasFlowRun({
        agentDownstreamInputs:
          (runModeByFlow.get(flowId) ?? 'self_control') !== 'self_control',
        fieldsByModel,
        flowNodes,
        models,
      });
    }

    return result;
  }, [fieldsByModel, flows, models, runModeByFlow]);

  const edges = useMemo(() => {
    // Edges referencing nodes that are not (yet) in the state are dropped by
    // ReactFlow, so info/runner ropes are only emitted once their cards exist.
    const auxIds = new Set(
      nodes.filter((node) => node.type !== 'model').map((node) => node.id),
    );
    const result: Edge[] = [];
    for (const [flowId, flowNodes] of flows) {
      const animated = runningFlows.has(flowId);
      // Flow info card leads into the first model card.
      const first = flowNodes[0];
      if (first && auxIds.has(`info_${flowId}`)) {
        result.push({
          id: `info_${flowId}->${first.id}`,
          source: `info_${flowId}`,
          target: first.id,
          animated,
        });
      }
      for (let index = 1; index < flowNodes.length; index += 1) {
        const previous = flowNodes[index - 1];
        const target = flowNodes[index];
        if (!previous || !target) continue;
        const checkpointId = checkpointNodeId(flowId, target.data.role);
        if (auxIds.has(checkpointId)) {
          result.push({
            id: `${previous.id}->${checkpointId}`,
            source: previous.id,
            target: checkpointId,
            animated,
          });
          result.push({
            id: `${checkpointId}->${target.id}`,
            source: checkpointId,
            target: target.id,
            animated,
          });
          continue;
        }
      }
      for (let index = 1; index < flowNodes.length; index += 1) {
        const source = flowNodes[index - 1];
        const target = flowNodes[index];
        if (
          source &&
          target &&
          !auxIds.has(checkpointNodeId(flowId, target.data.role))
        ) {
          result.push({
            id: `${source.id}->${target.id}`,
            source: source.id,
            target: target.id,
            animated,
          });
        }
      }
      // Last model card connects to both final utility cards.
      const last = flowNodes[flowNodes.length - 1];
      if (last && auxIds.has(`curl_${flowId}`)) {
        result.push({
          id: `${last.id}->curl_${flowId}`,
          source: last.id,
          target: `curl_${flowId}`,
          animated,
        });
      }
      if (last && auxIds.has(`runner_${flowId}`)) {
        result.push({
          id: `${last.id}->runner_${flowId}`,
          source: last.id,
          target: `runner_${flowId}`,
          animated,
        });
      }
    }
    return result;
  }, [nodes, flows, runningFlows]);

  // Aux cards must be REAL state nodes: ReactFlow v12 delivers measured
  // node dimensions through onNodesChange, and nodes absent from the managed
  // state never receive them, so they can stay hidden in production builds.
  // Reconcile one API and one runner per flow into the state. They are normal,
  // draggable cards (ReactFlow disables pointer-events on fully
  // non-interactive nodes, which made the run buttons unclickable), so they
  // just cannot be deleted, so every flow always ends with API + runner. New
  // aux cards spawn separated in the final utility column; existing ones keep
  // whatever position the user dragged them to.
  useEffect(() => {
    // Same drag-safety guard as the schema-normalize effect: a relayout or node
    // replacement mid-drag can strand the dragged card under the cursor.
    if (nodes.some((node) => node.dragging)) return;

    if (!needsFlowAuxReconcile(nodes, runModeByFlow)) return;

    setNodes((current) => {
      const modelNodes = current.filter((node) => node.type === 'model');
      const auxById = new Map(
        current
          .filter((node) => node.type !== 'model')
          .map((node) => [node.id, node]),
      );
      const currentFlows = flowsFrom(modelNodes);
      const next: FlowNode[] = [...modelNodes];
      let matched = 0;
      let changed = false;

      for (const [flowId, flowNodes] of currentFlows) {
        const first = flowNodes[0];
        const last = flowNodes[flowNodes.length - 1];
        if (!first || !last) continue;

        // Flow info card: persists the editable flow name. If a malformed
        // stored flow is missing one, create it.
        const infoId = `info_${flowId}`;
        const existingInfo = auxById.get(infoId);
        if (existingInfo) {
          matched += 1;
          next.push(existingInfo);
        } else {
          changed = true;
          next.push({
            id: infoId,
            type: 'info',
            position: {
              x: first.position.x - INFO_COL_W,
              y: first.position.y,
            },
            data: {
              role: 'image',
              modelId: '',
              flowId,
              values: {
                name:
                  (typeof initialTitle === 'string' &&
                    normalizeCanvasTitle(initialTitle)) ||
                  createDefaultCanvasName(),
              },
            },
          });
        }

        if ((runModeByFlow.get(flowId) ?? 'self_control') !== 'self_control') {
          for (let index = 1; index < flowNodes.length; index += 1) {
            const target = flowNodes[index];
            if (!target) continue;
            const checkpointId = checkpointNodeId(flowId, target.data.role);
            const existingCheckpoint = auxById.get(checkpointId);
            if (existingCheckpoint) {
              matched += 1;
              const syncedCheckpoint =
                existingCheckpoint.data.role === target.data.role &&
                existingCheckpoint.data.modelId === target.data.modelId &&
                existingCheckpoint.data.flowId === flowId
                  ? existingCheckpoint
                  : {
                      ...existingCheckpoint,
                      data: {
                        ...existingCheckpoint.data,
                        role: target.data.role,
                        modelId: target.data.modelId,
                        flowId,
                      },
                    };
              if (syncedCheckpoint !== existingCheckpoint) changed = true;
              next.push(syncedCheckpoint);
            } else {
              changed = true;
              next.push({
                id: checkpointId,
                type: 'checkpoint',
                position: target.position,
                data: {
                  role: target.data.role,
                  modelId: target.data.modelId,
                  flowId,
                  values: {},
                },
              });
            }
          }
        }

        const curlId = `curl_${flowId}`;
        const existingCurl = auxById.get(curlId);
        if (existingCurl) {
          matched += 1;
          next.push(existingCurl);
        } else {
          changed = true;
          next.push({
            id: curlId,
            type: 'curl',
            position: utilityCardPosition(last, 'api'),
            data: { role: 'image', modelId: '', flowId, values: {} },
          });
        }

        const runnerId = `runner_${flowId}`;
        const existingRunner = auxById.get(runnerId);
        if (existingRunner) {
          matched += 1;
          next.push(existingRunner);
        } else {
          changed = true;
          next.push({
            id: runnerId,
            type: 'runner',
            position: utilityCardPosition(last, 'runner'),
            data: { role: 'image', modelId: '', flowId, values: {} },
          });
        }
      }

      // Orphaned info/curl/runner cards (their flow was removed) are dropped.
      if (matched !== auxById.size) changed = true;

      return changed ? relayoutFlows(next, currentFlows.keys()) : current;
    });
  }, [nodes, initialTitle, runModeByFlow, setNodes]);

  const updateModel = useCallback(
    (id: string, modelId: string) => {
      const nextModel = models.find((candidate) => candidate.id === modelId);
      if (!nextModel?.available) return;

      setNodes((current) =>
        current.map((node) => {
          if (node.id !== id) return node;
          const carried: Record<string, FieldValue> = {};
          for (const key of [
            'generation_prompt',
            'generation_input_image_file',
          ]) {
            const value = node.data.values[key];
            if (typeof value === 'string' && value) {
              carried[key] = value;
            }
          }
          return { ...node, data: { ...node.data, modelId, values: carried } };
        }),
      );
      const node = nodes.find((candidate) => candidate.id === id);
      void ensureFields(modelId, node?.data.role ?? 'image');
    },
    [models, nodes, setNodes, ensureFields],
  );

  const updateValue = useCallback(
    (id: string, name: string, value: FieldValue) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  values: { ...node.data.values, [name]: value },
                },
              }
            : node,
        ),
      );
    },
    [setNodes],
  );

  const moveFlowBy = useCallback(
    (flowId: string, delta: { x: number; y: number }) => {
      setNodes((current) =>
        current.map((node) =>
          node.data.flowId === flowId
            ? {
                ...node,
                position: {
                  x: node.position.x + delta.x,
                  y: node.position.y + delta.y,
                },
              }
            : node,
        ),
      );
    },
    [setNodes],
  );

  const removeNode = useCallback(
    (id: string) =>
      setNodes((current) => {
        const removed = current.find((node) => node.id === id);
        const next = current.filter((node) => node.id !== id);
        return removed ? relayoutFlow(next, removed.data.flowId) : next;
      }),
    [setNodes],
  );

  // Remove an entire flow (its model cards + runner). Any in-flight run for
  // the flow stops being tracked here; the run itself stays in Aurora.
  const removeFlow = useCallback(
    async (flowId: string) => {
      const confirmed = await confirm({
        title: 'Remove this flow?',
        description:
          'This removes the flow and its cards from the canvas. Saved canvases in your Library are not affected.',
        confirmLabel: 'Remove flow',
        destructive: true,
      });
      if (!confirmed) return;

      const timer = pollTimersRef.current.get(flowId);
      if (timer) clearTimeout(timer);
      pollTimersRef.current.delete(flowId);
      flowRunIdRef.current.delete(flowId);
      setRunIdsByFlow((prev) => {
        if (!prev.has(flowId)) return prev;
        const next = new Map(prev);
        next.delete(flowId);
        return next;
      });
      setRunningFlows((prev) => {
        if (!prev.has(flowId)) return prev;
        const next = new Set(prev);
        next.delete(flowId);
        return next;
      });
      // The runner card carries the same flowId, so it is removed with the
      // flow's model cards.
      setNodes((current) => {
        const next = current.filter((node) => node.data.flowId !== flowId);
        queueFitViewForFlows([
          ...new Set(next.map((node) => node.data.flowId)),
        ]);
        return next;
      });
    },
    [confirm, setNodes, queueFitViewForFlows],
  );

  const addNodeToFlow = useCallback(
    (flowId: string, role: StepRole) => {
      const model = firstAvailableModelForRole(models, role);
      if (!model) return;
      setNodes((current) => {
        const flowNodes = current.filter(
          (node) => node.type === 'model' && node.data.flowId === flowId,
        );
        if (
          flowNodes.length === 0 ||
          flowNodes.some((node) => node.data.role === role)
        ) {
          return current;
        }
        const next: FlowNode[] = [
          ...current,
          {
            id: genId(role),
            type: 'model',
            position: { x: 0, y: flowNodes[0]!.position.y },
            data: { role, modelId: model.id, flowId, values: {} },
          },
        ];
        queueFitViewForFlows([flowId]);
        // Slot the new card into its step position within this flow only.
        return relayoutFlow(next, flowId);
      });
      void ensureFields(model.id, role);
    },
    [models, setNodes, ensureFields, queueFitViewForFlows],
  );

  const duplicateFlow = useCallback(
    (flowId: string) => {
      if (canvasId) return;

      // Compute the copy OUTSIDE the updater so the generated flow id stays
      // stable under React Strict Mode's double-invoked updaters and the queued
      // fit reliably targets the flow that actually gets committed.
      const current = nodesRef.current;
      const sourceModels = current
        .filter((node) => node.type === 'model' && node.data.flowId === flowId)
        .sort((a, b) => ROLE_RANK[a.data.role] - ROLE_RANK[b.data.role]);

      if (sourceModels.length === 0) return;

      const sourceInfo = current.find(
        (node) => node.type === 'info' && node.data.flowId === flowId,
      );
      const newFlowId = genFlowId();
      const rowY = nextFlowY(current);
      const infoValues: Record<string, FieldValue> = {
        ...(sourceInfo?.data.values ?? {}),
        name: duplicateFlowName(flowName(current, flowId)),
      };

      const copiedNodes: FlowNode[] = [
        {
          id: `info_${newFlowId}`,
          type: 'info',
          position: { x: FLOW_X, y: rowY },
          data: {
            role: 'image',
            modelId: '',
            flowId: newFlowId,
            values: infoValues,
          },
        },
        ...sourceModels.map((node, index) => ({
          id: genId(node.data.role),
          type: 'model' as const,
          position: {
            x: FLOW_X + INFO_COL_W + index * FLOW_COL_W,
            y: rowY,
          },
          data: {
            ...node.data,
            flowId: newFlowId,
            values: { ...node.data.values },
          },
        })),
      ];

      setNodes((prev) => [...prev, ...copiedNodes]);
      queueFitViewForFlows([newFlowId]);
    },
    [canvasId, setNodes, queueFitViewForFlows],
  );

  const addFlow = useCallback(() => {
    // Build the new flow OUTSIDE the updater: React Strict Mode double-invokes
    // setState updaters in dev, so generating a flow id inside would mint two
    // different ids and the queued fit could target the discarded one.
    const nextFlow = buildDefaultFlow(nextFlowY(nodesRef.current));
    const flowId = nextFlow[0]?.data.flowId;
    setNodes((current) => [...current, ...nextFlow]);
    if (flowId) queueFitViewForFlows([flowId]);
  }, [setNodes, buildDefaultFlow, queueFitViewForFlows]);

  const resetCanvas = useCallback(async () => {
    const confirmed = await confirm({
      title: 'Reset the canvas?',
      description:
        'This removes every flow from your workspace. Saved canvases in your Library are not affected.',
      confirmLabel: 'Reset canvas',
      destructive: true,
    });
    if (!confirmed) return;

    for (const timer of pollTimersRef.current.values()) {
      clearTimeout(timer);
    }
    pollTimersRef.current.clear();
    flowRunIdRef.current.clear();
    setRunIdsByFlow(new Map());
    setRunningFlows(new Set());
    setStatusByNode({});
    setAgentCheckpointByNode({});

    const fresh = buildDefaultFlow(120);
    const freshFlowId = fresh[0]?.data.flowId;
    if (freshFlowId) queueFitViewForFlows([freshFlowId]);
    setNodes(fresh);
    // Invalidate any in-flight autosave so a stale pre-reset snapshot can
    // never land after this save and resurrect the old flows.
    saveGenerationRef.current += 1;
    dirtyRef.current = false;
    const resetSaveVersion = nextSaveVersion();
    const persistReset = async (attempt = 0): Promise<void> => {
      // Let any in-flight autosave land first: the reset save must be the
      // LAST write, otherwise a slow pre-reset request can overwrite it.
      for (let waited = 0; savingRef.current && waited < 50; waited += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const result = await saveWorkspaceAction(
        snapshotNodes(fresh),
        resetSaveVersion,
      ).catch(() => ({
        ok: false as const,
        error: 'Resetting the canvas failed.',
      }));
      if (!result.ok) {
        if (attempt < 3) {
          window.setTimeout(() => void persistReset(attempt + 1), 1200);
        } else {
          toast.error(
            'Resetting the canvas failed to save. Check the connection and try again.',
          );
        }
      }
    };
    void persistReset();
  }, [
    confirm,
    buildDefaultFlow,
    setNodes,
    saveWorkspaceAction,
    nextSaveVersion,
    queueFitViewForFlows,
  ]);

  const applyRunToFlow = useCallback((flowId: string, run: RunJson) => {
    runSnapshotCache.set(run.id, run);
    const restoredMode = runModeFromExecution(run);
    if (restoredMode) {
      setRunModeByFlow((prev) => {
        if (prev.get(flowId) === restoredMode) return prev;
        const next = new Map(prev);
        next.set(flowId, restoredMode);
        return next;
      });
    }

    // Map run steps (keyed by role) onto this flow's MODEL nodes. Info and
    // runner cards carry a dummy role and must never receive step status.
    const nodeByRole = new Map<string, string>();
    for (const node of nodesRef.current) {
      if (node.type === 'model' && node.data.flowId === flowId) {
        nodeByRole.set(node.data.role, node.id);
      }
    }
    setStatusByNode((prev) => {
      const next = { ...prev };
      for (const step of run.steps ?? []) {
        const nodeId = nodeByRole.get(step.step_key);
        if (nodeId) {
          const outputs = (step.generation_output_file ?? []).filter(
            (outputFile) => outputFile.trim().length > 0,
          );
          const startedAtMs = step.started_at
            ? Date.parse(step.started_at)
            : NaN;
          next[nodeId] = {
            status: step.status,
            outputs: outputs.length > 0 ? outputs : undefined,
            startedAt: Number.isFinite(startedAtMs) ? startedAtMs : undefined,
          };
        }
      }
      return next;
    });
    setAgentCheckpointByNode((prev) => {
      const next = { ...prev };
      for (const role of nodeByRole.keys()) {
        delete next[checkpointNodeId(flowId, role as StepRole)];
      }

      for (const checkpoint of run.agent_checkpoints ?? []) {
        if (nodeByRole.has(checkpoint.step_key)) {
          next[checkpointNodeId(flowId, checkpoint.step_key as StepRole)] = {
            checkpoint,
            runId: run.id,
          };
        }
      }

      return next;
    });
    setNodes((current) => {
      let changed = false;
      const selectedParamsByRole = new Map<string, string>();

      for (const checkpoint of run.agent_checkpoints ?? []) {
        if (nodeByRole.has(checkpoint.step_key)) {
          const selectedParams = checkpoint.selected_params ?? {};
          const prompt = checkpoint.selected_prompt?.trim();
          const selectedParamsPrompt =
            typeof selectedParams.generation_prompt === 'string' &&
            selectedParams.generation_prompt.trim().length > 0
              ? selectedParams.generation_prompt
              : null;
          selectedParamsByRole.set(
            checkpoint.step_key,
            JSON.stringify({
              ...selectedParams,
              ...(!selectedParamsPrompt && prompt
                ? { generation_prompt: prompt }
                : {}),
            }),
          );
        }
      }

      if (selectedParamsByRole.size === 0) {
        return current;
      }

      const next = current.map((node) => {
        if (node.type !== 'model' || node.data.flowId !== flowId) {
          return node;
        }

        const serializedParams = selectedParamsByRole.get(node.data.role);
        if (!serializedParams) {
          return node;
        }

        const params = JSON.parse(serializedParams) as Record<string, unknown>;
        const values = Object.fromEntries(
          Object.entries(params)
            .map(([key, value]) => [key, stringFieldValue(value)] as const)
            .filter(
              (entry): entry is readonly [string, FieldValue] =>
                entry[1] !== null,
            ),
        );

        if (
          Object.entries(values).every(
            ([key, value]) => node.data.values[key] === value,
          )
        ) {
          return node;
        }

        changed = true;
        return {
          ...node,
          data: {
            ...node.data,
            values: {
              ...node.data.values,
              ...values,
            },
          },
        };
      });

      return changed ? next : current;
    });
  }, []);

  function runModeFromExecution(run: RunJson): RunMode | null {
    if (run.execution?.type !== 'chain_agent') {
      return null;
    }

    return run.execution.mode === 'autopilot'
      ? 'agent_autopilot'
      : 'agent_copilot';
  }

  const finishFlow = useCallback((flowId: string) => {
    flowRunIdRef.current.delete(flowId);
    const timer = pollTimersRef.current.get(flowId);
    if (timer) clearTimeout(timer);
    pollTimersRef.current.delete(flowId);
    setRunningFlows((prev) => {
      const next = new Set(prev);
      next.delete(flowId);
      return next;
    });
  }, []);

  const pollFlow = useCallback(
    async (
      flowId: string,
      runId: string,
      failures = 0,
      notifyFailure = true,
    ) => {
      const run = (await getRunAction(runId).catch(
        () => null,
      )) as RunJson | null;
      if (flowRunIdRef.current.get(flowId) !== runId) return;
      if (!run) {
        // Transient fetch/server hiccup: keep the run alive and retry with
        // backoff instead of silently abandoning an in-flight chain. The run
        // itself is safe in Aurora either way.
        if (failures >= 8) {
          finishFlow(flowId);
          toast.error(
            'Lost connection while tracking the run. Reload to resume. The run keeps processing in the background.',
          );
          return;
        }
        pollTimersRef.current.set(
          flowId,
          setTimeout(
            () => void pollFlow(flowId, runId, failures + 1, notifyFailure),
            Math.min(1500 * 2 ** failures, 15_000),
          ),
        );
        return;
      }
      applyRunToFlow(flowId, run);
      if (TERMINAL.has(run.status)) {
        finishFlow(flowId);
        if (run.status === 'failed' && notifyFailure) {
          toast.error(runErrorMessage(run));
        }
        return;
      }
      pollTimersRef.current.set(
        flowId,
        setTimeout(() => void pollFlow(flowId, runId, 0, notifyFailure), 1500),
      );
    },
    [getRunAction, applyRunToFlow, finishFlow],
  );

  // When a hidden tab becomes visible again, repaint every active flow
  // immediately instead of waiting for the next scheduled tick.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      for (const [flowId, runId] of flowRunIdRef.current) {
        const timer = pollTimersRef.current.get(flowId);
        if (timer) clearTimeout(timer);
        void pollFlow(flowId, runId);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [pollFlow]);

  // Resume run tracking after a reload or in another tab:
  //   - workspace: every flow's recorded run (in-progress runs continue
  //     live; finished runs repaint their results once).
  //   - saved canvas: its linked run.
  const resumedRunRef = useRef(false);

  useEffect(() => {
    if (!hydrated || resumedRunRef.current) return;
    resumedRunRef.current = true;

    if (canvasId && initialRunId) {
      const firstFlowId = nodesRef.current[0]?.data.flowId;
      if (!firstFlowId) return;
      flowRunIdRef.current.set(firstFlowId, initialRunId);
      setRunIdsByFlow((prev) => new Map(prev).set(firstFlowId, initialRunId));
      setRunningFlows((prev) => new Set(prev).add(firstFlowId));
      // Seed mode/status/checkpoints from the last-known snapshot so a
      // navigation-back repaints the agent runner and checkpoint cards
      // instantly instead of waiting for the first poll round-trip.
      const cached = runSnapshotCache.get(initialRunId);
      if (cached) applyRunToFlow(firstFlowId, cached);
      // notifyFailure=false: repainting an old failed run on page load should
      // not re-toast an error the user already saw.
      void pollFlow(firstFlowId, initialRunId, 0, false);
      return;
    }

    if (!canvasId && initialFlowRuns) {
      const liveFlowIds = new Set(
        nodesRef.current.map((node) => node.data.flowId),
      );
      for (const [flowId, runId] of Object.entries(initialFlowRuns)) {
        if (!liveFlowIds.has(flowId)) continue;
        flowRunIdRef.current.set(flowId, runId);
        setRunIdsByFlow((prev) => new Map(prev).set(flowId, runId));
        setRunningFlows((prev) => new Set(prev).add(flowId));
        const cached = runSnapshotCache.get(runId);
        if (cached) applyRunToFlow(flowId, cached);
        void pollFlow(flowId, runId, 0, false);
      }
    }
  }, [
    hydrated,
    canvasId,
    initialRunId,
    initialFlowRuns,
    pollFlow,
    applyRunToFlow,
  ]);

  const runFlow = useCallback(
    async (flowId: string, save: boolean) => {
      let flowNodes: FlowNode[];
      let input: Record<string, unknown>;
      const runMode = runModeByFlow.get(flowId) ?? 'self_control';
      const agentDownstreamInputs = runMode !== 'self_control';
      let nodesForRun = nodesRef.current;

      if (agentDownstreamInputs) {
        const reset = resetAgentPlannedFlowValues(
          nodesForRun,
          flowId,
          fieldsRef.current,
        );

        if (reset.changed) {
          nodesForRun = reset.nodes;
          nodesRef.current = reset.nodes;
          setNodes(reset.nodes);
          dirtyRef.current = true;
        }
      }

      try {
        const built = buildFlowRunInput(
          nodesForRun,
          flowId,
          fieldsRef.current,
          { agentDownstreamInputs },
        );
        flowNodes = built.flowNodes;
        input = built.input;
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Check the model fields.',
        );
        return;
      }
      const runValidation = validateCanvasFlowRun({
        agentDownstreamInputs,
        fieldsByModel: fieldsRef.current,
        flowNodes,
        models,
      });

      if (!runValidation.ok) {
        toast.error(runValidation.reason);
        return;
      }

      // Mark running and clear this flow's previous statuses only.
      const existingTimer = pollTimersRef.current.get(flowId);
      if (existingTimer) clearTimeout(existingTimer);
      setRunningFlows((prev) => new Set(prev).add(flowId));
      setStatusByNode((prev) => {
        const next = { ...prev };
        for (const node of flowNodes) {
          delete next[node.id];
        }
        return next;
      });
      setAgentCheckpointByNode((prev) => {
        const next = { ...prev };
        for (const node of flowNodes) {
          delete next[checkpointNodeId(flowId, node.data.role)];
        }
        return next;
      });

      let savedCanvasId: string | undefined;
      const workingNodes = nodesForRun;

      if (save) {
        savedCanvasId = createCanvasId();
      }

      // A run should never depend on the autosave interval having fired.
      // Persist the workspace row first so `recordWorkspaceFlowRun()` can
      // attach the run and reload/logout can resume it reliably.
      if (!canvasId) {
        for (let waited = 0; savingRef.current && waited < 50; waited += 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        const workspaceSave = await saveWorkspaceAction(
          snapshotNodes(workingNodes),
          nextSaveVersion(),
        ).catch(() => ({
          ok: false as const,
          error: 'Saving the workspace failed.',
        }));

        if (!workspaceSave.ok) {
          finishFlow(flowId);
          dirtyRef.current = true;
          toast.error(workspaceSave.error);
          return;
        }
      }

      const infoNode = workingNodes.find(
        (node) => node.id === `info_${flowId}`,
      );
      // model_context (Creator Brief) is agent-only; a self_control run never
      // reads it, so do not send it for self_control.
      const modelContext =
        runMode !== 'self_control' &&
        typeof infoNode?.data.values.model_context === 'string'
          ? infoNode.data.values.model_context.trim()
          : '';

      const result = await runChainAction(input, {
        execution: runModeExecution(runMode),
        ...(modelContext ? { metadata: { model_context: modelContext } } : {}),
        ...(!canvasId ? { flowId } : {}),
      }).catch(() => null);
      if (!result || !result.ok) {
        finishFlow(flowId);
        toast.error(
          result && !result.ok ? result.error : 'Run failed to start.',
        );
        return;
      }
      const run = result.run as RunJson;

      // Surface the run id immediately - before the awaited Library save below -
      // so the API card and resume pointer are realtime and the user can debug a
      // run the moment it exists.
      flowRunIdRef.current.set(flowId, run.id);
      setRunIdsByFlow((prev) => new Map(prev).set(flowId, run.id));

      // "RUN + SAVE": only create the Library card after a run id exists, so
      // navigating away cannot leave a saved canvas that says "not run yet".
      // Every publish (from the workspace or from a saved canvas page)
      // mints a fresh Library card (new canvas id + run id); existing cards are
      // never overwritten. The flow name rides along as-is, so owners rename
      // cards directly in the Library.
      if (save) {
        if (!savedCanvasId) {
          toast.error('Saving the canvas failed.');
        } else {
          const title = flowName(nodesRef.current, flowId);
          const saveResult = await saveCanvasAction({
            id: savedCanvasId,
            runId: run.id,
            title,
            nodes: snapshotNodes([
              ...workingNodes.filter((node) => node.id === `info_${flowId}`),
              ...flowNodes,
            ]),
            saveVersion: nextSaveVersion(),
          }).catch(() => ({
            ok: false as const,
            error: 'Saving the canvas failed.',
          }));

          if (!saveResult.ok) {
            toast.error(
              `Run started, but saving it to the Library failed. ${saveResult.error}`,
            );
          } else {
            saveToastIdRef.current = toast.info(
              'The canvas flow saved to your Library (results attach to it automatically)',
              { duration: 2400 },
            );
          }
        }
      }

      flowRunIdRef.current.set(flowId, run.id);
      // Record the run on the workspace so a reload resumes tracking it.
      if (!canvasId) {
        const recorded = await recordFlowRunAction(flowId, run.id).catch(
          () => false,
        );

        if (!recorded) {
          toast.error(
            'Run started, but saving its resume pointer failed. Keep this tab open until it finishes.',
          );
        }
      }
      applyRunToFlow(flowId, run);
      if (TERMINAL.has(run.status)) {
        finishFlow(flowId);
        if (run.status === 'failed') {
          toast.error(runErrorMessage(run));
        }
        return;
      }
      pollTimersRef.current.set(
        flowId,
        setTimeout(() => void pollFlow(flowId, run.id), 1200),
      );
    },
    [
      canvasId,
      models,
      runModeByFlow,
      runChainAction,
      saveCanvasAction,
      recordFlowRunAction,
      applyRunToFlow,
      pollFlow,
      finishFlow,
    ],
  );

  const cancelFlow = useCallback(
    (flowId: string) => {
      // Cancel the run server-side FIRST: without this the chain keeps
      // processing in Aurora (spending provider credits) and a reload would
      // resume tracking the "canceled" run.
      const runId = flowRunIdRef.current.get(flowId);
      finishFlow(flowId);
      if (!runId) return;
      void cancelRunAction(runId)
        .then((run) => {
          if (run) {
            // Paint the canceled/skipped statuses, unless the user already
            // started a NEW run for this flow while the cancel was in flight.
            if (!flowRunIdRef.current.has(flowId)) {
              applyRunToFlow(flowId, run as RunJson);
            }
          } else {
            toast.error(
              'Stopping the run failed. It may finish in the background.',
            );
          }
        })
        .catch(() => undefined);
    },
    [finishFlow, cancelRunAction, applyRunToFlow],
  );

  const setRunMode = useCallback((flowId: string, mode: RunMode) => {
    setRunModeByFlow((prev) => {
      const next = new Map(prev);
      next.set(flowId, mode);
      return next;
    });
  }, []);

  const continueAgentCheckpoint = useCallback(
    async (
      flowId: string,
      role: StepRole,
      checkpointId: string,
      selectedPrompt: string,
      selectedParams: Record<string, unknown>,
      modelValues: Record<string, FieldValue>,
    ) => {
      // Reflect the approved values on this step's model card immediately, so it
      // updates the moment Approve is clicked rather than after the result lands.
      setNodes((current) =>
        current.map((node) =>
          node.type === 'model' &&
          node.data.flowId === flowId &&
          node.data.role === role
            ? {
                ...node,
                data: {
                  ...node.data,
                  values: { ...node.data.values, ...modelValues },
                },
              }
            : node,
        ),
      );

      const runId = flowRunIdRef.current.get(flowId);
      if (!runId) {
        toast.error('This Agentic Workflow run is no longer being tracked.');
        return;
      }

      const result = await props
        .continueAgentAction(runId, {
          checkpointId,
          selectedParams,
          selectedPrompt,
        })
        .catch(() => null);

      if (!result || !result.ok) {
        toast.error(
          result && !result.ok ? result.error : 'Continuing the run failed.',
        );
        return;
      }

      const run = result.run as RunJson;
      applyRunToFlow(flowId, run);
      if (TERMINAL.has(run.status)) {
        finishFlow(flowId);
        return;
      }
      pollTimersRef.current.set(
        flowId,
        setTimeout(() => void pollFlow(flowId, run.id), 1200),
      );
    },
    [props, applyRunToFlow, finishFlow, pollFlow, setNodes],
  );

  const contextValue = useMemo<CanvasContextValue>(
    () => ({
      byokProviders,
      models,
      fieldsByModel,
      runValidationByFlow,
      statusByNode,
      agentCheckpointByNode,
      runningFlowIds: runningFlows,
      runModeByFlow,
      runIdsByFlow,
      flowMeta,
      flowCount: flows.size,
      isSavedCanvas: Boolean(canvasId),
      providerMode,
      updateModel,
      updateValue,
      moveFlowBy,
      removeNode,
      removeFlow,
      duplicateFlow,
      createFlowCurl: (flowId: string) => {
        try {
          const input = buildFlowCurlInput(
            nodesRef.current,
            flowId,
            fieldsRef.current,
          );
          // Mirror the run the canvas actually launches: the selected run mode
          // (self_control vs chain_agent copilot/autopilot) and the owner's
          // model_context/Creator Brief. Without these the copied curl would
          // silently run as a default self_control run with no brief.
          const runMode = runModeByFlow.get(flowId) ?? 'self_control';
          const infoNode = nodesRef.current.find(
            (node) => node.id === `info_${flowId}`,
          );
          // model_context (Creator Brief) is agent-only; a self_control run
          // never reads it, so it must not appear in a self_control curl.
          const modelContext =
            runMode !== 'self_control' &&
            typeof infoNode?.data.values.model_context === 'string'
              ? infoNode.data.values.model_context.trim()
              : '';
          return createNodeCurl(input, {
            execution: runModeExecution(runMode),
            ...(modelContext
              ? { metadata: { model_context: modelContext } }
              : {}),
          });
        } catch {
          return null;
        }
      },
      renameCanvas: (flowId: string, title: string) => {
        if (canvasId) {
          void renameCanvasAction(canvasId, title).catch(() => undefined);
        }
      },
      addNodeToFlow,
      continueAgentCheckpoint,
      runFlow: (flowId: string, save: boolean) => void runFlow(flowId, save),
      setRunMode,
      cancelFlow,
    }),
    [
      byokProviders,
      models,
      fieldsByModel,
      runValidationByFlow,
      statusByNode,
      agentCheckpointByNode,
      runningFlows,
      runModeByFlow,
      runIdsByFlow,
      flowMeta,
      flows,
      canvasId,
      providerMode,
      updateModel,
      updateValue,
      moveFlowBy,
      removeNode,
      removeFlow,
      duplicateFlow,
      renameCanvasAction,
      addNodeToFlow,
      continueAgentCheckpoint,
      runFlow,
      setRunMode,
      cancelFlow,
    ],
  );

  return (
    <div className="flex h-full flex-col">
      {confirmDialog}
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-sidebar px-4">
        <div className="flex items-center gap-1.5">
          <Button size="sm" disabled={!hydrated} onClick={addFlow}>
            <FontAwesomeIcon icon="diagram-project" />
            Add canvas flow
          </Button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!canvasId ? (
            <Button
              variant="outline"
              size="sm"
              disabled={!hydrated || runningFlows.size > 0}
              onClick={resetCanvas}
            >
              <FontAwesomeIcon icon="rotate-left" />
              Reset canvas
            </Button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 bg-[#18181b]" ref={flowWrapperRef}>
        <CanvasContext.Provider value={contextValue}>
          <ReactFlow
            className="bg-[#18181b]"
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            nodeTypes={nodeTypes}
            colorMode="dark"
            nodesConnectable={false}
            edgesFocusable={false}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
            minZoom={0.3}
            maxZoom={1.5}
            zoomOnScroll
            zoomOnPinch
            panOnScroll={false}
            preventScrolling
            defaultEdgeOptions={{
              style: { stroke: '#475067', strokeWidth: 2 },
            }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={22}
              size={1}
              color="#2a313d"
            />
            <Controls
              showInteractive={false}
              fitViewOptions={{ padding: 0.24, maxZoom: 0.95, duration: 400 }}
            />
            <MiniMap
              pannable
              zoomable
              onClick={(_event, position) => {
                void setCenter(position.x, position.y, {
                  zoom: getZoom(),
                  duration: 400,
                });
              }}
              nodeColor={(node) =>
                node.type === 'runner' || node.type === 'info'
                  ? RUNNER_COLOR
                  : (ROLE_COLOR[(node.data as NodeData).role] ?? '#94a3b8')
              }
              nodeStrokeColor="#0a0c10"
              maskColor="rgba(10, 12, 16, 0.6)"
              style={{
                backgroundColor: '#0a0c10',
                border: '1px solid #29303d',
              }}
            />
          </ReactFlow>
        </CanvasContext.Provider>
      </div>
    </div>
  );
}

export function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
