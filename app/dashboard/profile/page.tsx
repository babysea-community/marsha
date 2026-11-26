import type { Metadata } from 'next';
import { createHash } from 'node:crypto';

import { Card } from '@/components/ui/card';
import { getOwnerConfig, requireOwnerSession } from '@/lib/auth/owner';
import { getWorkspaceCreatedAt } from '@/lib/canvas/canvas-store';
import { formatDate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Profile' };

export default async function ProfilePage() {
  const session = await requireOwnerSession();
  const owner = getOwnerConfig();
  const ownerEmail = owner.email;
  const displayName =
    session.name && session.name !== session.email ? session.name : owner.name;
  const lastSignIn = session.issuedAt ? formatDate(session.issuedAt) : '-';
  // The workspace exists from the first canvas row in Aurora (the permanent
  // scratchpad or the first saved canvas), so this reflects real usage.
  const workspaceCreatedAt = await getWorkspaceCreatedAt(session.email).catch(
    () => null,
  );
  const workspaceCreated = workspaceCreatedAt
    ? formatDate(workspaceCreatedAt)
    : '-';
  const userId = stableOwnerId(ownerEmail);

  return (
    <main className="w-full space-y-6 p-6 lg:p-8">
      <Card className="p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.4em] text-primary">
          Profile
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-5">
          <div className="flex size-20 items-center justify-center border border-border bg-sidebar text-2xl font-semibold text-primary">
            {(session.email ?? '?').slice(0, 1).toUpperCase()}
          </div>

          <div>
            <p className="text-2xl font-semibold text-foreground">
              {displayName}
            </p>
            <p className="break-all text-sm text-muted-foreground">
              {session.email}
            </p>
            <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
              Identity: password
            </p>
          </div>
        </div>

        <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
          <Item label="Owner email">{ownerEmail}</Item>
          <Item label="Last sign-in">{lastSignIn}</Item>
          <Item label="Workspace created">{workspaceCreated}</Item>
          <Item label="User id">
            <code className="text-xs text-card-foreground">{userId}</code>
          </Item>
        </dl>
      </Card>
    </main>
  );
}

function Item({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border bg-background px-4 py-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-card-foreground">{children}</dd>
    </div>
  );
}

function stableOwnerId(email: string) {
  const hex = createHash('sha256').update(email).digest('hex').slice(0, 32);

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}
