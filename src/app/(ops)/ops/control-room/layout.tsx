import type { Metadata } from 'next';
import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';

export const metadata: Metadata = {
  title: 'Control Room · Ops',
  robots: { index: false, follow: false },
};

export default async function ControlRoomLayout({ children }: { children: React.ReactNode }) {
  await requireOpsRolePage('control_room', '/ops/control-room');
  return <>{children}</>;
}
