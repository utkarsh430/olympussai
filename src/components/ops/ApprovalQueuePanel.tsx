'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ACTION_LABEL } from '@/lib/ops/recommendationView';
import { humaniseEnum } from '@/lib/ops/vocabulary';
import type { CommandActionType } from '@/models/control';

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

type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; actions: QueuedAction[] };

/**
 * Approval queue for disruptive dispatcher actions (this ticket's AC2:
 * "handles disruptive actions (skip/short-turn/standby/boarding-limits);
 * decisions logged with reason and actor"). Reads GET
 * /api/ops/dispatcher/approvals (status=pending, disruptiveOnly=true by
 * default). Two render modes:
 *   - canDecide=false (dispatcher dashboard): read-only visibility into
 *     the queue so a dispatcher can track what they've filed.
 *   - canDecide=true (control-room console): adds a "Refuse" action
 *     (POST /api/ops/control-room/approvals/:id/reject) and an "Approve and
 *     send" button that hands the reference to onApprove, which
 *     ControlRoomConsole wires to ControlRoomCommandForm — approving *is*
 *     sending the instruction that consumes this reference, per that form's
 *     own doc comment.
 *
 * The words on screen were changed with the control room's language pass and
 * the wire contract was not: the endpoint, its `reject` path and the
 * `dispatcherActionId` it consumes are all untouched. "Refuse" rather than
 * "Reject" because this is a person declining a colleague's request, and
 * every enum that used to render raw here — `terminal_dispatch_hold` with one
 * underscore swapped, as the headline of a decision — now goes through
 * src/lib/ops/vocabulary.ts.
 */
