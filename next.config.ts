import type { NextConfig } from 'next';
import { createRequire } from 'node:module';
import { dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { API_SECURITY_HEADERS, SECURITY_HEADERS } from './lib/security/csp';

const appRoot = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const nextPackageRoot = dirname(require.resolve('next/package.json'));
const turbopackRoot = findCommonDirectory(appRoot, nextPackageRoot);

const isProduction = process.env.NODE_ENV === 'production';

// Origins allowed to invoke Server Actions. Next.js rejects a Server Action
// when the request `Origin` does not match the server host, which breaks behind
// reverse proxies such as GitHub Codespaces port forwarding (the browser sends
// the public `*.app.github.dev` host while the server sees `localhost:3011`).
// Derive the public host from NEXT_PUBLIC_SITE_URL plus common dev hosts.
const allowedServerActionOrigins = (() => {
  const origins = new Set<string>([
    'localhost:3011',
    '*.app.github.dev',
    '*.githubpreview.dev',
    '*.gitpod.io',
  ]);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (siteUrl) {
    try {
      origins.add(new URL(siteUrl).host);
    } catch {
      // ignore malformed NEXT_PUBLIC_SITE_URL
    }
  }

  return Array.from(origins);
})();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  reactCompiler: true,
  turbopack: {
    root: turbopackRoot,
  },
  devIndicators: {
    position: 'bottom-right',
  },
  experimental: {
    serverActions: {
      allowedOrigins: allowedServerActionOrigins,
    },
  },
  // Avoid printing full external fetch URLs into production logs.
  // Full URLs are still useful locally for debugging.
  logging: {
    fetches: {
      fullUrl: !isProduction,
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
      {
        source: '/api/:path*',
        headers: API_SECURITY_HEADERS,
      },
    ];
  },
};

function findCommonDirectory(firstPath: string, secondPath: string) {
  const firstParts = firstPath.split(sep).filter(Boolean);
  const secondParts = secondPath.split(sep).filter(Boolean);
  const commonParts: string[] = [];

  for (let index = 0; index < firstParts.length; index += 1) {
    const firstPart = firstParts[index];

    if (!firstPart || firstPart !== secondParts[index]) {
      break;
    }

    commonParts.push(firstPart);
  }

  return commonParts.length > 0 ? `${sep}${commonParts.join(sep)}` : sep;
}

export default withOptionalSentry(nextConfig);

/**
 * Conditionally wrap with `withSentryConfig` so the build keeps working when
 * `@sentry/nextjs` is absent (e.g. on lean forks that strip the dependency).
 */
function withOptionalSentry(config: NextConfig): NextConfig {
  const enableSentry =
    Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN?.trim()) ||
    Boolean(process.env.SENTRY_AUTH_TOKEN?.trim());

  if (!enableSentry) {
    return config;
  }

  try {
    const { withSentryConfig } = require('@sentry/nextjs') as {
      withSentryConfig: (
        cfg: NextConfig,
        options: Record<string, unknown>,
      ) => NextConfig;
    };

    return withSentryConfig(config, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      widenClientFileUpload: true,
      tunnelRoute: '/monitoring',
      // Replacement for the now-deprecated `disableLogger: true`. Strips
      // `Sentry.logger.*` calls from production bundles via webpack tree-shake.
      bundleSizeOptimizations: {
        excludeDebugStatements: true,
      },
      hideSourceMaps: true,
      telemetry: false,
    });
  } catch (error) {
    console.warn(
      '[marsha] Sentry DSN set but @sentry/nextjs failed to load. Continuing without Sentry build wrapper.',
      error,
    );
    return config;
  }
}
