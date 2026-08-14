import type { Metadata } from 'next';
import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';

export const metadata: Metadata = {
  title: 'Admin · Ops',
  robots: { index: false, follow: false },
};

export default async function OpsAdminLayout({ children }: { children: React.ReactNode }) {
  // Admin drives no vehicles (src/lib/auth/rbac/roles.ts OPERATIONAL_ROLES
  // excludes it) — it decides who may, and what the system is permitted to do
  // to the network. Gated the same way every other role's surface is; the
  // segment root is a real console now rather than a 404.
  await requireOpsRolePage('admin', '/ops/admin');
  return <>{children}</>;
}
