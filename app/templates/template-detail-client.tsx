'use client';

import type { CSSProperties } from 'react';
import type { ReactNode } from 'react';
import { useState } from 'react';

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
import { ProtectedImage } from '@/components/protected-image';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import {
  createChainRunCurl,
  createChainRunInput,
  createExampleStepInputFromRequestSchema,
  createModelSchemaJsonFromRequestSchema,
} from '@/lib/chains/ui-request-shape';
import {
  type ChainSchemaStepRole,
  modelSchemaCacheKey,
} from '@/lib/models/chain-schema';
import {
  synthesizeTemplateEntry,
  type TemplatePageEntry,
} from './synthesize-entry';
import { formatPublicModelName } from '@/lib/models/display';

import { SectionHeading } from '../_components/section-heading';
import { StepGrid } from '../_components/step-grid';

const HERO_BADGE_CLASS = 'gap-2 px-3 py-2 text-sm normal-case tracking-normal';
const HERO_BADGE_ICON_CLASS = 'size-4 shrink-0';
const NO_REFINE_MODEL = '__no_refine_model__';
const NO_MODIFY_MODEL = '__no_modify_model__';
const HERO_SUBMISSION_REPO_URL = 'https://github.com/babysea-community/marsha';

export type { TemplatePageEntry } from './synthesize-entry';

type TemplateDetailContent = {
  stepLabels: {
    dependencyPrefix: string;
    indexPrefix: string;
    rootDependency: string;
  };
  stepsEyebrow: string;
  stepsTitle: string;
};

type ModelOptions = {
  imageModels: string[];
  modifyModels: string[];
  refineModels: string[];
  videoModels: string[];
};

type JsonObject = Record<string, unknown>;
type ModelRequestSchemas = Record<string, JsonObject>;

