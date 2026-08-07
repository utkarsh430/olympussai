'use client';

import { useEffect, useId, useState } from 'react';

const TARGET_TYPES = ['vehicle', 'route_direction', 'trip'] as const;
type TargetType = (typeof TARGET_TYPES)[number];

interface SuccessState {
  auditEventId: string;
  createdAt: string;
}

/**
 * Functional in-page action for POST /api/ops/control-room/commands (this
 * ticket's AC3). Requires a dispatcherActionId from an unconsumed
 * dispatcher approval (POST /api/ops/dispatcher/approvals) — the endpoint
 * enforces that non-negotiably (docs/CONTROL_SERVICE_INTEGRATION.md §1), so
 * a 409 DISPATCHER_ACTION_INVALID is a normal, expected error to surface
 * here, not a bug.
 *
 * `prefillDispatcherActionId` is set by the approval queue's "Approve —
 * issue command" action (ApprovalQueuePanel via
 * ApprovalAndCommandPanel): issuing a command that consumes a queued
 * action *is* the approval decision for this ticket's approval-queue AC,
 * so that flow seeds this field rather than duplicating a separate
 * approve endpoint.
 */
export function ControlRoomCommandForm({ prefillDispatcherActionId }: { prefillDispatcherActionId?: string }) {
  const [summary, setSummary] = useState('');
  const [dispatcherActionId, setDispatcherActionId] = useState(prefillDispatcherActionId ?? '');
  const [targetType, setTargetType] = useState<TargetType>('vehicle');
  const [targetId, setTargetId] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error' | 'success'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  const errorId = useId();
  const successId = useId();

  useEffect(() => {
    if (prefillDispatcherActionId) setDispatcherActionId(prefillDispatcherActionId);
  }, [prefillDispatcherActionId]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (status === 'submitting') return;
    setStatus('submitting');
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/ops/control-room/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary, dispatcherActionId, targetType, targetId }),
      });

      const data = (await response.json().catch(() => null)) as
        | { ok: true; auditEventId: string; createdAt: string }
        | { error: { code: string; message: string } }
        | null;

      if (!response.ok || !data || !('ok' in data)) {
        setError((data && 'error' in data && data.error.message) || 'Failed to issue the command.');
        setStatus('error');
        return;
      }

      setSuccess({ auditEventId: data.auditEventId, createdAt: data.createdAt });
      setStatus('success');
      setSummary('');
      setDispatcherActionId('');
      setTargetId('');
    } catch {
      setError('Something went wrong. Please try again.');
      setStatus('error');
    }
  }

  const submitting = status === 'submitting';

  return (
    <form
      id="control-room-command-form"
      onSubmit={handleSubmit}
      className="space-y-4 rounded-md border border-[rgba(255,255,255,0.08)] p-4"
    >
      <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">Issue command</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="dispatcherActionId" className="mb-1 block text-xs text-[#9aa0ad]">
            Dispatcher action id
          </label>
          <input
            id="dispatcherActionId"
            required
            value={dispatcherActionId}
            onChange={(e) => setDispatcherActionId(e.target.value)}
            placeholder="uuid from a dispatcher approval"
            aria-describedby={error ? errorId : undefined}
            className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-3 py-2 text-sm text-[#e6e9ef] placeholder:text-[#707580] focus:border-[#4f8cff]/70 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="targetType" className="mb-1 block text-xs text-[#9aa0ad]">
            Target type
          </label>
          <select
            id="targetType"
            value={targetType}
            onChange={(e) => setTargetType(e.target.value as TargetType)}
            className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-3 py-2 text-sm text-[#e6e9ef] focus:border-[#4f8cff]/70 focus:outline-none"
          >
            {TARGET_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="targetId" className="mb-1 block text-xs text-[#9aa0ad]">
            Target id
          </label>
          <input
            id="targetId"
            required
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            placeholder="e.g. a vehicle registration"
            className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-3 py-2 text-sm text-[#e6e9ef] placeholder:text-[#707580] focus:border-[#4f8cff]/70 focus:outline-none"
          />
        </div>
      </div>

      <div>
        <label htmlFor="summary" className="mb-1 block text-xs text-[#9aa0ad]">
          Summary
        </label>
        <textarea
          id="summary"
          required
          minLength={1}
          maxLength={2000}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-3 py-2 text-sm text-[#e6e9ef] placeholder:text-[#707580] focus:border-[#4f8cff]/70 focus:outline-none"
        />
      </div>

      {error && (
        <p id={errorId} role="alert" className="text-sm text-[#f0857d]">
          {error}
        </p>
      )}

      {success && (
        <p id={successId} role="status" className="text-sm text-[#7fd9a4]">
          Command issued and audited. auditEventId:{' '}
          <code className="rounded bg-[rgba(255,255,255,0.08)] px-1.5 py-0.5 font-mono text-[#e6e9ef]">
            {success.auditEventId}
          </code>
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || summary.trim().length === 0 || dispatcherActionId.trim().length === 0 || targetId.trim().length === 0}
        className="bg-[#4f8cff]/12 rounded-md border border-[#4f8cff]/60 px-5 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#8fb4ff] transition-all hover:bg-[#4f8cff]/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? 'Issuing…' : 'Issue command'}
      </button>
    </form>
  );
}
