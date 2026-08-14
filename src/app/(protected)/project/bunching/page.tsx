import type { Metadata } from 'next';
import { requireProjectSurface } from '@/lib/auth/projectPageGuard';
import { BunchingSimulator } from '@/components/bunching/BunchingSimulator';
import { listRehearsalCorridors } from '@/lib/controlService/rehearsalData';
import type { RouteDirectionMeta } from '@/models/control';

/**
 * Control-strategy rehearsal — a protected UPSRTC project surface.
 *
 * Sits under `/project/*`, so edge middleware gates it exactly like the
 * operations dashboards. This server component then re-decides admission
 * independently (the same defence-in-depth pattern the dashboard layout
 * uses): a request without an ACTIVE ops profile never renders simulator
 * markup.
 *
 * It is its own gate rather than an inherited one BECAUSE it is deliberately
 * not nested under the dashboard layout — so there is no shared parent to
 * carry the check, and a `/project/*` surface that forgot to call
 * `requireProjectSurface` would simply be open. That is a structural risk
 * rather than a stylistic one, so it is held by a test that walks this
 * directory: src/tests/unit/projectSurfaceOpsGate.test.ts.
 *
 * ─── WHY IT NOW WEARS THE OPS DESIGN SYSTEM ──────────────────────────────
 *
 * The page this replaced had its own light `sim-*` palette and its own
 * Google Maps mount, because what it showed was a scripted scenario on a
 * fabricated corridor and it belonged to no operational surface. What runs
 * here now is the control service's own simulator over a real seeded
 * corridor, its real stops and its real control policy, driven by the
 * deployed control laws. It is part of the same product as the control room
 * and the depot console, so it uses the same shell, the same primitives and
 * the same map — and the same `sim` badge the design system already carries
 * for exactly this, so that reusing the operational look never becomes a
 * claim to be operational.
 *
 * ─── THE CORRIDOR LIST IS FETCHED HERE, NOT IN THE BROWSER ───────────────
 *
 * One server read on first paint, so the picker is populated before the
 * operator touches anything. It is the statewide route-direction list — the
 * same one the depot console reads — and it carries no vehicle, so it is not
 * a fleet-scoping decision. The runs themselves are POSTed from the client,
 * because an operator changes an input precisely to get a different answer.
 */
export const metadata: Metadata = {
  title: 'Control Strategy Rehearsal · UPSRTC',
  // Protected surface — never indexed.
  robots: { index: false, follow: false },
};

export default async function BunchingPage() {
  const claims = await requireProjectSurface('/project/bunching');

  // Degrades rather than throws: a corridor list that could not be read is
  // an outage to explain, not a 500. The picker is empty and the page says
  // why, which is the same contract every other control-service-backed ops
  // surface keeps.
  let corridors: RouteDirectionMeta[] = [];
  let corridorsError: string | null = null;
  try {
    corridors = await listRehearsalCorridors();
  } catch {
    corridorsError =
      'The corridor list could not be read, so no rehearsal can be set up right now. The simulator service is unreachable or not configured.';
  }

  return (
    <BunchingSimulator
      email={claims.email}
      role={claims.role}
      corridors={corridors}
      corridorsError={corridorsError}
    />
  );
}
