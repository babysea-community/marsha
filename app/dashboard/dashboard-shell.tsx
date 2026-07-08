'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { FontAwesomeIcon } from '@/components/icons/font-awesome-icon';
import { ProtectedImage } from '@/components/protected-image';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type DashboardShellProps = {
  children: React.ReactNode;
  signOutAction: () => Promise<void>;
};

const NAV_ITEMS = [
  { href: '/dashboard/chain', icon: 'diagram-project', label: 'Chain' },
  { href: '/dashboard/library', icon: 'lines-leaning', label: 'Library' },
  { href: '/dashboard/profile', icon: 'user-astronaut', label: 'Profile' },
];

export function DashboardShell({
  children,
  signOutAction,
}: DashboardShellProps) {
  const pathname = usePathname();
  const fullScreenCanvas = /^\/dashboard\/chain\/[^/]+$/.test(pathname);

  // One stable element tree for both layouts: only the sidebar toggles.
  // Returning a different tree shape per route would unmount the children
  // (and kill any in-flight canvas run: poll timer, step statuses, outputs)
  // when the route changes between canvas views.
  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {fullScreenCanvas ? null : (
        <aside className="flex h-full w-56 shrink-0 flex-col border-r border-border bg-sidebar">
          <div className="flex h-16 items-center gap-2.5 border-b border-border px-3">
            <ProtectedImage
              src="/icon.png"
              alt="Marsha"
              width={32}
              height={32}
              className="size-8 border border-border bg-card object-contain"
            />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-semibold tracking-tight">
                Marsha
              </p>
              <p className="text-[0.7rem] uppercase tracking-[0.14em] text-muted-foreground">
                Studio
              </p>
            </div>
          </div>

          <nav className="flex flex-1 flex-col gap-1 p-3">
            {NAV_ITEMS.map((item) => {
              const active =
                pathname === item.href ||
                (item.href === '/dashboard/chain' &&
                  pathname.startsWith('/dashboard/chain/'));

              return (
                <Link
                  className={cn(
                    'flex items-center gap-2.5 border px-3 py-2 text-sm transition',
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-transparent text-muted-foreground hover:border-border hover:bg-card hover:text-foreground',
                  )}
                  href={item.href}
                  key={item.href}
                  title={item.label}
                >
                  <FontAwesomeIcon className="size-4" icon={item.icon} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-border p-3">
            <form action={signOutAction}>
              <Button
                aria-label="Sign out"
                type="submit"
                variant="outline"
                size="sm"
                className="flex h-auto w-full items-center justify-center gap-2 border-border px-3 py-2 text-sm font-medium text-muted-foreground transition hover:border-destructive/60 hover:bg-destructive/10 hover:text-foreground"
                title="Sign out"
              >
                <FontAwesomeIcon className="size-4" icon="right-from-bracket" />
                Sign out
              </Button>
            </form>
          </div>
        </aside>
      )}

      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
