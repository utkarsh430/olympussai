'use client';

import { useId, useState } from 'react';

const ACTION_TYPES = [
  'terminal_dispatch_hold',
  'two_way_hold',
  'self_equalizing_hold',
  'speed_guidance',
  'stop_skip',
  'short_turn',
  'deadhead',
  'boarding_limit',
  'standby_injection',
  'override',
] as const;

type ActionType = (typeof ACTION_TYPES)[number];

interface SuccessState {
  dispatcherActionId: string;
  createdAt: string;
}

/**
 * Functional in-page action for POST /api/ops/dispatcher/approvals (this
 * ticket's AC3: "surfaced ... as functional in-page actions ... rather than
 * plain links"). A successful submission returns the new
 * dispatcherActionId, the id Control Room needs to reference from
 * POST /api/ops/control-room/commands — shown prominently so a dispatcher
 * can hand it off.
 */
export function DispatcherActionForm() {
  const [actionType, setActionType] = useState<ActionType>('override');
  const [reason, setReason] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [routeDirectionId, setRouteDirectionId] = useState('');
  const [incidentId, setIncidentId] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error' | 'success'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  const errorId = useId();
  const successId = useId();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (status === 'submitting') return;
    setStatus('submitting');
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/ops/dispatcher/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionType,
          reason,
          vehicleId: vehicleId.trim() || undefined,
          routeDirectionId: routeDirectionId.trim() || undefined,
          incidentId: incidentId.trim() || undefined,
        }),
      });

      const data = (await response.json().catch(() => null)) as
        | { ok: true; dispatcherActionId: string; createdAt: string }
        | { error: { code: string; message: string } }
        | null;

      if (!response.ok || !data || !('ok' in data)) {
        setError((data && 'error' in data && data.error.message) || 'Failed to record the approval.');
        setStatus('error');
        return;
      }

      setSuccess({ dispatcherActionId: data.dispatcherActionId, createdAt: data.createdAt });
      setStatus('success');
      setReason('');
    } catch {
      setError('Something went wrong. Please try again.');
      setStatus('error');
    }
  }

  const submitting = status === 'submitting';

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-md border border-[rgba(255,255,255,0.08)] p-4">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">
        Record approval / override
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="actionType" className="mb-1 block text-xs text-[#9aa0ad]">
            Action type
          </label>
          <select
            id="actionType"
            value={actionType}
            onChange={(e) => setActionType(e.target.value as ActionType)}
            className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-3 py-2 text-sm text-[#e6e9ef] focus:border-[#4f8cff]/70 focus:outline-none"
          >
            {ACTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="vehicleId" className="mb-1 block text-xs text-[#9aa0ad]">
            Vehicle (optional)
          </label>
          <input
            id="vehicleId"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            placeholder="e.g. UP25FT4823"
            className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-3 py-2 text-sm text-[#e6e9ef] placeholder:text-[#707580] focus:border-[#4f8cff]/70 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="routeDirectionId" className="mb-1 block text-xs text-[#9aa0ad]">
            Route direction (optional)
          </label>
          <input
            id="routeDirectionId"
            value={routeDirectionId}
            onChange={(e) => setRouteDirectionId(e.target.value)}
            className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-3 py-2 text-sm text-[#e6e9ef] focus:border-[#4f8cff]/70 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="incidentId" className="mb-1 block text-xs text-[#9aa0ad]">
            Incident (optional)
          </label>
          <input
            id="incidentId"
            value={incidentId}
            onChange={(e) => setIncidentId(e.target.value)}
            className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-3 py-2 text-sm text-[#e6e9ef] focus:border-[#4f8cff]/70 focus:outline-none"
          />
        </div>
      </div>

      <div>
        <label htmlFor="reason" className="mb-1 block text-xs text-[#9aa0ad]">
          Reason
        </label>
        <textarea
          id="reason"
          required
          minLength={1}
          maxLength={2000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          aria-describedby={error ? errorId : undefined}
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
          Recorded. dispatcherActionId:{' '}
          <code className="rounded bg-[rgba(255,255,255,0.08)] px-1.5 py-0.5 font-mono text-[#e6e9ef]">
            {success.dispatcherActionId}
          </code>{' '}
          — pass this to Control Room to authorize a command.
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || reason.trim().length === 0}
        className="bg-[#4f8cff]/12 rounded-md border border-[#4f8cff]/60 px-5 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#8fb4ff] transition-all hover:bg-[#4f8cff]/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? 'Recording…' : 'Record approval / override'}
      </button>
    </form>
  );
}
