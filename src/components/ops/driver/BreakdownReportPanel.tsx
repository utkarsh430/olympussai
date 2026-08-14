'use client';

import { useId, useState } from 'react';
import { OpsAlert, OpsField, OpsInput, OpsPanel, OpsSelect, OpsTextarea } from '@/components/ops/ui';

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
    <OpsPanel
      title="Report a breakdown"
      headingLevel={2}
      description="Sent straight to dispatch and recorded. You can also read the summary out over the radio if that is faster."
      bodyClassName="space-y-4"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Stacked on a phone, two-up from `sm`. The vehicle and category are
            short fields, but side by side at 360px they are too narrow to read
            the selected value in. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <OpsField label="Vehicle" htmlFor={vehicleId}>
            <OpsInput
              id={vehicleId}
              value={vehicleReg}
              onChange={(e) => setVehicleReg(e.target.value)}
              placeholder="e.g. UP25FT4823"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="min-h-12 text-base"
            />
          </OpsField>
          <OpsField label="What kind of problem" htmlFor="breakdown-category">
            <OpsSelect
              id="breakdown-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}
              className="min-h-12 text-base"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </OpsSelect>
          </OpsField>
        </div>

        <OpsField
          label="What happened, and where"
          htmlFor={descriptionId}
          required
          error={error ?? undefined}
        >
          <OpsTextarea
            id={descriptionId}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            required
            minLength={1}
            maxLength={2000}
            placeholder="e.g. Rear left tyre burst, stopped on the shoulder near Faridpur"
            aria-describedby={error ? errorId : undefined}
            className="min-h-32 text-base"
          />
        </OpsField>

        {error && (
          <p id={errorId} role="alert" className="text-base text-ops-danger">
            {error}
          </p>
        )}

        {/* Full width and 56px tall: this is pressed at the roadside, often in
            a hurry, sometimes one-handed. */}
        <button
          type="submit"
          disabled={submitting || description.trim().length === 0}
          className="ops-button-primary min-h-14 w-full text-sm"
        >
          {submitting ? 'Sending…' : 'Send report to dispatch'}
        </button>
      </form>

      {/* ONE live region, not two. `OpsAlert tone="success"` already announces
          as role="status"; wrapping it in another status container made the
          confirmation announce twice to a screen reader and left two elements
          answering to the same role. Everything the driver needs after filing
          - the reference to read out, and the summary to read out - lives
          inside that single region. */}
      {success && (
        <OpsAlert tone="success" title="Sent and recorded" id={successId}>
          <p className="text-base leading-relaxed">
            Report reference{' '}
            <code className="rounded bg-ops-line px-1.5 py-0.5 font-mono text-sm text-ops-ink">
              {success.breakdownReportId}
            </code>
          </p>
          <pre className="ops-well mt-2 whitespace-pre-wrap p-3 text-sm leading-relaxed text-ops-ink">
            {success.summary}
          </pre>
        </OpsAlert>
      )}
    </OpsPanel>
  );
}
