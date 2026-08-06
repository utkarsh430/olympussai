import type { Metadata } from 'next';
import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';

export const metadata: Metadata = {
  title: 'Depot · Ops',
  robots: { index: false, follow: false },
};

export default async function DepotLayout({ children }: { children: React.ReactNode }) {
  await requireOpsRolePage('depot', '/ops/depot');
  return <>{children}</>;
}
