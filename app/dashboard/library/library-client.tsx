'use client';

import Link from 'next/link';
import type { ComponentType, SVGProps } from 'react';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from 'react';
import { toast } from 'sonner';

import { FontAwesomeIcon } from '@/components/icons/font-awesome-icon';
import {
  InlineAlibabaCloud as InlineInferenceAlibabaCloud,
  InlineBlackForestLabsLight as InlineInferenceBlackForestLabsLight,
  InlineBytePlus as InlineInferenceBytePlus,
  InlineGoogle as InlineInferenceGoogle,
  InlineOpenAILight as InlineInferenceOpenAILight,
  InlineRunwayLight as InlineInferenceRunwayLight,
} from '@/components/icons/inline-inference';
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
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  MAX_CANVAS_TITLE_LENGTH,
  normalizeCanvasTitle,
} from '@/lib/canvas/names';
import { formatPublicModelName } from '@/lib/models/display';
import { cn } from '@/lib/utils';
import type { CanvasLibraryItem } from '@/lib/canvas/canvas-store';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

type ModelIconKey =
  | 'bfl'
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

type BadgeInfo = {
  Icon: IconComponent;
  key: string;
  label: string;
};

const MODEL_ICONS: Record<ModelIconKey, IconComponent> = {
  bfl: InlineModelBlackForestLabsLight,
  bytedance: InlineModelByteDance,
  google: InlineModelGoogle,
  happyhorse: InlineModelHappyHorseLight,
  openai: InlineModelOpenAILight,
  qwen: InlineModelQwen,
  runway: InlineModelRunwayLight,
  wan: InlineModelWan,
  z: InlineModelZImage,
};

const INFERENCE_ICONS: Record<InferenceIconKey, IconComponent> = {
  'alibaba-cloud': InlineInferenceAlibabaCloud,
  'black-forest-labs': InlineInferenceBlackForestLabsLight,
  byteplus: InlineInferenceBytePlus,
  google: InlineInferenceGoogle,
  openai: InlineInferenceOpenAILight,
  runway: InlineInferenceRunwayLight,
};

const INFERENCE_LABELS: Record<InferenceIconKey, string> = {
  'alibaba-cloud': 'Alibaba Cloud',
  'black-forest-labs': 'Black Forest Labs',
  byteplus: 'BytePlus',
  google: 'Google',
  openai: 'OpenAI',
  runway: 'Runway',
};