export function TemplateDetailClient({
  content,
  modelRequestSchemas,
  modelOptions,
  modifyCompatibility,
}: {
  content: TemplateDetailContent;
  modelRequestSchemas: ModelRequestSchemas;
  modelOptions: ModelOptions;
  modifyCompatibility: Record<string, string[]>;
}) {
  const [imageModel, setImageModel] = useInitialModel(
    modelOptions.imageModels[0],
  );
  const [refineModel, setRefineModel] = useInitialModel(NO_REFINE_MODEL);
  const [videoModel, setVideoModelState] = useInitialModel(
    modelOptions.videoModels[0],
  );
  const [modifyModel, setModifyModel] = useInitialModel(NO_MODIFY_MODEL);

  // Modify options follow the selected video model (the Google → URL-only
  // provider gate); switching to an incompatible video resets the modify step.
  const allowedModifyModels = modifyCompatibility[videoModel] ?? [];
  const setVideoModel = (nextVideoModel: string) => {
    setVideoModelState(nextVideoModel);
    const allowed = modifyCompatibility[nextVideoModel] ?? [];
    if (modifyModel !== NO_MODIFY_MODEL && !allowed.includes(modifyModel)) {
      setModifyModel(NO_MODIFY_MODEL);
    }
  };

  if (!imageModel || !videoModel) {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <section className="px-3 py-3 md:px-5 md:py-5">
          <div className="mx-auto grid min-h-80 max-w-[1520px] place-items-center border border-border bg-card p-6 text-center font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
            No templates available
          </div>
        </section>
      </main>
    );
  }

  // The active combination is synthesized locally because the full image × refine ×
  // video × modify matrix (≈79k entries) is never shipped to the client.
  const entry = synthesizeTemplateEntry({
    imageModel,
    refineModel: optionalSelectedModel(refineModel, NO_REFINE_MODEL),
    videoModel,
    modifyModel: optionalSelectedModel(modifyModel, NO_MODIFY_MODEL),
  });

  const requestCurl = createRunCurl(entry, modelRequestSchemas);
  const inferenceProviders = getUniqueInferenceProviders(
    entry.modelIdentifiers,
  );

  return (
    <main
      className="min-h-screen bg-background text-foreground"
      style={{ '--chain-accent': entry.accent } as CSSProperties}
    >
      <div className="flex flex-col gap-6 px-3 py-6 md:gap-12 md:px-5 md:py-12">
        <section>
          <div className="mx-auto grid max-w-[1520px] border border-border bg-card lg:grid-cols-[2fr_3fr]">
            <section className="border-b border-border p-5 md:p-7 lg:border-b-0 lg:border-r">
              <div className="flex flex-wrap gap-2">
                {inferenceProviders.map((provider) => (
                  <ProviderBadge
                    key={`${entry.slug}-provider-${provider}`}
                    provider={provider}
                  />
                ))}
              </div>
              <h1 className="mt-7 flex flex-col items-start gap-2">
                {entry.modelIdentifiers.map((modelIdentifier, index) => (
                  <ModelBadge
                    key={`${entry.slug}-model-${index}-${modelIdentifier}`}
                    modelIdentifier={modelIdentifier}
                  />
                ))}
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
                {entry.description}
              </p>
              <div className="mt-8 h-2 w-24 bg-[var(--chain-accent)]" />
            </section>

            <section className="grid content-between gap-8 p-5 md:p-7">
              <div className="grid gap-4 md:grid-cols-4">
                <ModelSelect
                  label="Image model"
                  onChange={setImageModel}
                  options={modelOptions.imageModels}
                  value={imageModel}
                />
                <ModelSelect
                  emptyLabel="No refine step"
                  label="Image model [Optional]"
                  onChange={setRefineModel}
                  options={modelOptions.refineModels}
                  value={refineModel}
                />
                <ModelSelect
                  label="Video model"
                  onChange={setVideoModel}
                  options={modelOptions.videoModels}
                  value={videoModel}
                />
                <ModelSelect
                  emptyLabel="No modify step"
                  emptyValue={NO_MODIFY_MODEL}
                  label="Video model [Optional]"
                  onChange={setModifyModel}
                  options={allowedModifyModels}
                  value={modifyModel}
                />
              </div>

              <Card className="border-border bg-card shadow-none">
                <CardContent className="grid gap-6 p-5">
                  <div>
                    <div className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
                      route packet
                    </div>
                    <div className="mt-5 border border-border bg-muted/40 p-4 font-mono text-sm text-foreground">
                      {entry.routeLabel}
                    </div>
                  </div>
                  <div className="divide-y divide-border border border-border">
                    {createRoutePacketRows(entry).map((row) => (
                      <div
                        className="grid gap-3 bg-card px-4 py-3 md:grid-cols-[13rem_1fr]"
                        key={`packet-${row.key}`}
                      >
                        <span className="break-all font-mono text-xs text-muted-foreground">
                          {row.key}
                        </span>
                        <span className="break-all font-mono text-xs text-foreground">
                          {row.modelIdentifier}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </section>
          </div>
        </section>

        <section id="api-schema">
          <div className="mx-auto grid max-w-[1520px] gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,4fr)_minmax(0,3fr)]">
            <EnvironmentSection entry={entry} />
            <CurlSection code={requestCurl} />
            <SchemaSection
              entry={entry}
              modelRequestSchemas={modelRequestSchemas}
            />
          </div>
        </section>

        <section>
          <div className="mx-auto max-w-[1520px] border border-border bg-card p-5 md:p-7">
            <SectionHeading
              eyebrow={content.stepsEyebrow}
              title={content.stepsTitle}
            />
            <StepGrid
              labels={content.stepLabels}
              modelIdentifiers={entry.modelIdentifiers}
              steps={entry.selectedSteps}
            />
          </div>
        </section>

        <TemplateHeroSubmissionCta entry={entry} />
      </div>
    </main>
  );
}

function TemplateHeroSubmissionCta({ entry }: { entry: TemplatePageEntry }) {
  return (
    <section>
      <div className="mx-auto grid max-w-[1520px] border border-border bg-card lg:grid-cols-[minmax(0,0.95fr)_minmax(24rem,1.05fr)]">
        <div className="p-5 md:p-7">
          <div className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
            template heroes
          </div>
          <h2 className="mt-4 max-w-3xl text-2xl font-semibold tracking-tight text-foreground md:text-4xl">
            Use this template? Submit your artwork.
          </h2>
          <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">
            Generate with this model chain, then send us the image you are proud
            of. Selected submissions may become the main hero artwork for this
            template cards.
          </p>
          <Button
            asChild
            className="mt-7 w-full justify-between sm:w-auto"
            size="lg"
          >
            <a
              href={createHeroSubmissionUrl(entry)}
              rel="noopener noreferrer"
              target="_blank"
            >
              Submit your result
              <FontAwesomeIcon icon="upload" />
            </a>
          </Button>
        </div>
        <div className="grid gap-4 border-t border-border p-5 md:p-7 lg:border-l lg:border-t-0">
          <div className="grid gap-4 sm:grid-cols-2">
            <figure className="grid gap-2">
              <div
                className="group/hero relative aspect-[16/10] overflow-hidden border border-border bg-muted transition duration-200 hover:-translate-y-1 hover:border-[var(--chain-accent)]"
                onContextMenu={(event) => event.preventDefault()}
              >
                <ProtectedImage
                  alt="Current Marsha template card hero"
                  className="absolute inset-0 h-full w-full object-cover opacity-80 grayscale contrast-125 transition duration-300 group-hover/hero:scale-105 group-hover/hero:opacity-100 group-hover/hero:grayscale-0"
                  src={entry.imageSrc}
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/70 via-transparent to-transparent opacity-70" />
              </div>
              <figcaption className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
                default card hero
              </figcaption>
            </figure>
            <div className="flex items-center text-sm leading-6 text-muted-foreground sm:pl-2">
              We use this image on template cards today. Send a result from this
              exact model chain and it can replace the default hero.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function EnvironmentSection({ entry }: { entry: TemplatePageEntry }) {
  const rows = createEnvironmentRows(entry);
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(createEnvironmentCopyText(rows));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <DetailSection
      action={
        <Button
          aria-label="Copy environment variables"
          onClick={() => void handleCopy()}
          size="sm"
          type="button"
          variant="outline"
        >
          {copied ? (
            <FontAwesomeIcon className="size-4" icon="check" />
          ) : (
            <FontAwesomeIcon className="size-4" icon="copy" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      }
      title="ENVIRONMENT"
    >
      <Table className="table-fixed">
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.name}>
              <TableCell>
                <div className="break-all font-mono text-xs text-foreground">
                  {row.name}={row.value}
                </div>
                <p className="mt-1 text-[0.65rem] leading-4 text-muted-foreground">
                  {row.description}
                </p>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DetailSection>
  );
}

function CurlSection({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <DetailSection
      action={
        <Button
          aria-label="Copy curl command"
          onClick={() => void handleCopy()}
          size="sm"
          type="button"
          variant="outline"
        >
          {copied ? (
            <FontAwesomeIcon className="size-4" icon="check" />
          ) : (
            <FontAwesomeIcon className="size-4" icon="copy" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      }
      title="CURL"
    >
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-[#050505] p-4 font-mono text-xs leading-6 text-[#f8fafc]">
        <code>{highlightCurlCode(code)}</code>
      </pre>
    </DetailSection>
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

const SHELL_EXACT_TOKEN_TONES = new Map<string, CodeTokenTone>([
  ['curl', 'command'],
  ['\\', 'punctuation'],
]);

const JSON_LITERAL_TOKENS = new Set(['true', 'false', 'null']);

function highlightCurlCode(code: string) {
  const heredocMarker = "--data @- <<'JSON'\n";
  const heredocStart = code.indexOf(heredocMarker);

  if (heredocStart !== -1) {
    const jsonStart = heredocStart + heredocMarker.length;
    const jsonEnd = code.lastIndexOf('\nJSON');

    if (jsonEnd > jsonStart) {
      return [
        ...highlightShellCode(code.slice(0, jsonStart), 'curl-shell'),
        ...highlightJsonCode(code.slice(jsonStart, jsonEnd), 'curl-json'),
        ...highlightShellCode(code.slice(jsonEnd), 'curl-tail'),
      ];
    }
  }

  const dataMarker = "--data '";
  const dataStart = code.indexOf(dataMarker);

  if (dataStart === -1) {
    return highlightShellCode(code, 'curl');
  }

  const jsonStart = dataStart + dataMarker.length;
  const jsonEnd = code.lastIndexOf("'");

  if (jsonEnd <= jsonStart) {
    return highlightShellCode(code, 'curl');
  }

  return [
    ...highlightShellCode(code.slice(0, jsonStart), 'curl-shell'),
    ...highlightJsonCode(code.slice(jsonStart, jsonEnd), 'curl-json'),
    ...highlightShellCode(code.slice(jsonEnd), 'curl-tail'),
  ];
}

function highlightShellCode(source: string, keyPrefix: string) {
  return tokenizeCode(
    source,
    /(curl|--[a-z-]+|\\|'[^']*'|https?:\/\/[^\s']+)/gi,
    (token) => {
      const exactTone = SHELL_EXACT_TOKEN_TONES.get(token);

      if (exactTone) return exactTone;
      if (token.startsWith('--')) return 'option';
      if (token.startsWith('http') || token.startsWith("'")) return 'string';
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
      if (JSON_LITERAL_TOKENS.has(token)) {
        return 'literal';
      }
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

function SchemaSection({
  entry,
  modelRequestSchemas,
}: {
  entry: TemplatePageEntry;
  modelRequestSchemas: ModelRequestSchemas;
}) {
  const schemas = createModelSchemaViews(entry, modelRequestSchemas);
  const [openSchema, setOpenSchema] = useState<string | null>(null);
  const [copiedSchema, setCopiedSchema] = useState<string | null>(null);

  async function handleCopy(schema: ModelSchemaView) {
    try {
      await navigator.clipboard.writeText(createSchemaCopyText(schema));
      setCopiedSchema(schema.id);
      window.setTimeout(() => setCopiedSchema(null), 1400);
    } catch {
      setCopiedSchema(null);
    }
  }

  return (
    <DetailSection title="SCHEMA">
      <div className="divide-y divide-border">
        {schemas.map((schema) => {
          const isOpen = openSchema === schema.id;

          return (
            <div key={`schema-${schema.id}`}>
              <div className="flex items-stretch gap-2 p-3">
                <button
                  aria-expanded={isOpen}
                  className="flex min-h-11 flex-1 items-center justify-between gap-3 border border-border bg-background px-3 text-left font-mono text-xs uppercase tracking-[0.12em] text-foreground transition hover:border-primary"
                  onClick={() => setOpenSchema(isOpen ? null : schema.id)}
                  type="button"
                >
                  <span className="min-w-0 truncate">{schema.label}</span>
                  <FontAwesomeIcon
                    className={`size-4 shrink-0 text-muted-foreground transition ${
                      isOpen ? 'rotate-180' : ''
                    }`}
                    icon="chevron-down"
                  />
                </button>
                <Button
                  aria-label={`Copy schema for ${schema.label}`}
                  className="min-h-11"
                  onClick={() => void handleCopy(schema)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {copiedSchema === schema.id ? (
                    <FontAwesomeIcon className="size-4" icon="check" />
                  ) : (
                    <FontAwesomeIcon className="size-4" icon="copy" />
                  )}
                  {copiedSchema === schema.id ? 'Copied' : 'Copy'}
                </Button>
              </div>
              {isOpen ? <SchemaJsonBlock value={schema.schema} /> : null}
            </div>
          );
        })}
      </div>
    </DetailSection>
  );
}

function SchemaJsonBlock({ value }: { value: JsonObject }) {
  const json = JSON.stringify(value, null, 2);

  return (
    <div className="px-3 pb-3">
      <pre className="max-h-[34rem] overflow-auto border border-border bg-[#050505] p-4 font-mono text-xs leading-6 text-[#f8fafc]">
        <code>{highlightJsonCode(json, 'schema-json')}</code>
      </pre>
    </div>
  );
}

function DetailSection({
  action,
  children,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="flex h-full flex-col overflow-hidden border border-border bg-card">
      <div className="flex h-14 items-center justify-between gap-3 border-b border-border bg-muted/30 px-4">
        <Badge
          className="border-[var(--chain-accent)] bg-[var(--chain-accent)] font-mono text-xs text-primary-foreground"
          variant="default"
        >
          {title}
        </Badge>
        {action}
      </div>
      {children}
    </section>
  );
}

function ProviderBadge({ provider }: { provider: InferenceProvider }) {
  return (
    <Badge className={HERO_BADGE_CLASS} variant="outline">
      {renderInferenceProviderIcon(provider)}
      {inferenceProviderLabel(provider)}
    </Badge>
  );
}

function ModelBadge({ modelIdentifier }: { modelIdentifier: string }) {
  const modelIcon = getModelIcon(modelIdentifier);

  return (
    <Badge className={HERO_BADGE_CLASS} variant="outline">
      {renderModelIcon(modelIcon)}
      {formatPublicModelName(modelIdentifier)}
    </Badge>
  );
}

function ModelSelect({
  emptyLabel,
  emptyValue,
  label,
  onChange,
  options,
  value,
}: {
  emptyLabel?: string;
  emptyValue?: string;
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label className="grid gap-2">
      <span className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span className="relative block">
        <select
          className="h-12 w-full appearance-none border border-border bg-background px-3 pr-9 text-sm font-medium text-foreground outline-none transition focus:border-primary"
          onChange={(event) => onChange(event.target.value)}
          value={value}
        >
          {emptyLabel ? (
            <option value={emptyValue ?? NO_REFINE_MODEL}>{emptyLabel}</option>
          ) : null}
          {options.map((model) => (
            <option key={`${label}-${model}`} value={model}>
              {formatPublicModelName(model)}
            </option>
          ))}
        </select>
        <FontAwesomeIcon
          className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          icon="chevron-down"
        />
      </span>
    </label>
  );
}

type InferenceProvider =
  | 'alibaba-cloud'
  | 'black-forest-labs'
  | 'byteplus'
  | 'google'
  | 'openai'
  | 'runway';
type ModelIcon =
  | 'black-forest-labs'
  | 'bytedance'
  | 'google'
  | 'happyhorse'
  | 'openai'
  | 'qwen'
  | 'runway'
  | 'wan'
  | 'z';

function getUniqueInferenceProviders(modelIdentifiers: string[]) {
  return Array.from(new Set(modelIdentifiers.map(getInferenceProvider)));
}

function getInferenceProvider(modelIdentifier: string): InferenceProvider {
  const [namespace = ''] = modelIdentifier.split('/');

  if (namespace === 'bfl' || namespace === 'black-forest-labs') {
    return 'black-forest-labs';
  }

  if (namespace === 'bytedance' || namespace === 'byteplus') {
    return 'byteplus';
  }

  if (namespace === 'google') {
    return 'google';
  }

  if (namespace === 'gpt' || namespace === 'openai') {
    return 'openai';
  }

  if (namespace === 'runway') {
    return 'runway';
  }

  return 'alibaba-cloud';
}

function inferenceProviderLabel(provider: InferenceProvider) {
  const labels: Record<InferenceProvider, string> = {
    'alibaba-cloud': 'Alibaba Cloud',
    'black-forest-labs': 'Black Forest Labs',
    byteplus: 'BytePlus',
    google: 'Google',
    openai: 'OpenAI',
    runway: 'Runway',
  };

  return labels[provider];
}

function renderInferenceProviderIcon(provider: InferenceProvider) {
  const className = HERO_BADGE_ICON_CLASS;

  switch (provider) {
    case 'alibaba-cloud':
      return (
        <InlineInferenceAlibabaCloud className={className} aria-hidden="true" />
      );
    case 'black-forest-labs':
      return (
        <InlineInferenceBlackForestLabsLight
          className={className}
          aria-hidden="true"
        />
      );
    case 'byteplus':
      return (
        <InlineInferenceBytePlus className={className} aria-hidden="true" />
      );
    case 'google':
      return <InlineInferenceGoogle className={className} aria-hidden="true" />;
    case 'openai':
      return (
        <InlineInferenceOpenAILight className={className} aria-hidden="true" />
      );
    case 'runway':
      return (
        <InlineInferenceRunwayLight className={className} aria-hidden="true" />
      );
  }
}

function getModelIcon(modelIdentifier: string): ModelIcon | null {
  const [namespace = ''] = modelIdentifier.split('/');

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

function renderModelIcon(modelIcon: ModelIcon | null) {
  const className = HERO_BADGE_ICON_CLASS;

  switch (modelIcon) {
    case 'black-forest-labs':
      return (
        <InlineModelBlackForestLabsLight
          className={className}
          aria-hidden="true"
        />
      );
    case 'bytedance':
      return <InlineModelByteDance className={className} aria-hidden="true" />;
    case 'google':
      return <InlineModelGoogle className={className} aria-hidden="true" />;
    case 'happyhorse':
      return (
        <InlineModelHappyHorseLight className={className} aria-hidden="true" />
      );
    case 'openai':
      return (
        <InlineModelOpenAILight className={className} aria-hidden="true" />
      );
    case 'qwen':
      return <InlineModelQwen className={className} aria-hidden="true" />;
    case 'runway':
      return (
        <InlineModelRunwayLight className={className} aria-hidden="true" />
      );
    case 'wan':
      return <InlineModelWan className={className} aria-hidden="true" />;
    case 'z':
      return <InlineModelZImage className={className} aria-hidden="true" />;
    case null:
      return null;
  }
}

function useInitialModel(initialValue: string | undefined) {
  const fallbackValue = initialValue ?? '';

  return useState(fallbackValue);
}

function optionalSelectedModel(value: string, emptyValue: string) {
  return value === emptyValue ? undefined : value;
}

function stringInputValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function createRoutePacketRows(entry: TemplatePageEntry) {
  const imageModel = stringInputValue(entry.defaultInput.image_model) ?? '';
  const refineModel = stringInputValue(entry.defaultInput.refine_model);
  const videoModel = stringInputValue(entry.defaultInput.video_model) ?? '';
  const modifyModel = stringInputValue(entry.defaultInput.modify_model);

  return [
    {
      key: 'image_model',
      modelIdentifier: imageModel,
    },
    ...(refineModel
      ? [
          {
            key: 'refine_model',
            modelIdentifier: refineModel,
          },
        ]
      : []),
    {
      key: 'video_model',
      modelIdentifier: videoModel,
    },
    ...(modifyModel
      ? [
          {
            key: 'modify_model',
            modelIdentifier: modifyModel,
          },
        ]
      : []),
  ];
}

function createRunCurl(
  entry: TemplatePageEntry,
  modelRequestSchemas: ModelRequestSchemas,
) {
  return createChainRunCurl(
    createDocsStyleRunInput(entry, modelRequestSchemas),
  );
}

function createHeroSubmissionUrl(entry: TemplatePageEntry) {
  const body = [
    'Share an image result generated with this Marsha template.',
    '',
    `Template: ${entry.title}`,
    '',
    'Models:',
    ...entry.modelIdentifiers.map((modelIdentifier) => `- ${modelIdentifier}`),
    '',
    'Attach your image result here or paste a public URL:',
    '',
    'Prompt or notes:',
  ].join('\n');
  const params = new URLSearchParams({
    body,
    title: `Template hero submission: ${entry.title}`,
  });

  return `${HERO_SUBMISSION_REPO_URL}/issues/new?${params.toString()}`;
}

type EnvironmentRow = {
  description: string;
  name: string;
  value: string;
};

type ModelSchemaView = {
  id: string;
  label: string;
  modelIdentifier: string;
  schema: JsonObject;
};

function createEnvironmentRows(entry: TemplatePageEntry): EnvironmentRow[] {
  const providers = getUniqueInferenceProviders(entry.modelIdentifiers);

  return [
    {
      description: 'Your custom domain.',
      name: 'NEXT_PUBLIC_SITE_URL',
      value: '',
    },
    {
      description: 'Email allowed to login to the dashboard.',
      name: 'OWNER_EMAIL',
      value: '',
    },
    {
      description: 'Dashboard sign-in password.',
      name: 'OWNER_PASSWORD',
      value: '',
    },
    {
      description: 'You can use: openssl rand -hex 32.',
      name: 'OWNER_SESSION_SECRET',
      value: '',
    },
    {
      description: 'Database provider: aurora or polardb.',
      name: 'APP_DATABASE',
      value: 'aurora',
    },
    {
      description: 'PostgreSQL connection string for the selected provider.',
      name: 'DATABASE_URL',
      value: '',
    },
    {
      description: 'API key clients use in the Authorization bearer header.',
      name: 'APP_API_KEY',
      value: '',
    },
    {
      description: 'Secret used to authorize the queued-run recovery cron.',
      name: 'APP_CRON_SECRET',
      value: '',
    },
    {
      description: 'Secret used to sign callback and idempotency metadata.',
      name: 'APP_CALLBACK_SECRET',
      value: '',
    },
    {
      description: 'Provider execution mode.',
      name: 'APP_PROVIDER_MODE',
      value: 'byok',
    },
    ...providers.flatMap(environmentRowsForProvider),
  ];
}

function createEnvironmentCopyText(rows: EnvironmentRow[]) {
  return rows.map((row) => `${row.name}=${row.value}`).join('\n');
}

function createModelSchemaViews(
  entry: TemplatePageEntry,
  modelRequestSchemas: ModelRequestSchemas,
): ModelSchemaView[] {
  const steps = [
    {
      id: 'image_model',
      modelIdentifier: stringInputValue(entry.defaultInput.image_model),
      role: 'image' as const,
    },
    {
      id: 'refine_model',
      modelIdentifier: stringInputValue(entry.defaultInput.refine_model),
      role: 'refine' as const,
    },
    {
      id: 'video_model',
      modelIdentifier: stringInputValue(entry.defaultInput.video_model),
      role: 'video' as const,
    },
    {
      id: 'modify_model',
      modelIdentifier: stringInputValue(entry.defaultInput.modify_model),
      role: 'modify' as const,
    },
  ];

  return steps.flatMap((step) => {
    const { id, modelIdentifier, role } = step;

    if (!modelIdentifier) {
      return [];
    }

    const schema = modelRequestSchema(
      modelRequestSchemas,
      role,
      modelIdentifier,
    );
    const label = formatPublicModelName(modelIdentifier);

    return [
      {
        id,
        label,
        modelIdentifier,
        schema: createSchemaJson(label, modelIdentifier, schema),
      },
    ];
  });
}

function createSchemaCopyText(schema: ModelSchemaView) {
  return JSON.stringify(schema.schema, null, 2);
}

function createSchemaJson(
  label: string,
  modelIdentifier: string,
  schema: JsonObject,
): JsonObject {
  return createModelSchemaJsonFromRequestSchema({
    excludedKeys: MODEL_SCHEMA_KEYS_HANDLED_BY_APP,
    modelId: modelIdentifier,
    modelLabel: label,
    schema,
  });
}

function environmentRowsForProvider(provider: InferenceProvider) {
  switch (provider) {
    case 'alibaba-cloud':
      return [
        {
          description: 'Alibaba Cloud Model Studio API key.',
          name: 'DASHSCOPE_API_KEY',
          value: '',
        },
      ];
    case 'black-forest-labs':
      return [
        {
          description: 'Black Forest Labs API key.',
          name: 'BFL_API_KEY',
          value: '',
        },
        {
          description: 'Change if you use a different region.',
          name: 'BFL_REGION',
          value: 'global',
        },
        {
          description: 'Change if you use a different region.',
          name: 'BFL_API_BASE_URL',
          value: 'https://api.bfl.ai/v1',
        },
      ];
    case 'byteplus':
      return [
        {
          description: 'BytePlus ModelArk API key.',
          name: 'ARK_API_KEY',
          value: '',
        },
      ];
    case 'google':
      return [
        {
          description: 'Google Gemini API key.',
          name: 'GEMINI_API_KEY',
          value: '',
        },
      ];
    case 'openai':
      return [
        {
          description: 'OpenAI API key.',
          name: 'OPENAI_API_KEY',
          value: '',
        },
      ];
    case 'runway':
      return [
        {
          description: 'Runway API key.',
          name: 'RUNWAYML_API_SECRET',
          value: '',
        },
      ];
  }
}

function createDocsStyleRunInput(
  entry: TemplatePageEntry,
  modelRequestSchemas: ModelRequestSchemas,
) {
  const imageModel = stringInputValue(entry.defaultInput.image_model) ?? '';
  const refineModel = stringInputValue(entry.defaultInput.refine_model);
  const videoModel = stringInputValue(entry.defaultInput.video_model) ?? '';
  const modifyModel = stringInputValue(entry.defaultInput.modify_model);

  return createChainRunInput({
    imageModel,
    imageModelInput: createExampleStepInputFromRequestSchema({
      excludedKeys: MODEL_SCHEMA_KEYS_HANDLED_BY_APP,
      schema: modelRequestSchema(modelRequestSchemas, 'image', imageModel),
      values: modelInputObject(entry.defaultInput.image_model_input),
    }),
    modifyModel,
    modifyModelInput: createExampleStepInputFromRequestSchema({
      excludedKeys: MODEL_SCHEMA_KEYS_HANDLED_BY_APP,
      schema: modelRequestSchema(
        modelRequestSchemas,
        'modify',
        modifyModel ?? '',
      ),
      values: modelInputObject(entry.defaultInput.modify_model_input),
    }),
    refineModel,
    refineModelInput: createExampleStepInputFromRequestSchema({
      excludedKeys: MODEL_SCHEMA_KEYS_HANDLED_BY_APP,
      schema: modelRequestSchema(
        modelRequestSchemas,
        'refine',
        refineModel ?? '',
      ),
      values: modelInputObject(entry.defaultInput.refine_model_input),
    }),
    videoModel,
    videoModelInput: createExampleStepInputFromRequestSchema({
      excludedKeys: MODEL_SCHEMA_KEYS_HANDLED_BY_APP,
      schema: modelRequestSchema(modelRequestSchemas, 'video', videoModel),
      values: modelInputObject(entry.defaultInput.video_model_input),
    }),
  });
}

const MODEL_SCHEMA_KEYS_HANDLED_BY_APP = new Set([
  'callback_url',
  'generation_callback_url',
  'generation_model',
  'model',
  'webhook_url',
  'webhook_secret',
]);

function modelRequestSchema(
  schemas: ModelRequestSchemas,
  role: ChainSchemaStepRole,
  modelIdentifier: string,
) {
  return schemas[modelSchemaCacheKey(role, modelIdentifier)] ?? {};
}

function modelInputObject(value: unknown) {
  return isJsonObject(value) ? value : {};
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
