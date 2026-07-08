import { FontAwesomeIcon } from '@/components/icons/font-awesome-icon';
import { InlineMarsha } from '@/components/icons/inline-marsha';
import { InlineGitHub, InlineGitLab } from '@/components/icons/inline-git';

type FooterLink = {
  href: string;
  label: string;
};

type FooterLinkGroup = {
  links: FooterLink[];
  title: string;
};

type SiteFooterProps = {
  brand: string;
  description: string;
  homeHref: string;
  githubPipeline: {
    eyebrow: string;
    href: string;
    label: string;
    text: string;
  };
  linkGroups: FooterLinkGroup[];
  pipeline: {
    eyebrow: string;
    href: string;
    label: string;
    text: string;
  };
};

export function SiteFooter({
  brand,
  description,
  homeHref,
  githubPipeline,
  linkGroups,
  pipeline,
}: SiteFooterProps) {
  return (
    <footer>
      <div className="mx-auto max-w-[1520px] border border-border bg-card">
        <div className="grid border-b border-border lg:grid-cols-3">
          <div className="p-5 md:p-7">
            <a
              className="inline-flex items-center gap-3 text-foreground transition hover:opacity-80"
              href={homeHref}
            >
              <InlineMarsha className="size-9 border border-primary bg-primary" />
              <span className="block text-base font-semibold leading-none tracking-tight">
                {brand}
              </span>
            </a>
            <p className="mt-5 text-xs leading-6 text-muted-foreground xl:text-sm">
              {description}
            </p>
          </div>

          <a
            className="group flex min-h-40 flex-col justify-between border-t border-border p-5 text-foreground transition hover:bg-muted/50 md:p-7 lg:border-l lg:border-t-0"
            href={githubPipeline.href}
            rel="noopener noreferrer"
            target="_blank"
          >
            <span className="flex items-center justify-between gap-4">
              <span className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                {githubPipeline.eyebrow}
              </span>
              <InlineGitHub
                aria-hidden="true"
                className="size-5 text-foreground"
              />
            </span>
            <span>
              <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                {githubPipeline.label}
                <FontAwesomeIcon
                  className="size-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  icon="arrow-up-right-from-square"
                />
              </span>
              <span className="mt-3 block text-sm leading-6 text-muted-foreground">
                {githubPipeline.text}
              </span>
            </span>
          </a>

          <a
            className="group flex min-h-40 flex-col justify-between border-t border-border p-5 text-foreground transition hover:bg-muted/50 md:p-7 lg:border-l lg:border-t-0"
            href={pipeline.href}
            rel="noopener noreferrer"
            target="_blank"
          >
            <span className="flex items-center justify-between gap-4">
              <span className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                {pipeline.eyebrow}
              </span>
              <InlineGitLab aria-hidden="true" className="size-5" />
            </span>
            <span>
              <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                {pipeline.label}
                <FontAwesomeIcon
                  className="size-4 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  icon="arrow-up-right-from-square"
                />
              </span>
              <span className="mt-3 block text-sm leading-6 text-muted-foreground">
                {pipeline.text}
              </span>
            </span>
          </a>
        </div>

        <div className="grid md:grid-cols-3">
          {linkGroups.map((group, index) => (
            <div
              className={`border-border p-5 md:border-l md:border-t-0 md:p-7 md:first:border-l-0 ${
                index === 0 ? '' : 'border-t'
              }`}
              key={group.title}
            >
              <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                {group.title}
              </h2>
              <nav className="mt-5 grid gap-3" aria-label={group.title}>
                {group.links.map((link) => (
                  <a
                    className="group inline-flex items-center justify-between gap-3 text-sm text-foreground underline decoration-border decoration-dotted underline-offset-4 transition hover:text-primary"
                    href={link.href}
                    key={`${group.title}-${link.label}`}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <span>{link.label}</span>
                    <FontAwesomeIcon
                      className="size-3.5 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary"
                      icon="arrow-up-right-from-square"
                    />
                  </a>
                ))}
              </nav>
            </div>
          ))}
        </div>
      </div>
    </footer>
  );
}
