import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoredCanvasNode } from '@/lib/canvas/canvas-library';
import { AppError } from '@/lib/utils/errors';

const queryMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/database', () => ({
  dbQuery: queryMock,
}));

const deleteRunStoredAssetsMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/storage', () => ({
  deleteRunStoredAssets: deleteRunStoredAssetsMock,
}));

import {
  deleteCanvas,
  getCanvas,
  getWorkspaceCanvas,
  listCanvases,
  recordWorkspaceFlowRun,
  renameCanvas,
  saveCanvas,
  saveWorkspaceCanvas,
} from '@/lib/canvas/canvas-store';
import { MAX_CANVAS_TITLE_LENGTH } from '@/lib/canvas/names';

const OWNER = 'owner@example.com';
const CANVAS_ID = '7b9d3f60-1f7c-4a64-9a52-0d6f6a3a2b11';
const RUN_ID = '10f7f30d-c59f-4d10-aa1f-77f285922ef8';
const SAVE_VERSION = 1000;

function node(overrides: Partial<StoredCanvasNode> = {}): StoredCanvasNode {
  return {
    id: 'image-1',
    role: 'image',
    modelId: 'bfl/flux-1.1-pro',
    flowId: 'flow_default',
    values: { generation_prompt: 'A product render' },
    position: { x: 10, y: 20 },
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: CANVAS_ID,
    title: 'Canvas',
    nodes: [node()],
    save_version: SAVE_VERSION,
    created_at: new Date('2026-06-01T00:00:00Z'),
    updated_at: new Date('2026-06-02T00:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  queryMock.mockReset();
  deleteRunStoredAssetsMock.mockReset();
  deleteRunStoredAssetsMock.mockResolvedValue(undefined);
});

describe('saveCanvas', () => {
  it('inserts the canvas scoped to the owner and returns the stored shape', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [row()] });

    const saved = await saveCanvas('  Owner@Example.com ', {
      id: CANVAS_ID,
      title: 'Canvas',
      nodes: [node()],
      saveVersion: SAVE_VERSION,
    });

    expect(saved.id).toBe(CANVAS_ID);
    expect(saved.nodes).toEqual([node()]);
    expect(saved.createdAt).toBe('2026-06-01T00:00:00.000Z');

    const upsert = queryMock.mock.calls[1];
    expect(upsert?.[0]).toContain('on conflict (id) do update');
    expect(upsert?.[0]).toContain('owner_email = excluded.owner_email');
    expect(upsert?.[0]).toContain('run_id = coalesce');
    expect(upsert?.[1]?.[1]).toBe(OWNER);
    expect(upsert?.[1]?.[5]).toBeNull();
  });

  it('can attach the latest run id while saving a canvas', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [row({ run_id: RUN_ID })] });

    const saved = await saveCanvas(OWNER, {
      id: CANVAS_ID,
      runId: RUN_ID,
      title: 'Canvas',
      nodes: [node()],
      saveVersion: SAVE_VERSION,
    });

    expect(saved.runId).toBe(RUN_ID);
    expect(queryMock.mock.calls[1]?.[1]?.[5]).toBe(RUN_ID);
  });

  it('rejects invalid last run ids before touching the database', async () => {
    await expect(
      saveCanvas(OWNER, {
        id: CANVAS_ID,
        runId: 'not-a-run-id',
        title: 'Canvas',
        nodes: [node()],
        saveVersion: SAVE_VERSION,
      }),
    ).rejects.toMatchObject({ code: 'invalid_canvas', status: 400 });

    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects non-UUID canvas ids before touching the database', async () => {
    await expect(
      saveCanvas(OWNER, {
        id: 'canvas_legacy_1',
        title: 'x',
        nodes: [node()],
        saveVersion: SAVE_VERSION,
      }),
    ).rejects.toMatchObject({ code: 'invalid_canvas', status: 400 });

    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects empty and oversized node lists', async () => {
    await expect(
      saveCanvas(OWNER, {
        id: CANVAS_ID,
        title: 'x',
        nodes: [],
        saveVersion: SAVE_VERSION,
      }),
    ).rejects.toMatchObject({ code: 'invalid_canvas' });

    const tooMany = Array.from({ length: 25 }, (_, index) =>
      node({ id: `n-${index}` }),
    );
    await expect(
      saveCanvas(OWNER, {
        id: CANVAS_ID,
        title: 'x',
        nodes: tooMany,
        saveVersion: SAVE_VERSION,
      }),
    ).rejects.toMatchObject({ code: 'invalid_canvas' });

    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects canvases whose serialized nodes exceed the byte budget', async () => {
    const huge = node({
      values: { generation_prompt: 'p'.repeat(70 * 1024) },
    });

    await expect(
      saveCanvas(OWNER, {
        id: CANVAS_ID,
        title: 'x',
        nodes: [huge],
        saveVersion: SAVE_VERSION,
      }),
    ).rejects.toMatchObject({ code: 'invalid_canvas' });
  });

  it('strips non-scalar values and normalizes positions', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [row()] });

    await saveCanvas(OWNER, {
      id: CANVAS_ID,
      title: 'Canvas',
      nodes: [
        node({
          values: {
            keep: 'yes',
            nested: { evil: true },
            fn: undefined,
          } as unknown as StoredCanvasNode['values'],
          position: { x: Number.NaN, y: 5 },
        }),
      ],
      saveVersion: SAVE_VERSION,
    });

    const storedNodes = JSON.parse(
      queryMock.mock.calls[1]?.[1]?.[3] as string,
    ) as StoredCanvasNode[];
    expect(storedNodes[0]?.values).toEqual({ keep: 'yes' });
    expect(storedNodes[0]?.position).toEqual({ x: 0, y: 5 });
  });

  it('truncates saved canvas titles to 40 characters', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [row()] });

    await saveCanvas(OWNER, {
      id: CANVAS_ID,
      title: 'a'.repeat(MAX_CANVAS_TITLE_LENGTH + 1),
      nodes: [node()],
      saveVersion: SAVE_VERSION,
    });

    expect(queryMock.mock.calls[1]?.[1]?.[2]).toBe(
      'a'.repeat(MAX_CANVAS_TITLE_LENGTH),
    );
  });

  it('enforces the per-owner canvas limit', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ total: '200' }] });

    await expect(
      saveCanvas(OWNER, {
        id: CANVAS_ID,
        title: 'x',
        nodes: [node()],
        saveVersion: SAVE_VERSION,
      }),
    ).rejects.toMatchObject({ code: 'canvas_limit_reached', status: 400 });

    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('reports not-found when the id belongs to another owner', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      saveCanvas(OWNER, {
        id: CANVAS_ID,
        title: 'x',
        nodes: [node()],
        saveVersion: SAVE_VERSION,
      }),
    ).rejects.toMatchObject({ code: 'canvas_not_found', status: 404 });
  });

  it('treats stale saved-canvas writes as already superseded', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ total: '0' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [row({ save_version: SAVE_VERSION + 1 })],
      });

    const saved = await saveCanvas(OWNER, {
      id: CANVAS_ID,
      title: 'old title',
      nodes: [node()],
      saveVersion: SAVE_VERSION,
    });

    expect(saved.id).toBe(CANVAS_ID);
    expect(queryMock.mock.calls[1]?.[0]).toContain(
      'save_version < excluded.save_version',
    );
  });

  it('rejects malformed nodes', async () => {
    await expect(
      saveCanvas(OWNER, {
        id: CANVAS_ID,
        title: 'x',
        nodes: [{ bogus: true } as unknown as StoredCanvasNode],
        saveVersion: SAVE_VERSION,
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe('getCanvas/listCanvases/deleteCanvas', () => {
  it('scopes reads by owner email and returns null for missing rows', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    expect(await getCanvas(OWNER, CANVAS_ID)).toBeNull();
    expect(queryMock.mock.calls[0]?.[0]).toContain('owner_email = $1');
    expect(queryMock.mock.calls[0]?.[1]).toEqual([OWNER, CANVAS_ID]);
  });

  it('short-circuits non-UUID ids without querying', async () => {
    expect(await getCanvas(OWNER, '../etc/passwd')).toBeNull();
    expect(await deleteCanvas(OWNER, 'not-a-uuid')).toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('lists canvases ordered by recency, scoped to the owner', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [row({ model_ids: ['bfl/flux-1.1-pro', 'google/veo-3'] })],
    });

    const canvases = await listCanvases(OWNER);

    expect(canvases).toHaveLength(1);
    expect(canvases[0]?.updatedAt).toBe('2026-06-02T00:00:00.000Z');
    expect(canvases[0]?.modelIds).toEqual(['bfl/flux-1.1-pro', 'google/veo-3']);
    expect(canvases[0]?.resultPreviews).toEqual([]);
    expect(queryMock.mock.calls[0]?.[0]).toContain('as model_ids');
    expect(queryMock.mock.calls[0]?.[0]).toContain(
      'order by c.created_at desc',
    );
    expect(queryMock.mock.calls[0]?.[0]).toContain('owner_email = $1');
    expect(queryMock.mock.calls[0]?.[1]?.[0]).toBe(OWNER);
  });

  it('reports whether a delete removed a row', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ run_id: null }] });
    expect(await deleteCanvas(OWNER, CANVAS_ID)).toBe(true);
    expect(deleteRunStoredAssetsMock).not.toHaveBeenCalled();

    queryMock.mockResolvedValueOnce({ rows: [] });
    expect(await deleteCanvas(OWNER, CANVAS_ID)).toBe(false);
  });

  it('removes stored assets for the last run but keeps the history rows', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ run_id: RUN_ID }] });

    const deleted = await deleteCanvas(OWNER, CANVAS_ID);

    expect(deleted).toBe(true);
    // The canvas row is removed with RETURNING; nothing cascades to history.
    expect(queryMock.mock.calls[0]?.[0]).toContain(
      'delete from app_private.canvas',
    );
    expect(queryMock.mock.calls[0]?.[0]).toContain('returning run_id');
    // Assets are reclaimed by the run's `runs/<runId>/` prefix; the chain_step
    // history rows are left untouched (no extra query).
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(deleteRunStoredAssetsMock).toHaveBeenCalledWith(RUN_ID);
  });

  it('renames the row and embedded info card with a 40-character title', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1 });

    const renamed = await renameCanvas(
      OWNER,
      CANVAS_ID,
      'b'.repeat(MAX_CANVAS_TITLE_LENGTH + 1),
    );

    expect(renamed).toBe(true);
    expect(queryMock.mock.calls[0]?.[1]?.[2]).toBe(
      'b'.repeat(MAX_CANVAS_TITLE_LENGTH),
    );
    expect(queryMock.mock.calls[0]?.[0]).toContain(
      "jsonb_set(entry, '{values,name}', to_jsonb($3::text))",
    );
  });
});

