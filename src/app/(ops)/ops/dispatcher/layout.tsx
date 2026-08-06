import type { Metadata } from 'next';
import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';

export const metadata: Metadata = {
  title: 'Dispatcher · Ops',
  robots: { index: false, follow: false },
};

export default async function DispatcherLayout({ children }: { children: React.ReactNode }) {
  await requireOpsRolePage('dispatcher', '/ops/dispatcher');
  return <>{children}</>;
}
