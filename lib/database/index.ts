import 'server-only';

import type { PoolClient, QueryResultRow } from 'pg';

import { getEnv } from '@/lib/utils/env';

import { auroraQuery, auroraTransaction, pingAurora } from './aurora';
import { pingPolarDb, polarQuery, polarTransaction } from './polardb';

/**
 * Database provider selector.
 *
 * Marsha runs on a single PostgreSQL backend chosen at deploy time via
 * `APP_DATABASE`: AWS Aurora (`aurora`, the default) or Alibaba Cloud PolarDB
 * (`polardb`). Both are wire-compatible PostgreSQL, so the schema, SQL, and
 * connection handling are identical; `APP_DATABASE` only decides which pooled
 * connection the runtime uses. `DATABASE_URL` points at the selected cluster.
 *
 * Every consumer (chain store, canvas store, health probe) goes through
 * {@link dbQuery}, {@link dbTransaction}, and {@link pingDatabase} so switching
 * providers never requires code changes.
 */

export type DatabaseProvider = 'aurora' | 'polardb';

export function getActiveDatabaseProvider(): DatabaseProvider {
  return getEnv().APP_DATABASE;
}

export async function dbQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: ReadonlyArray<unknown> = [],
) {
  return getActiveDatabaseProvider() === 'polardb'
    ? polarQuery<T>(text, params)
    : auroraQuery<T>(text, params);
}

export async function dbTransaction<T>(
  handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return getActiveDatabaseProvider() === 'polardb'
    ? polarTransaction(handler)
    : auroraTransaction(handler);
}

export async function pingDatabase(): Promise<boolean> {
  return getActiveDatabaseProvider() === 'polardb'
    ? pingPolarDb()
    : pingAurora();
}
