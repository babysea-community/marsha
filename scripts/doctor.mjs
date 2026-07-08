// @ts-check
/**
 * the app deployment wiring validator (Vercel).
 *
 * Checks the required runtime files, environment variables, and provider-mode
 * configuration for a Vercel deployment. Run with `pnpm run doctor`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { Socket } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

loadEnvFile(join(root, '.env.local'));
loadEnvFile(join(root, '.env'));

const requiredFiles = [
  'app/api/v1/chains/route.ts',
  'app/api/v1/chains/runs/route.ts',
  'app/api/v1/chains/get/[runId]/route.ts',
  'app/api/v1/chains/cancel/[runId]/route.ts',
  'app/api/cron/process-runs/route.ts',
  'app/api/webhooks/babysea/route.ts',
  'scripts/db-migrate.mjs',
  'vercel.json',
];

const requiredEnv = [
  'NEXT_PUBLIC_SITE_URL',
  'OWNER_EMAIL',
  'OWNER_PASSWORD',
  'OWNER_SESSION_SECRET',
  'DATABASE_URL',
  'APP_API_KEY',
  'APP_CRON_SECRET',
  'APP_CALLBACK_SECRET',
];

/** @type {readonly [string, string | readonly string[]][]} */
const byokProviderKeys = [
  ['Alibaba Cloud', 'DASHSCOPE_API_KEY'],
  ['Black Forest Labs', 'BFL_API_KEY'],
  ['BytePlus', 'ARK_API_KEY'],
  ['Google', ['GEMINI_API_KEY', 'GOOGLE_API_KEY']],
  ['OpenAI', 'OPENAI_API_KEY'],
  ['Runway', 'RUNWAYML_API_SECRET'],
];
const babySeaEnv = ['BABYSEA_API_KEY', 'BABYSEA_API_BASE_URL'];

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const warnings = [];

for (const file of requiredFiles) {
  if (!existsSync(join(root, file))) {
    failures.push(`Missing required file: ${file}`);
  }
}

const packageJsonPath = join(root, 'package.json');
if (existsSync(packageJsonPath)) {
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    if (packageJson.scripts?.['db:migrate'] !== 'node scripts/db-migrate.mjs') {
      failures.push(
        'package.json script "db:migrate" must run node scripts/db-migrate.mjs.',
      );
    }
  } catch {
    failures.push('package.json must be valid JSON.');
  }
} else {
  failures.push('Missing required file: package.json');
}

for (const name of requiredEnv) {
  if (!process.env[name]) {
    failures.push(`Missing env var: ${name}`);
  }
}

const providerMode = process.env.APP_PROVIDER_MODE || 'byok';
const configuredByokProviders = byokProviderKeys.filter(providerEnvConfigured);
const missingByokProviders = byokProviderKeys.filter(
  (entry) => !providerEnvConfigured(entry),
);

if (!['byok', 'babysea'].includes(providerMode)) {
  failures.push('APP_PROVIDER_MODE must be "byok" or "babysea".');
}

if (providerMode === 'byok' && configuredByokProviders.length === 0) {
  failures.push(
    'APP_PROVIDER_MODE=byok requires DASHSCOPE_API_KEY, BFL_API_KEY, ARK_API_KEY, GEMINI_API_KEY or GOOGLE_API_KEY, OPENAI_API_KEY, or RUNWAYML_API_SECRET.',
  );
}

if (providerMode === 'byok' && configuredByokProviders.length > 0) {
  console.log(
    `info: BYOK providers configured: ${formatProviderList(configuredByokProviders)}.`,
  );

  if (missingByokProviders.length > 0) {
    console.log(
      `info: BYOK providers not configured, needed only when chains use those models: ${formatProviderList(missingByokProviders)}.`,
    );
  }
}

if (providerMode === 'babysea') {
  for (const name of babySeaEnv) {
    if (!process.env[name]) {
      failures.push(`Missing env var: ${name}`);
    }
  }

  if (configuredByokProviders.length > 0) {
    warnings.push(
      `APP_PROVIDER_MODE=babysea ignores BYOK provider keys: ${formatProviderList(configuredByokProviders)}.`,
    );
  }
}

// Vercel deployment config sanity check: the queued-run recovery cron should
// be scheduled so runs advance even without inline processing.
const vercelPath = join(root, 'vercel.json');
if (
  existsSync(vercelPath) &&
  !readFileSync(vercelPath, 'utf8').includes('process-runs')
) {
  warnings.push(
    'vercel.json should schedule the queued-run recovery cron (/api/cron/process-runs).',
  );
}

if (
  process.env.DATABASE_URL &&
  isTruthy(process.env.APP_DOCTOR_SKIP_DB_REACHABILITY)
) {
  console.log(
    'info: DATABASE_URL reachability check skipped by APP_DOCTOR_SKIP_DB_REACHABILITY.',
  );
} else if (process.env.DATABASE_URL) {
  try {
    await assertDatabaseReachable(process.env.DATABASE_URL);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
}

for (const warning of warnings) {
  console.warn(`warn: ${warning}`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`fail: ${failure}`);
  }

  process.exit(1);
}

console.log('Doctor checks passed.');

/** @param {readonly [string, string | readonly string[]][]} entries */
function formatProviderList(entries) {
  return entries
    .map(
      ([provider, keys]) => `${provider} (${providerKeys(keys).join(' or ')})`,
    )
    .join(', ');
}

/** @param {readonly [string, string | readonly string[]]} entry */
function providerEnvConfigured([, keys]) {
  return providerKeys(keys).some((key) => Boolean(process.env[key]));
}

/** @param {string | readonly string[]} keys */
function providerKeys(keys) {
  return Array.isArray(keys) ? keys : [keys];
}

/** @param {string | undefined} value */
function isTruthy(value) {
  return value === '1' || value === 'true' || value === 'yes';
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

/** @param {string} connectionString */
async function assertDatabaseReachable(connectionString) {
  const url = new URL(connectionString);
  const host = url.hostname;
  const port = Number(url.port || 5432);
  const timeoutMs = Number(process.env.APP_DOCTOR_DB_TIMEOUT_MS) || 8_000;

  await new Promise((resolve, reject) => {
    const socket = new Socket();
    let settled = false;

    /** @param {Error | null} error */
    const finish = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve(undefined);
      }
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(null));
    socket.once('timeout', () => {
      finish(
        new Error(
          `DATABASE_URL is not reachable at ${host}:${port} within ${timeoutMs}ms. Check Aurora public access, VPC routing, and the security group inbound TCP 5432 rule for this runtime's egress IP.`,
        ),
      );
    });
    socket.once('error', (error) => {
      const code = errorCode(error);
      finish(
        new Error(
          `DATABASE_URL is not reachable at ${host}:${port}: ${code || error.message}. Check Aurora public access, VPC routing, and the security group inbound TCP 5432 rule for this runtime's egress IP.`,
        ),
      );
    });
    socket.connect(port, host);
  });

  console.log(`info: DATABASE_URL is reachable at ${host}:${port}.`);
}

/** @param {Error} error */
function errorCode(error) {
  const code = /** @type {{ code?: unknown }} */ (
    /** @type {unknown} */ (error)
  ).code;

  return typeof code === 'string' ? code : null;
}