describe('workspace canvas', () => {
  it('upserts the owner-scoped workspace row and prunes stale flow runs', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await saveWorkspaceCanvas(
      OWNER,
      [node({ flowId: 'flow_a' })],
      SAVE_VERSION,
    );

    const call = queryMock.mock.calls[0];
    expect(call?.[0]).toContain('on conflict (owner_email) where workspace');
    expect(call?.[1]?.[0]).toBe(OWNER);
    expect(call?.[1]?.[2]).toEqual(['flow_a']);
    expect(call?.[1]?.[3]).toBe(SAVE_VERSION);
    const storedNodes = JSON.parse(call?.[1]?.[1] as string) as Array<{
      flowId?: string;
    }>;
    expect(storedNodes[0]?.flowId).toBe('flow_a');
  });

  it('rejects oversized workspaces before touching the database', async () => {
    const tooMany = Array.from({ length: 65 }, (_, index) =>
      node({ id: `n-${index}` }),
    );

    await expect(
      saveWorkspaceCanvas(OWNER, tooMany, SAVE_VERSION),
    ).rejects.toMatchObject({
      code: 'invalid_canvas',
    });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns nodes and validated flow runs for the workspace', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          nodes: [node({ flowId: 'flow_a' })],
          flow_runs: {
            flow_a: CANVAS_ID,
            flow_bad: 'not-a-uuid',
          },
        },
      ],
    });

    const workspace = await getWorkspaceCanvas(OWNER);

    expect(workspace?.nodes).toHaveLength(1);
    expect(workspace?.flowRuns).toEqual({ flow_a: CANVAS_ID });
  });

  it('records flow runs only with valid run ids', async () => {
    expect(await recordWorkspaceFlowRun(OWNER, 'flow_a', 'nope')).toBe(false);
    expect(queryMock).not.toHaveBeenCalled();

    queryMock.mockResolvedValueOnce({ rowCount: 1 });
    expect(await recordWorkspaceFlowRun(OWNER, 'flow_a', CANVAS_ID)).toBe(true);
    expect(queryMock.mock.calls[0]?.[0]).toContain('flow_runs ||');
  });
});
