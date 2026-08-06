import { getOpsSession } from '@/lib/auth/rbac/server';
import { OpsShell } from '@/components/ops/OpsShell';
import { OpsAdminInvitesPanel } from '@/components/ops/OpsAdminInvitesPanel';

export default async function OpsAdminInvitesPage() {
  const session = (await getOpsSession())!;

  return (
    <OpsShell title="Admin · Invites" email={session.email}>
      <OpsAdminInvitesPanel />
    </OpsShell>
  );
}
