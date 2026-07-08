import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';

export function SectionHeading({
  align = 'left',
  description,
  descriptionContent,
  eyebrow,
  title,
  maxWidthClass = 'max-w-3xl',
}: {
  align?: 'left' | 'center';
  description?: string;
  descriptionContent?: ReactNode;
  eyebrow?: string;
  title: string;
  maxWidthClass?: string;
}) {
  return (
    <div
      className={
        align === 'center'
          ? `mx-auto ${maxWidthClass} text-center`
          : maxWidthClass
      }
    >
      {eyebrow ? <Badge variant="muted">{eyebrow}</Badge> : null}
      <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground md:text-5xl">
        {title === 'Orchestrate model-to-model workflows.' ? (
          <>
            Orchestrate <span className="text-primary">model-to-model</span>{' '}
            workflows.
          </>
        ) : title === 'Self-hosted with your own keys and environment.' ? (
          <>
            <span className="text-primary">Self-hosted</span> with your own keys
            and environment.
          </>
        ) : title ===
          'Design and chain your canvas with an agentic planner.' ? (
          <>
            <span className="text-primary">Design</span> and{' '}
            <span className="text-primary">chain</span> your canvas
            <br />
            with an <span className="text-primary">agentic</span> planner.
          </>
        ) : title === 'Persist and replay every run on a durable database.' ? (
          <>
            Persist and replay <span className="text-primary">every run</span>
            <br />
            on a <span className="text-primary">durable</span> database.
          </>
        ) : title === 'We are part of the AI community.' ? (
          <>
            We are part of{' '}
            <span className="text-primary">the AI community</span>.
          </>
        ) : title === 'Huge thanks for the support.' ? (
          <>
            <span className="text-primary">Huge thanks</span> for the support.
          </>
        ) : (
          title
        )}
      </h2>
      {(descriptionContent ?? description) ? (
        <p className="mt-4 text-base leading-7 text-muted-foreground md:text-lg">
          {descriptionContent ?? description}
        </p>
      ) : null}
    </div>
  );
}
