import Link from 'next/link';
import type { ComponentType, SVGProps } from 'react';

import { InlineMarsha } from '@/components/icons/inline-marsha';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { DeployLink } from './deployment-links';
import { SiteHeaderDeployMenu } from './site-header-deploy-menu';

type HeaderAction = {
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  tone?: 'sponsor';
  variant?: 'default' | 'outline' | 'ghost';
};

export function SiteHeader({
  actions,
  backLabel,
  brand,
  deployLinks,
  homeHref,
}: {
  actions: HeaderAction[];
  backLabel?: string;
  brand: string;
  deployLinks?: DeployLink[];
  homeHref: string;
}) {
  return (
    <header className="border-b border-border bg-card">
      <nav className="mx-auto grid max-w-[1520px] grid-cols-[minmax(0,1fr)_auto] items-stretch border-x border-border">
        <Link
          className="flex min-w-0 items-center gap-3 px-4 py-4 md:px-6"
          href={homeHref}
        >
          <InlineMarsha className="size-8 border border-primary bg-primary" />
          <span className="flex min-w-0 items-center">
            <span className="block truncate text-sm font-semibold leading-none tracking-tight text-foreground">
              {backLabel ?? brand}
            </span>
          </span>
        </Link>

        <div className="flex items-center border-l border-border">
          {deployLinks?.length ? (
            <SiteHeaderDeployMenu links={deployLinks} />
          ) : null}

          {actions.map((action) => {
            const Icon = action.icon;
            const isSponsor = action.tone === 'sponsor';

            return (
              <Button
                asChild
                className={cn(
                  'h-full w-12 border-y-0 border-l-0 border-r border-border px-0 last:border-r-0 sm:w-44 sm:px-4',
                  isSponsor &&
                    'border-[#ec4899] bg-[#ec4899] text-black hover:border-[#db2777] hover:bg-[#db2777] hover:text-black',
                )}
                key={`${action.label}-${action.href}`}
                size="sm"
                variant={action.variant ?? 'outline'}
              >
                <a
                  aria-label={action.label}
                  href={action.href}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <Icon aria-hidden="true" />
                  <span className="hidden sm:inline">{action.label}</span>
                </a>
              </Button>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
