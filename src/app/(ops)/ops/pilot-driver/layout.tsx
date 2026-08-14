import type { Metadata, Viewport } from 'next';
import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';

// Installable-PWA metadata (AC: "Installable as PWA"). Scoped to this one
// route via <link rel="manifest"> — no other /ops surface gets a manifest
// or service worker, so this never changes install/offline behavior
// anywhere else in the app.
export const metadata: Metadata = {
  title: 'Pilot Driver · Ops',
  robots: { index: false, follow: false },
  manifest: '/pilot-driver/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Pilot Driver',
  },
};

export const viewport: Viewport = {
  // The console's own ground (tailwind `ops.bg`), so the installed PWA's
  // status bar does not sit a shade off the page behind it.
  themeColor: '#02040a',
  width: 'device-width',
  initialScale: 1,
};

export default async function PilotDriverLayout({ children }: { children: React.ReactNode }) {
  // requireOpsRolePage() enforces the "delivered only to RBAC-provisioned
  // pilot driver accounts" acceptance criterion for the page itself; the
  // API routes under /api/ops/pilot-driver/* enforce it again independently
  // (requireOpsRole(['pilot_driver'])), same defence-in-depth as every
  // other ops role.
  await requireOpsRolePage('pilot_driver', '/ops/pilot-driver');
  return <>{children}</>;
}
