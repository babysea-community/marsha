import { SignJWT, jwtVerify } from 'jose';

/**
 * Single-owner dashboard auth.
 *
 * the app's API stays key-authenticated; the dashboard is a separate layer
 * gated by one configured identity:
 *   - OWNER_EMAIL           the only email allowed to login
 *   - OWNER_PASSWORD        the sign-in password
 *   - OWNER_SESSION_SECRET  HS256 signing key for the session cookie
 *
 * The pure helpers (sign/verify/owner check) are edge-safe and used by the
 * middleware. The cookie helpers use `next/headers` via dynamic import so
 * importing this module into the edge middleware stays safe.
 */

export const SESSION_COOKIE = 'marsha_session';
const ALG = 'HS256';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export type OwnerSession = { email: string; issuedAt?: string; name: string };

export type OwnerConfig = {
  email: string;
  name: string;
  password: string;
  secret: string;
};

export function getOwnerConfig(): OwnerConfig {
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!email) {
    throw new Error('OWNER_EMAIL is not set.');
  }

  const password = process.env.OWNER_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error('OWNER_PASSWORD must be set (>= 8 characters).');
  }

  const secret = process.env.OWNER_SESSION_SECRET?.trim();
  if (!secret || secret.length < 16) {
    throw new Error(
      'OWNER_SESSION_SECRET must be set (>= 16 characters). Generate one with `openssl rand -hex 32`.',
    );
  }

  return { email, name: deriveName(email), password, secret };
}

export function isOwnerEmail(email: string | null | undefined): boolean {
  if (!email) {
    return false;
  }
  try {
    return email.trim().toLowerCase() === getOwnerConfig().email;
  } catch {
    return false;
  }
}

export function verifyOwnerCredentials(
  email: string,
  password: string,
): boolean {
  let config: OwnerConfig;
  try {
    config = getOwnerConfig();
  } catch {
    return false;
  }

  if (email.trim().toLowerCase() !== config.email) {
    return false;
  }

  return constantTimeEquals(password, config.password);
}

export async function signSession(
  payload: OwnerSession,
  secret: string,
): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: payload.email, name: payload.name })
    .setProtectedHeader({ alg: ALG })
    .setSubject(payload.email)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + MAX_AGE_SECONDS)
    .sign(new TextEncoder().encode(secret));
}

export async function verifySession(
  token: string,
  secret: string,
): Promise<OwnerSession | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
      {
        algorithms: [ALG],
      },
    );
    if (typeof payload.email !== 'string') {
      return null;
    }
    return {
      email: payload.email,
      issuedAt:
        typeof payload.iat === 'number'
          ? new Date(payload.iat * 1000).toISOString()
          : undefined,
      name: typeof payload.name === 'string' ? payload.name : payload.email,
    };
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Cookie-backed session (server components/actions only)
// ----------------------------------------------------------------------------

export async function createSession(payload: OwnerSession): Promise<void> {
  const config = getOwnerConfig();
  const token = await signSession(payload, config.secret);
  const { cookies } = await import('next/headers');
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function getSession(): Promise<OwnerSession | null> {
  const { cookies } = await import('next/headers');
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }

  let config: OwnerConfig;
  try {
    config = getOwnerConfig();
  } catch {
    return null;
  }

  const session = await verifySession(token, config.secret);
  return session && session.email === config.email ? session : null;
}

export async function destroySession(): Promise<void> {
  const { cookies } = await import('next/headers');
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function requireOwnerSession(): Promise<OwnerSession> {
  const session = await getSession();
  if (session) {
    return session;
  }
  const { redirect } = await import('next/navigation');
  redirect('/login');
  throw new Error('unreachable');
}

function deriveName(email: string): string {
  const handle = email.split('@')[0] ?? 'Owner';
  return (
    handle
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ') || 'Owner'
  );
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}
