'use client';

import { useCallback, useEffect, useState } from 'react';

interface QueuedAction {
  id: string;
  dispatcherUserId: string;
  actionType: string;
  reason: string;
  routeDirectionId: string | null;
  vehicleId: string | null;
  incidentId: string | null;
  consumedAt: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  rejectionReason: string | null;
  createdAt: string;
  decision: 'pending' | 'approved' | 'rejected';
}

type FetchState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; actions: QueuedAction[] };

/**
 * Approval queue for disruptive dispatcher actions (this ticket's AC2:
 * "handles disruptive actions (skip/short-turn/standby/boarding-limits);
 * decisions logged with reason and actor"). Reads GET
 * /api/ops/dispatcher/approvals (status=pending, disruptiveOnly=true by
 * default). Two render modes:
 *   - canDecide=false (dispatcher dashboard): read-only visibility into
 *     the queue so a dispatcher can track what they've filed.
 *   - canDecide=true (control-room dashboard): adds a "Reject" action
 *     (POST /api/ops/control-room/approvals/:id/reject) and an "Approve —
 *     issue command" button that hands the id to onApprove, which
 *     ApprovalAndCommandPanel wires to ControlRoomCommandForm — approving
 *     *is* issuing the command that consumes this id, per that form's own
 *     doc comment.
 */
export function ApprovalQueuePanel({
  canDecide,
  onApprove,
}: {
  canDecide: boolean;
  onApprove?: (dispatcherActionId: string) => void;
}) {
  const [state, setState] = useState<FetchState>({ status: 'loading' });
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const response = await fetch('/api/ops/dispatcher/approvals?status=pending&disruptiveOnly=true', {
        cache: 'no-store',
      });
      const data = (await response.json().catch(() => null)) as
        | { actions: QueuedAction[] }
        | { error: { message: string } }
        | null;
      if (!response.ok || !data || 'error' in data) {
        setState({ status: 'error', message: (data && 'error' in data && data.error.message) || 'Failed to load the approval queue.' });
        return;
      }
      setState({ status: 'ready', actions: data.actions });
    } catch {
      setState({ status: 'error', message: 'Something went wrong. Please try again.' });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function submitReject(id: string) {
    if (submitting) return;
    setSubmitting(true);
    setRejectError(null);
    try {
      const response = await fetch(`/api/ops/control-room/approvals/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason }),
      });
      const data = (await response.json().catch(() => null)) as { ok: true } | { error: { message: string } } | null;
      if (!response.ok || !data || !('ok' in data)) {
        setRejectError((data && 'error' in data && data.error.message) || 'Failed to reject this action.');
        setSubmitting(false);
        return;
      }
      setRejectingId(null);
      setRejectReason('');
      setSubmitting(false);
      await load();
    } catch {
      setRejectError('Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  if (state.status === 'loading') {
    return <p className="text-sm text-[#9aa0ad]">Loading approval queue…</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="text-sm text-[#f0857d]">
        {state.message}
      </p>
    );
  }
  if (state.actions.length === 0) {
    return (
      <p className="rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-4 py-3 text-sm text-[#9aa0ad]">
        No disruptive actions awaiting a decision.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {state.actions.map((action) => (
        <li key={action.id} className="rounded-md border border-[rgba(255,255,255,0.08)] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-mono text-xs uppercase tracking-[0.1em] text-[#8fb4ff]">
              {action.actionType.replace(/_/g, ' ')}
            </span>
            <span className="text-[11px] text-[#6f7684]">{new Date(action.createdAt).toLocaleString()}</span>
          </div>
          <p className="mt-1 text-sm text-[#e6e9ef]">{action.reason}</p>
          <p className="mt-1 font-mono text-[11px] text-[#6f7684]">
            {[
              action.vehicleId ? `vehicle ${action.vehicleId}` : null,
              action.routeDirectionId ? `route-direction ${action.routeDirectionId}` : null,
              action.incidentId ? `incident ${action.incidentId}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'no target scoped'}
          </p>
          <p className="mt-1 font-mono text-[10px] text-[#6f7684]">id: {action.id}</p>

          {canDecide && (
            <div className="mt-3 space-y-2 border-t border-[rgba(255,255,255,0.06)] pt-3">
              {rejectingId === action.id ? (
                <div className="space-y-2">
                  <label htmlFor={`reject-reason-${action.id}`} className="block text-xs text-[#9aa0ad]">
                    Rejection reason
                  </label>
                  <textarea
                    id={`reject-reason-${action.id}`}
                    required
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    rows={2}
                    className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-3 py-2 text-sm text-[#e6e9ef] focus:border-[#4f8cff]/70 focus:outline-none"
                  />
                  {rejectError && (
                    <p role="alert" className="text-xs text-[#f0857d]">
                      {rejectError}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={submitting || rejectReason.trim().length === 0}
                      onClick={() => submitReject(action.id)}
                      className="rounded-md border border-[#f0857d]/60 bg-[#f0857d]/12 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#f5a89f] hover:bg-[#f0857d]/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {submitting ? 'Rejecting…' : 'Confirm reject'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRejectingId(null);
                        setRejectError(null);
                      }}
                      className="rounded-md border border-[rgba(255,255,255,0.14)] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#9aa0ad] hover:border-[#4f8cff]/60"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onApprove?.(action.id)}
                    className="rounded-md border border-[#4fbf82]/60 bg-[#4fbf82]/12 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#7fd9a4] hover:bg-[#4fbf82]/20"
                  >
                    Approve — issue command
                  </button>
                  <button
                    type="button"
                    onClick={() => setRejectingId(action.id)}
                    className="rounded-md border border-[#f0857d]/60 bg-[#f0857d]/12 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#f5a89f] hover:bg-[#f0857d]/20"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