type LibraryClientProps = {
  canvases: CanvasLibraryItem[];
  loadFailed: boolean;
  deleteCanvasAction: (
    canvasId: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  renameCanvasAction: (
    canvasId: string,
    title: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
};

export function LibraryClient({
  canvases: initialCanvases,
  loadFailed,
  deleteCanvasAction,
  renameCanvasAction,
}: LibraryClientProps) {
  const [canvases, setCanvases] = useState(initialCanvases);
  const [confirm, confirmDialog] = useConfirm();

  useEffect(() => {
    if (loadFailed) {
      toast.error(
        'Loading saved canvases failed. Check the Aurora connection and refresh.',
      );
    }
  }, [loadFailed]);

  const handleError = (message: string | null) => {
    if (message) toast.error(message);
  };

  const handleDeleted = (canvasId: string) => {
    setCanvases((current) =>
      current.filter((canvas) => canvas.id !== canvasId),
    );
  };

  const handleRenamed = (canvasId: string, title: string) => {
    setCanvases((current) =>
      current.map((canvas) =>
        canvas.id === canvasId ? { ...canvas, title } : canvas,
      ),
    );
  };

  return (
    <main className="flex h-full flex-col">
      {confirmDialog}
      <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-sidebar px-4">
        <Button asChild size="sm">
          <Link href="/dashboard/chain">
            <FontAwesomeIcon icon="diagram-project" />
            New canvas
          </Link>
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {canvases.length === 0 ? (
          <Card>
            <CardContent className="p-5">
              <p className="text-sm leading-6 text-muted-foreground">
                Save a canvas to make it available here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {canvases.map((canvas) => (
              <CanvasCard
                canvas={canvas}
                confirm={confirm}
                deleteCanvasAction={deleteCanvasAction}
                renameCanvasAction={renameCanvasAction}
                key={canvas.id}
                onDeleted={handleDeleted}
                onRenamed={handleRenamed}
                onError={handleError}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function CanvasCard({
  canvas,
  confirm,
  deleteCanvasAction,
  renameCanvasAction,
  onDeleted,
  onRenamed,
  onError,
}: {
  canvas: CanvasLibraryItem;
  confirm: ReturnType<typeof useConfirm>[0];
  deleteCanvasAction: LibraryClientProps['deleteCanvasAction'];
  renameCanvasAction: LibraryClientProps['renameCanvasAction'];
  onDeleted: (canvasId: string) => void;
  onRenamed: (canvasId: string, title: string) => void;
  onError: (message: string | null) => void;
}) {
  const modelBadges = useMemo(
    () => modelBadgeInfo(canvas.modelIds),
    [canvas.modelIds],
  );
  const inferenceBadges = useMemo(
    () => inferenceBadgeInfo(canvas.modelIds),
    [canvas.modelIds],
  );
  const previewByRole = useMemo(
    () =>
      new Map(canvas.resultPreviews.map((preview) => [preview.role, preview])),
    [canvas.resultPreviews],
  );
  const [deleting, startDelete] = useTransition();
  const [renaming, startRename] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(canvas.title);

  const commitRename = () => {
    setEditing(false);
    const title = normalizeCanvasTitle(draft);
    if (!title || title === canvas.title) {
      setDraft(canvas.title);
      return;
    }

    startRename(async () => {
      onError(null);
      const result = await renameCanvasAction(canvas.id, title).catch(() => ({
        ok: false as const,
        error: 'Renaming the canvas failed. Try again.',
      }));

      if (!result.ok) {
        setDraft(canvas.title);
        onError(result.error);
        return;
      }

      onRenamed(canvas.id, title);
    });
  };

  const handleDelete = () => {
    void (async () => {
      const confirmed = await confirm({
        title: 'Delete this canvas?',
        description:
          'This permanently removes it from your Library and deletes the stored image and video files for its run. This cannot be undone.',
        confirmLabel: 'Delete canvas',
        cancelLabel: 'Keep canvas',
        destructive: true,
      });

      if (!confirmed) return;

      startDelete(async () => {
        onError(null);
        const result = await deleteCanvasAction(canvas.id).catch(() => ({
          ok: false as const,
          error: 'Deleting the canvas failed. Try again.',
        }));

        if (!result.ok) {
          onError(result.error);
          return;
        }

        onDeleted(canvas.id);
      });
    })();
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-3">
        {/* 1. Title: truncated to 40 characters, pencil to rename */}
        {editing ? (
          <input
            autoFocus
            maxLength={MAX_CANVAS_TITLE_LENGTH}
            className="h-8 w-full border border-border bg-input px-2.5 text-sm text-foreground outline-none focus-visible:border-ring"
            value={draft}
            onChange={(event) =>
              setDraft(event.target.value.slice(0, MAX_CANVAS_TITLE_LENGTH))
            }
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRename();
              if (event.key === 'Escape') {
                setDraft(canvas.title);
                setEditing(false);
              }
            }}
          />
        ) : (
          <div className="flex items-start justify-between gap-1.5">
            <p
              className="min-w-0 text-sm font-medium leading-5 text-foreground"
              title={canvas.title}
            >
              {truncateTitle(canvas.title)}
            </p>
            <button
              type="button"
              aria-label="Rename canvas"
              disabled={renaming}
              onClick={() => {
                setDraft(canvas.title);
                setEditing(true);
              }}
              className="flex size-6 shrink-0 cursor-pointer items-center justify-center border border-transparent text-muted-foreground transition hover:border-border hover:text-foreground disabled:opacity-40"
            >
              {renaming ? (
                <FontAwesomeIcon
                  className="size-3.5 animate-spin"
                  icon="spinner"
                />
              ) : (
                <FontAwesomeIcon className="size-3.5" icon="pen-to-square" />
              )}
            </button>
          </div>
        )}

        {/* 2. Single meta badge: Run ID/Canvas ID/Created */}
        <div className="space-y-1 border border-border bg-muted/30 px-2.5 py-2">
          <MetaRow label="Run ID">{canvas.runId ?? 'No run yet'}</MetaRow>
          <MetaRow label="Canvas ID">{canvas.id}</MetaRow>
          <MetaRow label="Created">
            {new Date(canvas.createdAt).toLocaleString()}
          </MetaRow>
        </div>

        {/* 3. Inference: fixed two-line height so cards align */}
        <div className="space-y-1.5">
          <p className="text-[0.6rem] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Inference
          </p>
          <div className="flex h-[3.75rem] flex-wrap content-start gap-1.5 overflow-hidden">
            {inferenceBadges.map(({ Icon, key, label }) => (
              <Badge
                className="gap-1.5 px-2 py-1 text-xs normal-case tracking-normal"
                key={key}
                variant="muted"
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </Badge>
            ))}
          </div>
        </div>

        {/* 4. Models: fixed two-line height so cards align */}
        <div className="space-y-1.5">
          <p className="text-[0.6rem] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Models
          </p>
          <div className="flex h-[3.75rem] flex-wrap content-start gap-1.5 overflow-hidden">
            {modelBadges.map(({ Icon, key, label }) => (
              <Badge
                className="gap-1.5 px-2 py-1 text-xs normal-case tracking-normal"
                key={key}
                variant="outline"
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </Badge>
            ))}
          </div>
        </div>

        {/* 5. Results: always a 2x2 square grid, one slot per role (image,
            refine, video, modify). Slots fill from the run's succeeded steps;
            unused roles stay as placeholders so every card lines up. */}
        <div className="space-y-1.5">
          <p className="text-[0.6rem] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Results
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {RESULT_SLOT_ROLES.map((role) => {
              const preview = previewByRole.get(role);
              return (
                <div key={role} className="aspect-square">
                  {preview && preview.status === 'succeeded' && preview.url ? (
                    <ResultPreview
                      url={preview.url}
                      kind={preview.kind}
                      role={role}
                      title={canvas.title}
                    />
                  ) : preview && preview.status === 'failed' ? (
                    <ResultSlotMessage
                      role={role}
                      icon="eye-slash"
                      tone="error"
                      message={preview.error ?? 'Step failed.'}
                    />
                  ) : preview &&
                    (preview.status === 'queued' ||
                      preview.status === 'running') ? (
                    <ResultSlotMessage
                      role={role}
                      icon="spinner"
                      spin
                      message="Processing"
                    />
                  ) : preview && preview.status === 'canceled' ? (
                    <ResultSlotMessage
                      role={role}
                      icon="ban"
                      message="Canceled"
                    />
                  ) : (
                    <ResultSlotMessage
                      role={role}
                      icon={
                        role === 'video' || role === 'modify'
                          ? 'video'
                          : 'image'
                      }
                      message="Not used"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <Button asChild className="w-full" size="sm">
          <Link
            href={`/dashboard/chain/${canvas.id}`}
            rel="noreferrer"
            target="_blank"
          >
            Open canvas
            <FontAwesomeIcon icon="arrow-up-right-from-square" />
          </Link>
        </Button>
        <Button
          className="w-full hover:border-destructive/60 hover:bg-destructive/10 hover:text-destructive"
          disabled={deleting}
          onClick={handleDelete}
          size="sm"
          variant="outline"
        >
          {deleting ? (
            <FontAwesomeIcon className="animate-spin" icon="spinner" />
          ) : (
            <FontAwesomeIcon icon="trash" />
          )}
          {deleting ? 'Deleting…' : 'Delete canvas'}
        </Button>
      </CardContent>
    </Card>
  );
}

function truncateTitle(title: string) {
  return title.length > MAX_CANVAS_TITLE_LENGTH
    ? `${title.slice(0, MAX_CANVAS_TITLE_LENGTH)}…`
    : title;
}

function MetaRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <p className="break-all font-mono text-[0.65rem] leading-4 text-muted-foreground">
      <span className="uppercase">{label}: </span>
      {children}
    </p>
  );
}

// The Library card always renders a fixed 2x2 result grid, one square slot per
// role, so cards line up no matter how many steps a run produced.
const RESULT_SLOT_ROLES = ['image', 'refine', 'video', 'modify'] as const;

function ResultSlotMessage({
  role,
  icon,
  message,
  tone = 'muted',
  spin = false,
}: {
  role: string;
  icon: string;
  message: string;
  tone?: 'muted' | 'error';
  spin?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex h-full w-full flex-col items-center justify-center gap-1 border px-2 text-center',
        tone === 'error'
          ? 'border-rose-300/40 bg-black text-rose-300'
          : 'border-dashed border-border text-muted-foreground',
      )}
    >
      <FontAwesomeIcon
        className={cn('size-4', spin && 'animate-spin')}
        icon={icon}
      />
      <span className="text-[0.55rem] font-medium uppercase tracking-wide">
        {role}
      </span>
      <span className="line-clamp-3 text-[0.55rem] leading-3 [overflow-wrap:anywhere]">
        {message}
      </span>
    </div>
  );
}

function ResultPreview({
  url,
  kind,
  role,
  title,
}: {
  url: string;
  kind: 'image' | 'video';
  role: string;
  title: string;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // The Library is server-rendered, so a cached image/video can finish loading
  // before React hydrates and attaches onLoad/onLoadedMetadata, so the event is
  // missed and the overlay would spin forever. This callback ref re-checks
  // readiness when the element mounts and clears the overlay when the browser
  // already has the media.
  const markLoadedIfReady = useCallback(
    (node: HTMLImageElement | HTMLVideoElement | null) => {
      if (!node) return;

      if (node instanceof HTMLVideoElement) {
        if (node.readyState >= 1) setLoaded(true);
        return;
      }

      if (node.complete && node.naturalWidth > 0) setLoaded(true);
    },
    [],
  );

  // Provider delivery URLs expire, so a once-succeeded output can fail to load
  // now. Surface the role with an eye-off and the storage hint.
  if (failed) {
    return (
      <ResultSlotMessage
        role={role}
        icon="eye-slash"
        message="Removed by your inference. Set up storage to keep outputs longer."
      />
    );
  }

  // object-contain (not cover): portrait results (9:16) letterbox inside the
  // landscape cell instead of being cropped to a landscape crop.
  return (
    <div className="relative h-full w-full">
      {kind === 'video' ? (
        <video
          ref={markLoadedIfReady}
          src={url}
          controls
          muted
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
          onLoadedMetadata={() => setLoaded(true)}
          className="h-full w-full border border-border bg-black object-contain"
        />
      ) : (
        <img
          ref={markLoadedIfReady}
          src={url}
          alt={`${title} - ${role} result`}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          onLoad={() => setLoaded(true)}
          className="h-full w-full border border-border bg-black object-contain"
        />
      )}
      {/* Until the media loads, cover the slot (and the browser's alt text)
          with an explicit loading state. */}
      {!loaded ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 border border-border bg-black text-muted-foreground">
          <FontAwesomeIcon className="size-5 animate-spin" icon="spinner" />
          <span className="text-[0.65rem] leading-4">Loading…</span>
        </div>
      ) : null}
    </div>
  );
}

function modelBadgeInfo(modelIds: string[]): BadgeInfo[] {
  return uniqueBadges(
    modelIds.map((modelId) => {
      const iconKey = modelIconKey(modelId);
      if (!iconKey) return null;
      return {
        Icon: MODEL_ICONS[iconKey],
        key: modelId,
        label: formatPublicModelName(modelId),
      };
    }),
  );
}

function inferenceBadgeInfo(modelIds: string[]): BadgeInfo[] {
  return uniqueBadges(
    modelIds.map((modelId) => {
      if (!modelId) return null;
      const key = inferenceKey(modelId);
      return {
        Icon: INFERENCE_ICONS[key],
        key,
        label: INFERENCE_LABELS[key],
      };
    }),
  );
}

function uniqueBadges(items: Array<BadgeInfo | null>) {
  return Array.from(
    new Map(
      items
        .filter((item): item is BadgeInfo => item !== null)
        .map((item) => [item.key, item]),
    ).values(),
  );
}

function namespace(modelId: string) {
  return modelId.split('/')[0] ?? '';
}

function modelIconKey(modelId: string): ModelIconKey | null {
  const key = namespace(modelId);

  if (key === 'bfl' || key === 'black-forest-labs') return 'bfl';
  if (key === 'bytedance' || key === 'byteplus') return 'bytedance';
  if (key === 'google') return 'google';
  if (key === 'happyhorse') return 'happyhorse';
  if (key === 'gpt' || key === 'openai') return 'openai';
  if (key === 'qwen') return 'qwen';
  if (key === 'runway') return 'runway';
  if (key === 'wan') return 'wan';
  if (key === 'z') return 'z';

  return null;
}

function inferenceKey(modelId: string): InferenceIconKey {
  const key = namespace(modelId);

  if (key === 'bfl' || key === 'black-forest-labs') return 'black-forest-labs';
  if (key === 'bytedance' || key === 'byteplus') return 'byteplus';
  if (key === 'google') return 'google';
  if (key === 'gpt' || key === 'openai') return 'openai';
  if (key === 'runway') return 'runway';

  return 'alibaba-cloud';
}
