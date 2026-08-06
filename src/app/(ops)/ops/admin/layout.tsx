import type { Metadata } from 'next';
import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';

export const metadata: Metadata = {
  title: 'Admin · Ops',
  robots: { index: false, follow: false },
};

export default async function OpsAdminLayout({ children }: { children: React.ReactNode }) {
  // Admin has no dashboard of its own (src/lib/auth/rbac/roles.ts
  // OPERATIONAL_ROLES excludes it) — its only surface is invite/user
  // management, gated the same way every other role's surface is.
  await requireOpsRolePage('admin', '/ops/admin/invites');
  return <>{children}</>;
}
