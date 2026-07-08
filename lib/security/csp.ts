const isProduction = process.env.NODE_ENV === 'production';
const BABYSEA_CDN_ORIGIN = 'https://cdn.babysea.live';
const FONT_AWESOME_ASSET_ORIGIN = 'https://ka-f.fontawesome.com';
const FONT_AWESOME_KIT_ORIGIN = 'https://kit.fontawesome.com';

export const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  ...(isProduction
    ? [
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
      ]
    : []),
  { key: 'Content-Security-Policy', value: buildContentSecurityPolicy() },
];

export const API_SECURITY_HEADERS = [
  {
    key: 'Cache-Control',
    value: 'no-store, no-cache, must-revalidate, proxy-revalidate',
  },
  { key: 'Pragma', value: 'no-cache' },
  { key: 'Expires', value: '0' },
];

/**
 * Builds app's static CSP from the active deployment environment.
 * App is a single private starter, so a small static policy in next.config
 * keeps a strict allowlist discipline without needing middleware nonce
 * plumbing. The CSP applies to HTML responses; JSON API responses under
 * /api/* receive Cache-Control headers via API_SECURITY_HEADERS.
 */
function buildContentSecurityPolicy() {
  const connectHosts = new Set<string>([
    "'self'",
    'https://api.us.babysea.ai', // us-region
    'https://api.eu.babysea.ai', // eu-region
    'https://api.jp.babysea.ai', // apac-region
  ]);
  const imageHosts = new Set<string>([
    "'self'",
    'data:',
    'blob:',
    'https:', // generated media from inference provider CDNs (Runway, DashScope, BFL, etc.)
    'https://app.us.babysea.ai', // us-region
    'https://app.eu.babysea.ai', // eu-region
    'https://app.jp.babysea.ai', // apac-region
    BABYSEA_CDN_ORIGIN, // app assets
    'https://imagedelivery.net', // app assets
  ]);
  // Generated video previews come from the same provider CDNs as images.
  const mediaHosts = new Set<string>(["'self'", 'data:', 'blob:', 'https:']);
  // React's development build uses eval() for debugging features (e.g.
  // reconstructing callstacks). Allow it only outside production so the dev
  // server works without weakening the production CSP.
  const scriptHosts = new Set<string>(
    isProduction
      ? ["'self'", "'unsafe-inline'"]
      : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
  );
  scriptHosts.add(BABYSEA_CDN_ORIGIN);
  scriptHosts.add(FONT_AWESOME_ASSET_ORIGIN);
  scriptHosts.add(FONT_AWESOME_KIT_ORIGIN);
  connectHosts.add(FONT_AWESOME_ASSET_ORIGIN);

  appendHostFromUrl(connectHosts, process.env.BABYSEA_API_BASE_URL);

  const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();

  if (sentryDsn) {
    appendHostFromUrl(connectHosts, sentryDsn);
  }

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': Array.from(scriptHosts),
    'script-src-elem': Array.from(scriptHosts),
    'script-src-attr': ["'none'"],
    'style-src': ["'self'", "'unsafe-inline'", FONT_AWESOME_ASSET_ORIGIN],
    'img-src': Array.from(imageHosts),
    'media-src': Array.from(mediaHosts),
    'font-src': ["'self'", 'data:', FONT_AWESOME_ASSET_ORIGIN],
    'connect-src': Array.from(connectHosts),
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
  };

  if (isProduction) {
    directives['upgrade-insecure-requests'] = [];
  }

  return Object.entries(directives)
    .map(([directive, sources]) =>
      sources.length > 0 ? `${directive} ${sources.join(' ')}` : directive,
    )
    .join('; ');
}

function appendHostFromUrl(set: Set<string>, raw: string | undefined) {
  const trimmed = raw?.trim();

  if (!trimmed) {
    return;
  }

  try {
    const url = new URL(trimmed);

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return;
    }

    set.add(`${url.protocol}//${url.host}`);
  } catch {
    // ignore invalid URLs; CSP simply will not include them.
  }
}
