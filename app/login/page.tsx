import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  createSession,
  getOwnerConfig,
  getSession,
  verifyOwnerCredentials,
} from '@/lib/auth/owner';
import { Card } from '@/components/ui/card';
import { GooBackground } from '@/lib/utils/goo/background';

import { LoginSubmitButton } from './submit-button';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Login' };

const ERROR_MESSAGES: Record<string, string> = {
  invalid: 'Invalid owner email or password.',
  config: 'Sign-in is not configured. Set OWNER_EMAIL and OWNER_PASSWORD.',
};

async function signInAction(formData: FormData) {
  'use server';

  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const redirectTo = String(formData.get('redirect') ?? '/dashboard/chain');
  const safeRedirect = redirectTo.startsWith('/dashboard')
    ? redirectTo
    : '/dashboard/chain';

  let valid = false;
  try {
    valid = verifyOwnerCredentials(email, password);
  } catch {
    redirect('/login?error=config');
  }

  if (!valid) {
    redirect('/login?error=invalid');
  }

  const owner = getOwnerConfig();
  await createSession({ email: owner.email, name: owner.name });
  redirect(safeRedirect);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; redirect?: string }>;
}) {
  if (await getSession()) {
    redirect('/dashboard/chain');
  }

  const params = await searchParams;
  const error = params.error ? ERROR_MESSAGES[params.error] : null;
  const redirectTo = params.redirect?.startsWith('/dashboard')
    ? params.redirect
    : '/dashboard/chain';

  return (
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 py-12">
      <div className="absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
        <GooBackground />
      </div>

      <Card className="relative z-10 w-full max-w-md bg-card p-8 shadow-2xl ring-1 ring-border">
        <div className="mb-8 text-center">
          <p className="text-lg font-semibold uppercase tracking-[0.4em] text-primary">
            Marsha
          </p>
          <h1 className="mt-4 text-3xl font-semibold text-foreground">
            Owner access
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Marsha is a single-user workspace. Only the email configured in
            <code className="mx-1 bg-muted px-1 text-primary">OWNER_EMAIL</code>
            can sign in.
          </p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Build your own Marsha{' '}
            <a
              href="https://github.com/babysea-community/marsha"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline decoration-primary/40 underline-offset-4 transition hover:text-foreground hover:decoration-foreground"
            >
              here
            </a>
            .
          </p>
        </div>

        <form action={signInAction} className="space-y-4">
          <input type="hidden" name="redirect" value={redirectTo} />

          <label className="grid gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Owner email
            </span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="owner@example.com"
              className="h-11 w-full border border-border bg-input px-4 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus-visible:border-ring"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Password
            </span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
              className="h-11 w-full border border-border bg-input px-4 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus-visible:border-ring"
            />
          </label>

          {error ? (
            <p className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
              {error}
            </p>
          ) : null}

          <LoginSubmitButton />
        </form>
      </Card>
    </main>
  );
}
