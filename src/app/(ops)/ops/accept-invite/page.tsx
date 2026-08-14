import type { Metadata } from 'next';
import { OpsAcceptInviteForm } from '@/components/auth/OpsAcceptInviteForm';

export const metadata: Metadata = {
  title: 'Accept Invite',
  robots: { index: false, follow: false },
};

export default async function OpsAcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  const token = params.token ?? '';

  if (!token) {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-semibold text-ops-ink">Invite link missing</h1>
        <p className="max-w-md text-sm text-ops-muted">
          This link is missing its invite token. Ask your admin to resend it.
        </p>
      </main>
    );
  }

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-8 px-6 py-16">
      <div className="text-center">
        <p className="ops-eyebrow">
          Olympuss AI
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-ops-ink">Set up your account</h1>
      </div>
      <OpsAcceptInviteForm token={token} />
    </main>
  );
}
