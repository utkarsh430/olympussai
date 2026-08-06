import type { Metadata } from 'next';
import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';

export const metadata: Metadata = {
  title: 'Planner · Ops',
  robots: { index: false, follow: false },
};

export default async function PlannerLayout({ children }: { children: React.ReactNode }) {
  await requireOpsRolePage('planner', '/ops/planner');
  return <>{children}</>;
}
