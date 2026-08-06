import type { Metadata } from 'next';
import { getOpsSession } from '@/lib/auth/rbac/server';
import { sanitizeOpsNext } from '@/lib/auth/rbac/redirect';
import { OPS_ROLE_SEGMENT } from '@/lib/auth/rbac/roles';
import { OpsLoginForm } from '@/components/auth/OpsLoginForm';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Ops Sign In',
  robots: { index: false, follow: false },
};

export default async function OpsLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = sanitizeOpsNext(params.next);

  const session = await getOpsSession();
  if (session) {
    redirect(next ?? `/ops/${OPS_ROLE_SEGMENT[session.role]}`);
  }

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-8 px-6 py-16">
      <div className="text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#6f7684]">
          Olympuss AI
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-[#e6e9ef]">Operations sign in</h1>
        <p className="mt-1 text-sm text-[#9aa0ad]">
          Per-person accounts only. Contact your admin for an invite.
        </p>
      </div>
      <OpsLoginForm next={next} />
    </main>
  );
}
