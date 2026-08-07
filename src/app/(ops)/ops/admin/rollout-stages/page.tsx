import Link from 'next/link';
import { getOpsSession } from '@/lib/auth/rbac/server';
import { OpsShell } from '@/components/ops/OpsShell';
import { OpsAdminRolloutStagesPanel } from '@/components/ops/OpsAdminRolloutStagesPanel';

export default async function OpsAdminRolloutStagesPage() {
  const session = (await getOpsSession())!;

  return (
    <OpsShell title="Admin · Rollout stages" email={session.email}>
      <p className="mb-6 text-sm">
        <Link href="/ops/admin/invites" className="text-[#8fb4ff] hover:underline">
          &larr; Back to invites/users
        </Link>
      </p>
      <OpsAdminRolloutStagesPanel />
    </OpsShell>
  );
}
