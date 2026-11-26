'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@/components/ui/button';

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Render the confirm action with the destructive (red) button variant. */
  destructive?: boolean;
};

/**
 * Promise-based confirmation built on the project's shadcn primitives, a drop
 * in replacement for `window.confirm` that matches the app's styling and is
 * keyboard accessible (Escape cancels, focus is restored to the trigger).
 *
 * ```tsx
 * const [confirm, confirmDialog] = useConfirm();
 * // ...render {confirmDialog} once, then:
 * if (await confirm({ title: 'Delete?', destructive: true })) remove();
 * ```
 */
export function useConfirm(): [
  (options: ConfirmOptions) => Promise<boolean>,
  React.ReactNode,
] {
  const [options, setOptions] = React.useState<ConfirmOptions | null>(null);
  const resolverRef = React.useRef<((value: boolean) => void) | null>(null);
  const triggerRef = React.useRef<HTMLElement | null>(null);

  const confirm = React.useCallback((next: ConfirmOptions) => {
    // Capture the element that opened the dialog so focus can return to it.
    triggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setOptions(next);

    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = React.useCallback((value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setOptions(null);
    triggerRef.current?.focus?.();
    triggerRef.current = null;
  }, []);

  const onConfirm = React.useCallback(() => settle(true), [settle]);
  const onCancel = React.useCallback(() => settle(false), [settle]);

  const dialog = (
    <ConfirmDialog
      options={options}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );

  return [confirm, dialog];
}

function ConfirmDialog({
  options,
  onConfirm,
  onCancel,
}: {
  options: ConfirmOptions | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const open = options !== null;

  React.useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onCancel]);

  if (!options) return null;

  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby={
        options.description ? 'confirm-dialog-description' : undefined
      }
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label={options.cancelLabel ?? 'Cancel'}
        tabIndex={-1}
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-black/70"
      />
      <div className="relative z-10 w-full max-w-md border border-border bg-background p-5 shadow-lg">
        <h2
          id="confirm-dialog-title"
          className="text-base font-semibold leading-6 text-foreground"
        >
          {options.title}
        </h2>
        {options.description ? (
          <p
            id="confirm-dialog-description"
            className="mt-2 text-sm leading-6 text-muted-foreground"
          >
            {options.description}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button autoFocus size="sm" variant="outline" onClick={onCancel}>
            {options.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            size="sm"
            variant={options.destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
          >
            {options.confirmLabel ?? 'Confirm'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
