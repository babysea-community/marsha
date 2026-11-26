import Link from 'next/link';
import type { ComponentType, SVGProps } from 'react';

import { createFontAwesomeIcon } from '@/components/icons/font-awesome-icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

import { DeploymentLinks, type DeployLink } from './deployment-links';
import { HomepageDeployMenu } from './homepage-deploy-menu';
import { MetricStrip } from './metric-strip';

type HeroAction = {
  href: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  variant: 'default' | 'outline';
};

const ArrowRightIcon = createFontAwesomeIcon('arrow-right');

export function HomepageHero({
  actions,
  description,
  eyebrow,
  metrics,
  console,
  title,
}: {
  actions: HeroAction[];
  console: {
    deployLinks?: DeployLink[];
    deployTitle?: string;
    lines: string[];
    title: string;
  };
  description: string;
  eyebrow: string;
  metrics: Array<{ label: string; value: string }>;
  title: string;
}) {
  return (
    <section>
      <div className="mx-auto max-w-[1520px] border border-border bg-card shadow-xl">
        <div className="grid min-h-[calc(100svh-7rem)] lg:grid-cols-[minmax(0,1fr)_36rem]">
          <div className="flex flex-col justify-center border-b border-border p-5 md:p-10 lg:border-b-0 lg:border-r lg:p-12">
            <Badge
              className="inline-flex h-11 items-center px-4 py-0 leading-none"
              variant="muted"
            >
              {eyebrow}
            </Badge>

            <h1 className="mt-8 max-w-5xl text-4xl font-semibold tracking-tight text-foreground md:text-6xl lg:text-7xl">
              {title === 'Every output becomes the next input.' ? (
                <>
                  Every <span className="text-primary">output</span> becomes the
                  next <span className="text-primary">input</span>.
                </>
              ) : (
                title
              )}
            </h1>

            <p className="mt-6 max-w-3xl text-base leading-8 text-muted-foreground md:text-lg">
              {description}
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <HomepageDeployMenu links={console.deployLinks ?? []} />

              {actions.map((action) => {
                const Icon = action.icon ?? ArrowRightIcon;

                return (
                  <Button
                    asChild
                    className="w-full justify-between sm:w-auto"
                    key={`${action.label}-${action.href}`}
                    size="lg"
                    variant={action.variant}
                  >
                    <Link href={action.href}>
                      {action.label}
                      <Icon aria-hidden="true" />
                    </Link>
                  </Button>
                );
              })}
            </div>

            <div className="mt-12 border-t border-border pt-5">
              <MetricStrip metrics={metrics} />
            </div>
          </div>

          <div className="flex flex-col gap-5 bg-muted/40 p-5 md:p-7">
            <Card className="bg-card">
              <CardContent className="flex flex-col p-0">
                <div className="border-b border-border px-5 py-4 font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  {console.title}
                </div>
                <div className="flex flex-1 flex-col justify-start p-5 font-mono text-sm">
                  {console.lines.map((line, index) => (
                    <div
                      className="grid grid-cols-[2.5rem_1fr] border-b border-border py-4 last:border-b-0"
                      key={`${line}-${index}`}
                    >
                      <span className="text-muted-foreground">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="break-words text-foreground">
                        {line}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {console.deployLinks?.length ? (
              <Card className="bg-card">
                <CardContent className="p-0">
                  <div className="border-b border-border px-5 py-4 font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    {console.deployTitle ?? 'Marsha deployment'}
                  </div>
                  <DeploymentLinks links={console.deployLinks} />
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
