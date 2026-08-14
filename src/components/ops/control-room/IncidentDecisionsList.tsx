import { ACTION_LABEL } from '@/lib/ops/recommendationView';
import { humaniseEnum } from '@/lib/ops/vocabulary';
import type { CommandActionType } from '@/models/control';

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
      <p className="ops-well px-4 py-3 text-sm text-muted-foreground">
        No dispatcher has asked for anything on this incident yet.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {decisions.map((d) => {
        const decision = d.rejectedAt ? 'rejected' : d.consumedAt ? 'approved' : 'pending';
        return (
          <li key={d.id} className="rounded-md border border-border px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-primary">
                {ACTION_LABEL[d.actionType as CommandActionType] ?? humaniseEnum(d.actionType)}
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] ${
                  decision === 'approved'
                    ? 'border-success/40 bg-success/10 text-success'
                    : decision === 'rejected'
                      ? 'border-destructive/40 bg-destructive/10 text-destructive'
                      : 'border-warning/40 bg-warning/10 text-warning'
                }`}
              >
                {decision === 'approved'
                  ? 'Approved'
                  : decision === 'rejected'
                    ? 'Refused'
                    : 'Waiting'}
              </span>
            </div>
            <p className="mt-1 text-sm text-foreground">{d.reason}</p>
            <p className="mt-1 text-[11px] text-subtle">
              Asked for {new Date(d.createdAt).toLocaleString()} by dispatcher {d.dispatcherUserId}
            </p>
            {decision === 'rejected' && (
              <p className="mt-1 text-[11px] text-destructive">
                Refused {new Date(d.rejectedAt!).toLocaleString()} by {d.rejectedBy}:{' '}
                {d.rejectionReason}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
