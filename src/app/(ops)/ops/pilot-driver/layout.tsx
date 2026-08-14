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
  /**
   * The installed PWA's status bar, in BOTH themes.
   *
   * A single value here was correct while the console was dark-only. It is not
   * any more: a driver who chooses light mode would get a light page under a
   * near-black status bar, which on a phone reads as a rendering fault rather
   * than a theme. These are the measured page grounds from globals.css - dark
   * #02040a, light #eef2f7 - and the browser picks by the same media query the
   * stylesheet uses.
   *
   * This follows the DEVICE, while the in-app toggle can override the page. A
   * driver who has explicitly chosen light on a dark-set phone therefore still
   * gets the dark status bar; there is no web API that lets the page correct
   * that after the fact, and a wrong-by-one-bar status strip is a far smaller
   * problem than the unreadable-in-sunlight map this redesign fixes.
   */
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eef2f7' },
    { media: '(prefers-color-scheme: dark)', color: '#02040a' },
  ],
  width: 'device-width',
  initialScale: 1,
  /**
   * A driver reading this in sunlight will pinch to zoom, and must be allowed
   * to. `maximumScale: 1` is the usual PWA reflex and it is an accessibility
   * failure on the one screen in this product used outdoors by someone who may
   * be presbyopic. Left unset deliberately.
   */
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
