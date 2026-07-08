'use client';

import { ProtectedImage } from '@/components/protected-image';
import Link from 'next/link';
import type { ComponentType, CSSProperties, SVGProps } from 'react';

import { FontAwesomeIcon } from '@/components/icons/font-awesome-icon';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { ModelChainCatalogGridEntry } from '@/lib/chains/catalog';
import { formatPublicModelName } from '@/lib/models/display';
import {
  InlineBlackForestLabsLight,
  InlineByteDance,
  InlineGoogle,
  InlineHappyHorseLight,
  InlineOpenAILight,
  InlineQwen,
  InlineRunwayLight,
  InlineWan,
  InlineZImage,
} from '@/components/icons/inline-model';

export function ModelChainCard({
  entry,
}: {
  entry: ModelChainCatalogGridEntry;
}) {
  const modelIcons = getUniqueModelIcons(entry.modelIdentifiers);

  return (
    <Link
      className="group block"
      href={entry.href}
      style={{ '--chain-accent': entry.accent } as CSSProperties}
    >
      <Card className="grid h-full grid-rows-[auto_1fr_auto] overflow-hidden bg-card shadow-sm transition duration-200 hover:-translate-y-1 hover:border-[var(--chain-accent)] hover:bg-muted/60">
        <div
          className="relative aspect-[16/10] overflow-hidden border-b border-border bg-muted"
          onContextMenu={(event) => event.preventDefault()}
        >
          <ProtectedImage
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-80 grayscale contrast-125 transition duration-300 group-hover:scale-105 group-hover:opacity-100 group-hover:grayscale-0"
            src={entry.imageSrc}
          />
        </div>

        <CardHeader className="grid-rows-[1.75rem_minmax(5.375rem,auto)] border-b border-border p-4 md:p-5">
          <div className="flex h-7 items-center gap-3">
            <div className="flex items-center gap-1" aria-label={entry.badge}>
              {modelIcons.map(({ Icon, key, label }) => (
                <span
                  aria-label={label}
                  className="grid size-8 place-items-center border border-border bg-muted text-foreground"
                  key={`${entry.slug}-${key}`}
                  role="img"
                  title={label}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </span>
              ))}
            </div>
          </div>
          <div className="mt-5 grid min-h-[5.375rem] content-start gap-1.5">
            {entry.modelIdentifiers.map((model) => (
              <Badge
                className="w-fit max-w-full whitespace-normal break-words px-1.5 py-1 text-[0.6rem] leading-4 tracking-[0.08em]"
                key={`${entry.slug}-${model}`}
                variant="outline"
              >
                {formatPublicModelName(model)}
              </Badge>
            ))}
          </div>
        </CardHeader>

        <CardContent className="mt-auto p-4 md:p-5">
          <div className="flex items-center justify-between gap-3 text-sm font-medium text-foreground">
            <span>{entry.actionLabel}</span>
            <FontAwesomeIcon
              className="size-4 text-[var(--chain-accent)] transition group-hover:translate-x-1"
              icon="arrow-right"
            />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function getUniqueModelIcons(modelIdentifiers: string[]) {
  return Array.from(
    new Map(
      modelIdentifiers.flatMap((modelIdentifier) => {
        const key = getModelIconKey(modelIdentifier);

        if (!key) {
          return [];
        }

        return [
          [
            key,
            { Icon: MODEL_ICONS[key], key, label: MODEL_LABELS[key] },
          ] as const,
        ];
      }),
    ).values(),
  );
}

const MODEL_ICONS: Record<
  ModelIconKey,
  ComponentType<SVGProps<SVGSVGElement>>
> = {
  bfl: InlineBlackForestLabsLight,
  bytedance: InlineByteDance,
  google: InlineGoogle,
  happyhorse: InlineHappyHorseLight,
  openai: InlineOpenAILight,
  qwen: InlineQwen,
  runway: InlineRunwayLight,
  wan: InlineWan,
  z: InlineZImage,
};

const MODEL_LABELS: Record<ModelIconKey, string> = {
  bfl: 'Black Forest Labs',
  bytedance: 'ByteDance',
  google: 'Google',
  happyhorse: 'HappyHorse',
  openai: 'GPT',
  qwen: 'Qwen',
  runway: 'Runway',
  wan: 'Wan',
  z: 'Z-Image',
};

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

function getModelIconKey(modelIdentifier: string): ModelIconKey | null {
  const [provider = ''] = modelIdentifier.split('/');

  if (provider === 'bfl' || provider === 'black-forest-labs') {
    return 'bfl';
  }

  if (provider === 'bytedance' || provider === 'byteplus') {
    return 'bytedance';
  }

  if (provider === 'google') {
    return 'google';
  }

  if (provider === 'happyhorse') {
    return 'happyhorse';
  }

  if (provider === 'qwen') {
    return 'qwen';
  }

  if (provider === 'gpt' || provider === 'openai') {
    return 'openai';
  }

  if (provider === 'runway') {
    return 'runway';
  }

  if (provider === 'wan') {
    return 'wan';
  }

  if (provider === 'z') {
    return 'z';
  }

  return null;
}
