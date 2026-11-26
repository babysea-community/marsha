// @ts-check
/**
 * Apply the runtime schema to your PostgreSQL database.
 *
 * Works with both APP_DATABASE providers: AWS Aurora and Alibaba Cloud PolarDB.
 *
 * Usage: pnpm run db:migrate
 *
 * The database connects as a privileged role and the chain store performs
 * the verify/claim logic directly in SQL.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

loadEnvFile(join(root, '.env.local'));
loadEnvFile(join(root, '.env'));

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('✗ DATABASE_URL is not set.');
  process.exit(1);
}

const SCHEMA_SQL = readFileSync(join(root, 'lib/database/schema.sql'), 'utf8');

const client = new pg.Client({
  connectionTimeoutMillis: 30_000,
  connectionString: stripSslParams(connectionString),
  ssl: resolveSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
});

try {
  await client.connect();
  await client.query(SCHEMA_SQL);
  console.log('✓ Database schema applied (schema "app_private").');
} catch (error) {
  console.error(
    '✗ Migration failed:',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
} finally {
  await client.end();
}

/** @param {string} path */
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

/** @param {string} cs */
function resolveSsl(cs) {
  const explicit = (process.env.DATABASE_SSL || '').toLowerCase();
  if (['disable', 'false', 'off'].includes(explicit)) return false;
  if (['require', 'true', 'on'].includes(explicit)) return true;
  return !/@(localhost|127\.0\.0\.1)(:|\/)/.test(cs);
}

/**
 * Remove ssl-related query params so pg uses our explicit `ssl` option instead
 * of doing strict cert verification (Aurora and PolarDB present an RDS CA not
 * in the system trust store).
 * @param {string} cs
 */
function stripSslParams(cs) {
  try {
    const url = new URL(cs);
    for (const key of ['sslmode', 'ssl', 'uselibpqcompat']) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return cs;
  }
}
