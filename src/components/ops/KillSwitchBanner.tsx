import type { KillSwitchRecord } from '@/lib/auth/rbac/repo';

/**
 * Read-only "automation halted" banner for dispatcher/depot (this ticket's
 * AC4: kill switches must be visible wherever they change what's safe to
 * propose, not just on the control-room console that engages them).
 * `routeDirectionId` scopes which route-level switch (if any) is relevant
 * to what's currently in view; a network-wide switch always shows.
 */
export function KillSwitchBanner({
  activeKillSwitches,
  routeDirectionId,
}: {
  activeKillSwitches: KillSwitchRecord[];
  routeDirectionId?: string | null;
}) {
  const relevant = activeKillSwitches.filter(
    (ks) => ks.scope === 'network' || (routeDirectionId != null && ks.routeDirectionId === routeDirectionId),
  );
  if (relevant.length === 0) return null;

  return (
    <div role="alert" className="mb-6 space-y-2 rounded-md border border-[#f0857d]/40 bg-[#f0857d]/10 px-4 py-3 text-sm text-[#f5a89f]">
      {relevant.map((ks) => (
        <p key={ks.id}>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em]">Kill switch engaged</span> —{' '}
          {ks.scope === 'network' ? 'network-wide' : `route-direction ${ks.routeDirectionId}`}: new automatic
          commands are halted. Reason: {ks.reason}
        </p>
      ))}
    </div>
  );
}
