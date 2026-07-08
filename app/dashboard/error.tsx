'use client';

import { FontAwesomeIcon } from '@/components/icons/font-awesome-icon';
import { Button } from '@/components/ui/button';

/**
 * Dashboard error boundary: a transient Aurora/network failure renders a
 * recoverable retry screen instead of the framework's raw error page. State
 * is safe: runs and canvases live server-side, so retrying re-reads them.
 */
export default function DashboardError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="w-full max-w-sm border border-border bg-card p-5 text-center">
        <p className="text-sm font-medium text-foreground">
          Something went wrong loading this page.
        </p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Your canvases and runs are safe in the database. This is usually a
          transient connection issue.
        </p>
        <Button className="mt-4 w-full" size="sm" onClick={() => reset()}>
          <FontAwesomeIcon icon="rotate-left" />
          Try again
        </Button>
      </div>
    </div>
  );
}