export function ApprovalQueuePanel({
  canDecide,
  onApprove,
  disruptiveOnly = true,
  refreshToken,
}: {
  canDecide: boolean;
  onApprove?: (dispatcherActionId: string) => void;
  /**
   * Narrow to the four disruptive action types, as the AC's queue does.
   *
   * The control-room console passes `false`, and that is load-bearing rather
   * than a preference: the decision engine only ever proposes HOLDS, and holds
   * are not in the disruptive subset. Left at the default, a dispatcher's
   * approval of the exact hold the engine just recommended would never appear
   * in the control room's own queue.
   */
  disruptiveOnly?: boolean;
  /**
   * Reload whenever this changes. The console drives every panel from one
   * clock so the whole screen describes the same moment; without it this queue
   * would keep showing whatever was pending when the page was opened, which on
   * a time-critical queue is the one thing it must not do.
   */
  refreshToken?: number;
}) {
  const [state, setState] = useState<FetchState>({ status: 'loading' });
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /**
   * `silent` is what makes an auto-refreshing queue usable.
   *
   * A background reload that flips this panel back to its "Loading approval
   * queue…" placeholder would, every fifteen seconds, blank the list an
   * operator is reading and tear the half-typed rejection reason out from
   * under them. So a poll leaves the current list on screen and swaps it only
   * once the new one has actually arrived; only the first load, and an
   * explicit reload after the operator's own action, show the placeholder.
   */
  const load = useCallback(
    async (silent = false) => {
      if (!silent) setState({ status: 'loading' });
      try {
        const response = await fetch(
          `/api/ops/dispatcher/approvals?status=pending&disruptiveOnly=${disruptiveOnly ? 'true' : 'false'}`,
          { cache: 'no-store' },
        );
        const data = (await response.json().catch(() => null)) as
          { actions: QueuedAction[] } | { error: { message: string } } | null;
        if (!response.ok || !data || 'error' in data) {
          const message =
            (data && 'error' in data && data.error.message) ||
            'What is waiting for a decision could not be read. Try again.';
          // A failed BACKGROUND poll must not replace a good list with an
          // error: the queue on screen is still the last real one. The
          // console's own status line reports the refresh failure.
          setState((previous) =>
            silent && previous.status === 'ready' ? previous : { status: 'error', message },
          );
          return;
        }
        setState({ status: 'ready', actions: data.actions });
      } catch {
        setState((previous) =>
          silent && previous.status === 'ready'
            ? previous
            : {
                status: 'error',
                message: 'What is waiting for a decision could not be read. Try again.',
              },
        );
      }
    },
    [disruptiveOnly],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Separate from the mount effect so a console tick refreshes quietly while
  // the first load, and a reload after this operator's own reject, do not.
  const hasMountedRef = useRef(false);
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    void load(true);
  }, [refreshToken, load]);

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
      const data = (await response.json().catch(() => null)) as
        { ok: true } | { error: { message: string } } | null;
      if (!response.ok || !data || !('ok' in data)) {
        setRejectError(
          (data && 'error' in data && data.error.message) ||
            'The refusal was not saved. Try again.',
        );
        setSubmitting(false);
        return;
      }
      setRejectingId(null);
      setRejectReason('');
      setSubmitting(false);
      await load();
    } catch {
      setRejectError('The refusal was not saved — the console could not be reached. Try again.');
      setSubmitting(false);
    }
  }

  if (state.status === 'loading') {
    return <p className="text-sm text-muted-foreground">Loading what is waiting…</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.message}
      </p>
    );
  }
  if (state.actions.length === 0) {
    return (
      <p className="ops-well px-4 py-3 text-sm text-muted-foreground">
        {/* The wording has to match what was actually asked for. Saying "no
            disruptive actions" on the control-room console, which reads the
            queue unfiltered, would imply a narrower search than the one that
            came back empty. */}
        {disruptiveOnly
          ? 'Nothing disruptive is waiting for a decision.'
          : 'Nothing is waiting for a decision, of any kind.'}
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {state.actions.map((action) => (
        <li key={action.id} className="rounded-md border border-border px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Named, not the raw enum. This panel printed
                `terminal_dispatch_hold` with one underscore swapped, in a mono
                face, as the headline of a decision a person had to make. */}
            <span className="text-xs font-medium text-primary">
              {ACTION_LABEL[action.actionType as CommandActionType] ??
                humaniseEnum(action.actionType)}
            </span>
            <span className="text-[11px] text-subtle">
              {new Date(action.createdAt).toLocaleString()}
            </span>
          </div>
          <p className="mt-1 text-sm text-foreground">{action.reason}</p>
          <p className="mt-1 text-[11px] text-subtle">
            {[
              action.vehicleId ? `bus ${action.vehicleId}` : null,
              action.routeDirectionId ? `corridor ${action.routeDirectionId}` : null,
              action.incidentId ? `incident ${action.incidentId}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'nothing specific named'}
          </p>
          <p className="mt-1 font-mono text-[10px] text-subtle">Approval reference {action.id}</p>

          {canDecide && (
            <div className="mt-3 space-y-2 border-t border-border/70 pt-3">
              {rejectingId === action.id ? (
                <div className="space-y-2">
                  <label
                    htmlFor={`reject-reason-${action.id}`}
                    className="block text-xs text-muted-foreground"
                  >
                    Why you are refusing this
                  </label>
                  <textarea
                    id={`reject-reason-${action.id}`}
                    required
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    rows={2}
                    className="ops-input"
                  />
                  {rejectError && (
                    <p role="alert" className="text-xs text-destructive">
                      {rejectError}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={submitting || rejectReason.trim().length === 0}
                      onClick={() => submitReject(action.id)}
                      className="ops-button-danger"
                    >
                      {submitting ? 'Refusing…' : 'Confirm refusal'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRejectingId(null);
                        setRejectError(null);
                      }}
                      className="ops-button"
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
                    className="ops-button border-success/60 bg-success/10 text-success hover:border-success hover:bg-success/20"
                  >
                    Approve and send
                  </button>
                  <button
                    type="button"
                    onClick={() => setRejectingId(action.id)}
                    className="ops-button-danger"
                  >
                    Refuse
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
