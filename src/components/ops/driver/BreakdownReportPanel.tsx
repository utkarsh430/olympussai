'use client';

import { useId, useState } from 'react';

const CATEGORIES = ['Mechanical', 'Electrical', 'Tyre/wheel', 'Accident', 'Other'] as const;

interface SuccessState {
  breakdownReportId: string;
  createdAt: string;
  summary: string;
}

/**
 * Driver breakdown reporting (AC5's driver-scope example). Submits to the
 * audited-action endpoint POST /api/ops/driver/breakdown-reports (filed as
 * follow-up work per parent ticket 49d5b2d8's out-of-scope note, built in
 * this ticket) — same success/error UI pattern as DispatcherActionForm and
 * ControlRoomCommandForm. On success it also renders the composed summary
 * so the driver can still read it out over radio/phone if that channel is
 * faster than waiting for dispatch to see the persisted report.
 *
 * `defaultVehicleReg` is DriverDashboard's admin-assigned vehicle (see that
 * component's own doc comment) when the driver has one. It is only ever a
 * starting value here; the field stays editable, since a wrong or duplicate
 * report a driver chooses to file only affects their own submission, unlike
 * the pilot-driver command-ack path, where a wrong vehicle can expose
 * another vehicle's commands.
 *
 * `onSubmitted` fires after a successful submit so a sibling
 * BreakdownReportsPanel (scope="mine") can refresh — otherwise a driver
 * files a report and their own history still shows stale data.
 */
export function BreakdownReportPanel({
  defaultVehicleReg = '',
  onSubmitted,
}: {
  defaultVehicleReg?: string;
  onSubmitted?: () => void;
}) {
  const [vehicleReg, setVehicleReg] = useState(defaultVehicleReg);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('Mechanical');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error' | 'success'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SuccessState | null>(null);

  const vehicleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const successId = useId();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (status === 'submitting') return;
    setStatus('submitting');
    setError(null);
    setSuccess(null);

    const trimmedVehicleReg = vehicleReg.trim();
    const trimmedDescription = description.trim();

    try {
      const response = await fetch('/api/ops/driver/breakdown-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleReg: trimmedVehicleReg,
          category,
          description: trimmedDescription,
        }),
      });

      const data = (await response.json().catch(() => null)) as
        | { ok: true; breakdownReportId: string; createdAt: string }
        | { error: { code: string; message: string } }
        | null;

      if (!response.ok || !data || !('ok' in data)) {
        setError((data && 'error' in data && data.error.message) || 'Failed to submit the breakdown report.');
        setStatus('error');
        return;
      }

      const timestamp = new Date(data.createdAt).toLocaleString();
      setSuccess({
        breakdownReportId: data.breakdownReportId,
        createdAt: data.createdAt,
        summary: `Breakdown report — ${timestamp}\nVehicle: ${trimmedVehicleReg || 'unspecified'}\nCategory: ${category}\nDetails: ${trimmedDescription || '(none given)'}`,
      });
      setStatus('success');
      setDescription('');
      onSubmitted?.();
    } catch {
      setError('Something went wrong. Please try again.');
      setStatus('error');
    }
  }

  const submitting = status === 'submitting';

  return (
    <div className="rounded-md border border-[rgba(255,255,255,0.08)] p-4">
      <h2 className="mb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">
        Report a breakdown
      </h2>
      <p className="mb-3 text-xs text-[#9aa0ad]">
        Submits a persisted, audited breakdown report to dispatch. Once submitted, the composed
        summary below is also shown so you can read it out over radio/phone if that is faster.
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={vehicleId} className="mb-1 block text-xs text-[#9aa0ad]">
              Vehicle
            </label>
            <input
              id={vehicleId}
              value={vehicleReg}
              onChange={(e) => setVehicleReg(e.target.value)}
              placeholder="e.g. UP25FT4823"
              className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-3 py-2 text-sm text-[#e6e9ef] placeholder:text-[#707580] focus:border-[#4f8cff]/70 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="breakdown-category" className="mb-1 block text-xs text-[#9aa0ad]">
              Category
            </label>
            <select
              id="breakdown-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}
              className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-3 py-2 text-sm text-[#e6e9ef] focus:border-[#4f8cff]/70 focus:outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor={descriptionId} className="mb-1 block text-xs text-[#9aa0ad]">
            Details
          </label>
          <textarea
            id={descriptionId}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            required
            minLength={1}
            maxLength={2000}
            placeholder="What happened, and where"
            aria-describedby={error ? errorId : undefined}
            className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-3 py-2 text-sm text-[#e6e9ef] placeholder:text-[#707580] focus:border-[#4f8cff]/70 focus:outline-none"
          />
        </div>

        {error && (
          <p id={errorId} role="alert" className="text-sm text-[#f0857d]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || description.trim().length === 0}
          className="rounded-md border border-[rgba(255,255,255,0.14)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#9aa0ad] hover:border-[#4f8cff]/60 hover:text-[#8fb4ff] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Submitting…' : 'Submit report'}
        </button>
      </form>

      {success && (
        <div id={successId} role="status" className="mt-4 space-y-2">
          <p className="text-sm text-[#7fd9a4]">
            Submitted and logged. Report ID:{' '}
            <code className="rounded bg-[rgba(255,255,255,0.08)] px-1.5 py-0.5 font-mono text-[#e6e9ef]">
              {success.breakdownReportId}
            </code>
          </p>
          <pre className="whitespace-pre-wrap rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(10,11,16,0.6)] p-3 text-xs text-[#e6e9ef]">
            {success.summary}
          </pre>
        </div>
      )}
    </div>
  );
}
