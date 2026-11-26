'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { FontAwesomeIcon } from '@/components/icons/font-awesome-icon';
import {
  InlineAlibabaCloudECS,
  InlineAwsCloudFormation,
  InlineAwsEC2,
  InlineCoolify,
  InlineDigitalOcean,
  InlineDocker,
  InlineFlyIo,
  InlineGoogleCloudRun,
  InlineNetlifyLight,
  InlineRailwayLight,
  InlineRenderLight,
  InlineVercelLight,
} from '@/components/icons/inline-host';
import { Button } from '@/components/ui/button';

import { groupDeployLinks, type DeployLink } from './deployment-links';

export function SiteHeaderDeployMenu({ links }: { links: DeployLink[] }) {
  const activeLinks = links.filter(
    (link) => link.href && link.status !== 'under-development',
  );
  const linkGroups = groupDeployLinks(activeLinks);
  const [isOpen, setOpen] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  if (activeLinks.length === 0) {
    return null;
  }

  return (
    <div className="relative h-full w-12 sm:w-56" ref={containerRef}>
      <Button
        aria-controls={menuId}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="Deploy options"
        className="h-full w-full border-y-0 border-l-0 border-r border-border px-0 sm:px-4"
        onClick={() => setOpen((value) => !value)}
        size="sm"
        type="button"
        variant="default"
      >
        <FontAwesomeIcon icon="plane-departure" />
        <span className="hidden sm:inline">Deploy options</span>
      </Button>

      {isOpen ? (
        <div
          className="absolute right-0 top-full z-50 mt-2 w-56 max-w-[calc(100vw-1rem)] border border-border bg-card p-1 shadow-xl sm:w-full"
          id={menuId}
          role="menu"
        >
          {linkGroups.map((group, groupIndex) => {
            const groupLabelId = `${menuId}-${groupIndex}`;

            return (
              <div
                aria-labelledby={groupLabelId}
                className={
                  groupIndex === 0
                    ? undefined
                    : 'mt-1 border-t border-border pt-1'
                }
                key={group.title}
                role="group"
              >
                <div
                  className="px-3 pb-1 pt-2 text-xs font-semibold text-muted-foreground"
                  id={groupLabelId}
                >
                  {group.title}
                </div>
                {group.links.map((link) => (
                  <a
                    className="flex h-10 items-center justify-between gap-3 px-3 text-sm text-foreground outline-none transition hover:bg-muted focus:bg-muted"
                    href={link.href}
                    key={link.label}
                    onClick={() => setOpen(false)}
                    rel="noreferrer"
                    role="menuitem"
                    target="_blank"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {renderHostIcon(link.label)}
                      <span className="truncate">
                        {deployHostLabel(link.label)}
                      </span>
                    </span>
                    <FontAwesomeIcon
                      className="size-3.5 shrink-0"
                      icon="arrow-up-right-from-square"
                    />
                  </a>
                ))}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function deployHostLabel(label: string) {
  return label
    .replace(/^Deploy on /, '')
    .replace(/^Deploy with /, '')
    .replace(/^Run on /, '');
}

function renderHostIcon(label: string) {
  const iconClassName = 'size-3.5 shrink-0';
  const hostLabel = deployHostLabel(label);

  switch (hostLabel) {
    case 'Alibaba Cloud ECS':
      return (
        <InlineAlibabaCloudECS className={iconClassName} aria-hidden="true" />
      );
    case 'AWS CloudFormation':
      return (
        <InlineAwsCloudFormation className={iconClassName} aria-hidden="true" />
      );
    case 'AWS EC2':
      return <InlineAwsEC2 className={iconClassName} aria-hidden="true" />;
    case 'Coolify':
      return <InlineCoolify className={iconClassName} aria-hidden="true" />;
    case 'DigitalOcean':
      return (
        <InlineDigitalOcean className={iconClassName} aria-hidden="true" />
      );
    case 'Docker':
      return <InlineDocker className={iconClassName} aria-hidden="true" />;
    case 'Fly.io':
      return <InlineFlyIo className={iconClassName} aria-hidden="true" />;
    case 'Google Cloud Run':
      return (
        <InlineGoogleCloudRun className={iconClassName} aria-hidden="true" />
      );
    case 'Netlify':
      return (
        <InlineNetlifyLight className={iconClassName} aria-hidden="true" />
      );
    case 'Railway':
      return (
        <InlineRailwayLight className={iconClassName} aria-hidden="true" />
      );
    case 'Render':
      return <InlineRenderLight className={iconClassName} aria-hidden="true" />;
    case 'Vercel':
      return <InlineVercelLight className={iconClassName} aria-hidden="true" />;
    default:
      return (
        <FontAwesomeIcon
          className={iconClassName}
          icon="arrow-up-right-from-square"
        />
      );
  }
}
