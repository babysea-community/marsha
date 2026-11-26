import { FontAwesomeIcon } from '@/components/icons/font-awesome-icon';

/**
 * Shared loading state for dashboard pages. The library and canvas pages
 * read from Aurora on the server, so this paints immediately while data
 * loads instead of leaving a blank pane.
 */
export default function DashboardLoading() {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
        <FontAwesomeIcon icon="spinner" className="size-4 animate-spin" />
        Loading…
      </div>
    </div>
  );
}
