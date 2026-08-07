interface DecisionAction {
  id: string;
  actionType: string;
  reason: string;
  dispatcherUserId: string;
  consumedAt: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

/**
 * Incident timeline's "decision" stage (this ticket's AC3): every
 * dispatcher action filed against this incident, with its terminal
 * decision if any — approved (consumed into a command) or rejected, each
 * attributed to the actor who decided it. Read from this app's own
 * ops_dispatcher_actions (the real source of decisions this app owns),
 * not fabricated from control-service state.
 */
export function IncidentDecisionsList({ decisions }: { decisions: DecisionAction[] }) {
  if (decisions.length === 0) {
    return (
      <p className="rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-4 py-3 text-sm text-[#9aa0ad]">
        No dispatcher action has been filed against this incident yet.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {decisions.map((d) => {
        const decision = d.rejectedAt ? 'rejected' : d.consumedAt ? 'approved' : 'pending';
        return (
          <li key={d.id} className="rounded-md border border-[rgba(255,255,255,0.08)] px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs uppercase tracking-[0.1em] text-[#8fb4ff]">
                {d.actionType.replace(/_/g, ' ')}
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ${
                  decision === 'approved'
                    ? 'border-[#4fbf82]/40 bg-[#4fbf82]/10 text-[#7fd9a4]'
                    : decision === 'rejected'
                      ? 'border-[#f0857d]/40 bg-[#f0857d]/10 text-[#f5a89f]'
                      : 'border-[#e8b34a]/40 bg-[#e8b34a]/10 text-[#e8c07a]'
                }`}
              >
                {decision}
              </span>
            </div>
            <p className="mt-1 text-sm text-[#e6e9ef]">{d.reason}</p>
            <p className="mt-1 text-[11px] text-[#6f7684]">
              Filed {new Date(d.createdAt).toLocaleString()} by dispatcher {d.dispatcherUserId}
            </p>
            {decision === 'rejected' && (
              <p className="mt-1 text-[11px] text-[#f5a89f]">
                Rejected {new Date(d.rejectedAt!).toLocaleString()} by {d.rejectedBy}: {d.rejectionReason}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
