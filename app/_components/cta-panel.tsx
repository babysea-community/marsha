import Link from 'next/link';
import type { ComponentType, SVGProps } from 'react';

import { createFontAwesomeIcon } from '@/components/icons/font-awesome-icon';
import { Button } from '@/components/ui/button';

import type { DeployLink } from './deployment-links';
import { HomepageDeployMenu } from './homepage-deploy-menu';

type CtaAction = {
  href: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  variant: 'default' | 'outline';
};

const ArrowRightIcon = createFontAwesomeIcon('arrow-right');

export function CtaPanel({
  actions,
  deployLinks,
  description,
  eyebrow,
  title,
}: {
  actions: CtaAction[];
  deployLinks?: DeployLink[];
  description: string;
  eyebrow?: string;
  title: string;
}) {
  return (
    <section>
      <div className="mx-auto grid max-w-[1520px] border border-border bg-card md:grid-cols-2 xl:grid-cols-3">
        <div className="p-5 md:p-8 xl:col-span-2">
          {eyebrow ? (
            <div className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
              {eyebrow}
            </div>
          ) : null}
          <h2 className="mt-4 max-w-4xl text-3xl font-semibold tracking-tight text-foreground md:text-5xl">
            {title === 'Design on the canvas. Ship the API.' ? (
              <>
                Design on the <span className="text-primary">canvas</span>. Ship
                the <span className="text-primary">API</span>.
              </>
            ) : (
              title
            )}
          </h2>
          <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground">
            {description}
          </p>
        </div>
        <div className="flex flex-col items-stretch justify-center gap-3 border-t border-border p-5 md:border-l md:border-t-0 md:p-8">
          {actions.map((action) => {
            const Icon = action.icon ?? ArrowRightIcon;

            return (
              <Button
                asChild
                className="w-full justify-between"
                key={`${action.label}-${action.href}`}
                size="lg"
                variant={action.variant}
              >
                <Link
                  href={action.href}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {action.label}
                  <Icon aria-hidden="true" />
                </Link>
              </Button>
            );
          })}

          {deployLinks?.length ? (
            <HomepageDeployMenu
              className="relative w-full"
              links={deployLinks}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
