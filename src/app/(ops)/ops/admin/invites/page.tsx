import Link from 'next/link';
import { getOpsSession } from '@/lib/auth/rbac/server';
import { OpsShell } from '@/components/ops/OpsShell';
import { OpsAdminInvitesPanel } from '@/components/ops/OpsAdminInvitesPanel';

export default async function OpsAdminInvitesPage() {
  const session = (await getOpsSession())!;

  return (
    <OpsShell title="Admin · Invites" email={session.email}>
      <p className="mb-6 text-sm">
        <Link href="/ops/admin/rollout-stages" className="text-[#8fb4ff] hover:underline">
          Pilot rollout stages &rarr;
        </Link>
      </p>
      <OpsAdminInvitesPanel />
    </OpsShell>
  );
}
