const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

export function getInternalApiBaseUrl(env: NodeJS.ProcessEnv = process.env) {
  const siteUrl = normalizedSiteUrl(env.NEXT_PUBLIC_SITE_URL);

  if (siteUrl && shouldUseSiteUrl(env, siteUrl)) {
    return siteUrl;
  }

  return `http://127.0.0.1:${localPort(env)}`;
}

function shouldUseSiteUrl(env: NodeJS.ProcessEnv, siteUrl: string) {
  if (env.NODE_ENV !== 'production' && !env.VERCEL && !env.VERCEL_URL) {
    return false;
  }

  try {
    const { hostname } = new URL(siteUrl);
    return !LOCAL_HOSTS.has(hostname.toLowerCase());
  } catch {
    return false;
  }
}

function normalizedSiteUrl(value: string | undefined) {
  return value?.trim().replace(/\/+$/, '') || null;
}

function localPort(env: NodeJS.ProcessEnv) {
  return env.PORT?.trim() || '3011';
}
