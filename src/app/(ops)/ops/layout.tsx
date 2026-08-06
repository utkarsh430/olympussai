/**
 * Shared shell for the ops RBAC surface (driver/dispatcher/depot/
 * control-room/planner/admin). Deliberately minimal and separate from the
 * pitch-demo command-centre shell ((protected)/project/upsrtc/layout.tsx) —
 * no shared styling, fonts, or state between the two auth surfaces.
 *
 * This layout does NOT enforce auth itself; each role subtree
 * (ops/<role>/layout.tsx) and ops/login, ops/forbidden, ops/accept-invite
 * enforce whatever they individually need.
 */
export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-[100dvh] bg-[#0a0b10] text-[#e6e9ef] antialiased">{children}</div>;
}
