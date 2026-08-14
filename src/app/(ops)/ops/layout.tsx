/**
 * Route-group ground for the ops RBAC surface (driver/pilot-driver/
 * dispatcher/depot/control-room/planner/admin).
 *
 * Thin on purpose. The console's actual chrome — navigation, identity,
 * sign-out, the status strip and the map-scale main pane — is
 * `OpsShell` (src/components/ops/OpsShell.tsx), which each page mounts
 * itself. This layout only paints the ground beneath it, so that the
 * unguarded pages in this group (login, forbidden, accept-invite) share the
 * same environment without inheriting a shell that assumes a signed-in
 * operator.
 *
 * It no longer claims to be visually separate from the command centre. It
 * was, deliberately, while /ops/* was a stopgap auth surface; the two are
 * now one product with one design language, lifted from /project/upsrtc into
 * the `ops` tokens in tailwind.config.ts and the `.ops-*` classes in
 * globals.css.
 *
 * This layout does NOT enforce auth itself; each role subtree
 * (ops/<role>/layout.tsx) and ops/login, ops/forbidden, ops/accept-invite
 * enforce whatever they individually need.
 */
export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-ops-ground className="min-h-[100dvh] bg-ops-bg text-ops-ink antialiased">
      {children}
    </div>
  );
}
