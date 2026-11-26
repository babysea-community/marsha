import type { XYPosition } from '@xyflow/react';

/**
 * Canvas shapes shared by the dashboard canvas, the library, and the Aurora
 * canvas store. All canvas state lives in AWS Aurora (see
 * `lib/canvas/canvas-store.ts`): saved canvases as library rows and the
 * always-on workspace canvas as one owner-scoped row, so the canvas page
 * survives reloads, logout/login, and device switches.
 */

export type StoredCanvasNode = {
  id: string;
  role: string;
  modelId: string;
  /** Flow (chain) this node belongs to. */
  flowId: string;
  values: Record<string, string | number | boolean>;
  position: XYPosition;
};

export type StoredCanvas = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  runId: string | null;
  nodes: StoredCanvasNode[];
};

export function createCanvasId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // RFC 4122 v4 fallback for non-secure contexts.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
