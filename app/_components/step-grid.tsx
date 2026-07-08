import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TemplateStepView } from '@/app/templates/synthesize-entry';
import { FontAwesomeIcon } from '@/components/icons/font-awesome-icon';
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
import { formatPublicModelName } from '@/lib/models/display';

const STEP_ANIMATION_DELAY_MS = 420;
const MODEL_BADGE_CLASS = 'gap-2 px-3 py-2 text-sm normal-case tracking-normal';
const MODEL_BADGE_ICON_CLASS = 'size-4 shrink-0';

export function StepGrid({
  labels,
  modelIdentifiers,
  steps,
}: {
  labels: {
    dependencyPrefix: string;
    indexPrefix: string;
    rootDependency: string;
  };
  modelIdentifiers: string[];
  steps: TemplateStepView[];
}) {
  return (
    <div className="mt-8 grid gap-4 lg:grid-cols-4">
      {steps.map((step, index) => {
        const animationDelay = `${index * STEP_ANIMATION_DELAY_MS}ms`;
        const connectorDelay = `${(index + 1) * STEP_ANIMATION_DELAY_MS}ms`;

        return (
          <div className="relative" key={step.key}>
            <Card
              className="relative overflow-hidden border border-border bg-card shadow-none [animation:app-step-wait_2.8s_ease-in-out_infinite] motion-reduce:[animation:none]"
              style={{ animationDelay }}
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--chain-accent),transparent)] [animation:app-energy-flow_2.4s_linear_infinite] motion-reduce:[animation:none]"
                style={{ animationDelay }}
              />
              <CardHeader>
                <Badge
                  className="inline-flex min-h-9 items-center gap-2 px-3 py-1.5 leading-none"
                  variant="muted"
                >
                  <FontAwesomeIcon
                    className="size-4 shrink-0 animate-spin text-[var(--chain-accent)] motion-reduce:animate-none"
                    icon="spinner"
                    style={{ animationDelay }}
                  />
                  <span className="leading-none">
                    {labels.indexPrefix} {index + 1}
                  </span>
                </Badge>
                <CardTitle className="mt-3 text-lg">{step.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <ModelBadge
                  modelIdentifier={modelIdentifiers[index] ?? step.model}
                />
                <p className="mt-4 text-sm leading-6 text-muted-foreground">
                  {labels.dependencyPrefix}{' '}
                  {step.dependsOn.length > 0
                    ? step.dependsOn.join(', ')
                    : labels.rootDependency}
                  .
                </p>
              </CardContent>
            </Card>

            {index < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className="absolute left-6 top-full h-4 w-px overflow-hidden bg-border lg:left-full lg:top-1/2 lg:h-px lg:w-4 lg:-translate-y-1/2"
              >
                <span
                  className="absolute inset-0 bg-[linear-gradient(180deg,transparent,var(--chain-accent),transparent)] [animation:app-energy-flow-y_1.6s_linear_infinite] motion-reduce:[animation:none] lg:bg-[linear-gradient(90deg,transparent,var(--chain-accent),transparent)] lg:[animation:app-energy-flow_1.6s_linear_infinite]"
                  style={{ animationDelay: connectorDelay }}
                />
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

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

function ModelBadge({ modelIdentifier }: { modelIdentifier: string }) {
  const modelIcon = getModelIcon(modelIdentifier);

  return (
    <Badge className={MODEL_BADGE_CLASS} variant="outline">
      {renderModelIcon(modelIcon)}
      {formatPublicModelName(modelIdentifier)}
    </Badge>
  );
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
  const className = MODEL_BADGE_ICON_CLASS;

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
