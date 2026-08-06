import type { Metadata } from 'next';
import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';

export const metadata: Metadata = {
  title: 'Driver · Ops',
  robots: { index: false, follow: false },
};

export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  await requireOpsRolePage('driver', '/ops/driver');
  return <>{children}</>;
}
