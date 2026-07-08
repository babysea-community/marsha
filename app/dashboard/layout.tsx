import { redirect } from 'next/navigation';
import { Toaster } from 'sonner';

import { DashboardShell } from './dashboard-shell';
import { destroySession, requireOwnerSession } from '@/lib/auth/owner';

export const dynamic = 'force-dynamic';

async function signOutAction() {
  'use server';
  await destroySession();
  redirect('/login');
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireOwnerSession();

  return (
    <DashboardShell signOutAction={signOutAction}>
      <Toaster position="top-center" richColors />
      {children}
    </DashboardShell>
  );
}
