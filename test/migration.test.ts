import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../lib/database/schema.sql', import.meta.url),
  'utf8',
);

describe('Aurora migration', () => {
  it('keeps the app runtime tables in a private schema', () => {
    expect(migration).toContain('create schema if not exists app_private;');
    expect(migration).not.toMatch(/create table if not exists public\./i);
  });

  it('creates the the app runtime tables', () => {
    expect(migration).toContain(
      'create table if not exists app_private.api_key',
    );
    expect(migration).toContain(
      'create table if not exists app_private.chain_run',
    );
    expect(migration).toContain(
      'create table if not exists app_private.chain_step',
    );
    expect(migration).toContain('babysea_request_id text');
  });

  it('stores a JSONB-safe sidecar for public input key order', () => {
    expect(migration).toContain('input_order jsonb');
  });

  it('includes BYOK provider runtime fields in the fresh schema', () => {
    expect(migration).toContain('byok_credentials jsonb');
    expect(migration).toContain('provider_metadata jsonb');
  });

  it('creates Chain Agent checkpoint storage', () => {
    expect(migration).toContain('execution_config jsonb');
    expect(migration).toContain('{"type":"self_control"}');
    expect(migration).toContain(
      'create table if not exists app_private.chain_agent_checkpoint',
    );
    expect(migration).toContain("'awaiting_agent'");
    expect(migration).toContain('idx_app_agent_checkpoint_run_step');
    expect(migration).toContain('trg_app_agent_checkpoint_touch');
  });

  it('creates the owner-scoped canvas table', () => {
    expect(migration).toContain(
      'create table if not exists app_private.canvas',
    );
    expect(migration).toContain('owner_email text not null');
    expect(migration).toContain('idx_app_canvas_owner_updated');
    expect(migration).toContain('idx_app_canvas_owner_created');
    expect(migration).toContain('trg_app_canvas_touch');
    expect(migration).toContain('run_id uuid');
    expect(migration).toContain('workspace boolean not null default false');
    expect(migration).toContain("flow_runs jsonb not null default '{}'");
    expect(migration).toContain('save_version bigint not null default 0');
    expect(migration).not.toMatch(
      /alter\s+table\s+app_private\.canvas[\s\S]*?add\s+column/i,
    );
  });

  it('supports the permanent workspace canvas', () => {
    expect(migration).toContain('workspace boolean not null default false');
    expect(migration).toContain("flow_runs jsonb not null default '{}'");
    expect(migration).toContain('idx_app_canvas_workspace_owner');
  });
});
