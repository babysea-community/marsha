'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { FontAwesomeIcon } from '@/components/icons/font-awesome-icon';
import {
  InlineAwsCloudFormation,
  InlineAwsEC2,
  InlineAlibabaCloudECS,
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

export type DeployLink = {
  href?: string;
  label: string;
  status?: 'under-development';
};

export type DeployLinkGroup = {
  links: DeployLink[];
  title: 'ONE-CLICK DEPLOY' | 'CUSTOM DEPLOY';
};

const ONE_CLICK_DEPLOY_LABELS = new Set([
  'DigitalOcean',
  'Netlify',
  'Railway',
  'Render',
  'Vercel',
]);

const TOAST_MESSAGE = 'Under development';

export function groupDeployLinks(links: DeployLink[]): DeployLinkGroup[] {
  return [
    {
      title: 'ONE-CLICK DEPLOY' as const,
      links: links.filter((link) => ONE_CLICK_DEPLOY_LABELS.has(link.label)),
    },
    {
      title: 'CUSTOM DEPLOY' as const,
      links: links.filter((link) => !ONE_CLICK_DEPLOY_LABELS.has(link.label)),
    },
  ].filter((group) => group.links.length > 0);
}

export function DeploymentLinks({ links }: { links: DeployLink[] }) {
  const [isToastVisible, setToastVisible] = useState(false);
  const [toastKey, setToastKey] = useState(0);
  const splitIndex = Math.ceil(links.length / 2);
  const linkColumns = [links.slice(0, splitIndex), links.slice(splitIndex)];

  useEffect(() => {
    if (!isToastVisible) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setToastVisible(false);
    }, 2400);

    return () => window.clearTimeout(timeoutId);
  }, [isToastVisible, toastKey]);

  const renderDeployLink = (deployLink: DeployLink) => {
    const href = deployLink.href;
    const isUnderDevelopment =
      deployLink.status === 'under-development' || !href;

    return (
      <div
        className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-1.5"
        key={deployLink.label}
      >
        <span
          aria-hidden="true"
          className="flex size-4 items-center justify-center text-foreground"
          title={deployLink.label}
        >
          {renderDeployIcon(deployLink.label)}
        </span>

        {isUnderDevelopment ? (
          <button
            className="inline-flex min-w-0 items-center gap-1.5 text-left text-foreground underline decoration-dotted underline-offset-4 transition hover:opacity-80"
            onClick={() => {
              setToastKey((key) => key + 1);
              setToastVisible(true);
            }}
            title={`${deployLink.label}: ${TOAST_MESSAGE}`}
            type="button"
          >
            <span>{deployLink.label}</span>
            <FontAwesomeIcon className="size-3" icon="triangle-exclamation" />
          </button>
        ) : (
          <Link
            className="inline-flex min-w-0 items-center gap-1.5 text-foreground underline decoration-dotted underline-offset-4 transition hover:opacity-80"
            href={href}
            rel="noreferrer"
            target="_blank"
            title={deployLink.label}
          >
            <span>{deployLink.label}</span>
            <FontAwesomeIcon
              className="size-3"
              icon="arrow-up-right-from-square"
            />
          </Link>
        )}
      </div>
    );
  };

  return (
    <div className="relative">
      <div className="grid gap-x-5 gap-y-3 p-5 font-mono text-xs sm:grid-cols-2">
        {linkColumns.map((columnLinks, columnIndex) => (
          <div
            className="grid content-start gap-y-3"
            key={columnIndex === 0 ? 'left-column' : 'right-column'}
          >
            {columnLinks.map(renderDeployLink)}
          </div>
        ))}
      </div>

      {isToastVisible ? (
        <div
          aria-live="polite"
          className="pointer-events-none fixed left-1/2 top-4 z-50 inline-flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 border border-border bg-background px-3 py-2 font-mono text-xs text-foreground shadow-xl"
          role="status"
        >
          <FontAwesomeIcon
            className="size-4 text-[#d98026]"
            icon="triangle-exclamation"
          />
          <span>{TOAST_MESSAGE}</span>
        </div>
      ) : null}
    </div>
  );
}

function renderDeployIcon(label: string) {
  const iconClassName = 'size-4';

  switch (label) {
    case 'Alibaba Cloud ECS':
      return <InlineAlibabaCloudECS className={iconClassName} />;
    case 'AWS CloudFormation':
      return <InlineAwsCloudFormation className={iconClassName} />;
    case 'AWS EC2':
      return <InlineAwsEC2 className={iconClassName} />;
    case 'Coolify':
      return <InlineCoolify className={iconClassName} />;
    case 'DigitalOcean':
      return <InlineDigitalOcean className={iconClassName} />;
    case 'Docker':
      return <InlineDocker className={iconClassName} />;
    case 'Fly.io':
      return <InlineFlyIo className={iconClassName} />;
    case 'Google Cloud Run':
      return <InlineGoogleCloudRun className={iconClassName} />;
    case 'Netlify':
      return <InlineNetlifyLight className={iconClassName} />;
    case 'Railway':
      return <InlineRailwayLight className={iconClassName} />;
    case 'Render':
      return <InlineRenderLight className={iconClassName} />;
    case 'Vercel':
      return <InlineVercelLight className={iconClassName} />;
    default:
      return (
        <FontAwesomeIcon
          className={iconClassName}
          icon="arrow-up-right-from-square"
        />
      );
  }
}
