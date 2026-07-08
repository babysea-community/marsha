import type { Metadata } from 'next';
import { revalidatePath } from 'next/cache';

import { requireOwnerSession } from '@/lib/auth/owner';
import {
  deleteCanvas,
  listCanvases,
  renameCanvas,
} from '@/lib/canvas/canvas-store';

import { LibraryClient } from './library-client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Library' };

async function deleteCanvasAction(
  canvasId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  'use server';
  const session = await requireOwnerSession();

  try {
    const deleted = await deleteCanvas(session.email, canvasId);

    if (!deleted) {
      return { ok: false, error: 'Canvas was not found.' };
    }

    revalidatePath('/dashboard/library');
    return { ok: true };
  } catch {
    return { ok: false, error: 'Deleting the canvas failed. Try again.' };
  }
}

async function renameCanvasAction(
  canvasId: string,
  title: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  'use server';
  const session = await requireOwnerSession();

  try {
    const renamed = await renameCanvas(session.email, canvasId, title);

    if (!renamed) {
      return { ok: false, error: 'Canvas was not found.' };
    }

    revalidatePath('/dashboard/library');
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && error.message
          ? error.message
          : 'Renaming the canvas failed. Try again.',
    };
  }
}

export default async function LibraryPage() {
  const session = await requireOwnerSession();
  const canvases = await listCanvases(session.email).catch(() => null);

  return (
    <LibraryClient
      canvases={canvases ?? []}
      loadFailed={canvases === null}
      deleteCanvasAction={deleteCanvasAction}
      renameCanvasAction={renameCanvasAction}
    />
  );
}
