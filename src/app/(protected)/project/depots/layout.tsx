import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';
import { requireProjectSession } from '@/lib/auth/server';
import { DEPOTS_ROOT } from '@/lib/depot/nav';
import { DepotShell } from '@/components/depot/shell/DepotShell';

/**
 * Depot Management shell. Re-verifies the session independently of middleware
 * (defence in depth, same as the other project surfaces) so an unauthenticated
 * request never renders shell markup. Deliberately not nested inside
 * `upsrtc/layout.tsx`: depot pages scroll and use no CSS zoom.
 */
export const metadata: Metadata = {
  title: 'Depot Management · UPSRTC',
  // Protected surface — never indexed.
  robots: { index: false, follow: false },
};

const sans = Manrope({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
});

export default async function DepotsLayout({ children }: { children: React.ReactNode }) {
  await requireProjectSession(DEPOTS_ROOT);

  return (
    <div className={sans.variable}>
      <DepotShell>{children}</DepotShell>
    </div>
  );
}
