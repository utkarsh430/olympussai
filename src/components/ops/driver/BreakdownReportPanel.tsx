'use client';

import { useId, useState } from 'react';

const CATEGORIES = ['Mechanical', 'Electrical', 'Tyre/wheel', 'Accident', 'Other'] as const;

/**
 * Driver breakdown reporting (AC5's driver-scope example). There is no
 * audited-action endpoint for this yet — the only two audited-action
 * endpoints in scope for this ticket are POST /api/ops/dispatcher/approvals
 * and POST /api/ops/control-room/commands (see ticket's out-of-scope note:
 * "New audited-action API routes beyond the two already listed ... file as
 * a separate ticket"). Rather than silently no-op or invent a fake backend
 * call, this composes the report into a copyable summary the driver reads
 * out over the existing radio/phone channel to dispatch, and says plainly
 * that a persisted submission endpoint is tracked separately.
 */
export function BreakdownReportPanel({ defaultVehicleReg = '' }: { defaultVehicleReg?: string }) {
  const [vehicleReg, setVehicleReg] = useState(defaultVehicleReg);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('Mechanical');
  const [description, setDescription] = useState('');
  const [prepared, setPrepared] = useState<string | null>(null);

  const vehicleId = useId();
  const descriptionId = useId();

  function handlePrepare(event: React.FormEvent) {
    event.preventDefault();
    const timestamp = new Date().toLocaleString();
    setPrepared(
      `Breakdown report — ${timestamp}\nVehicle: ${vehicleReg.trim() || 'unspecified'}\nCategory: ${category}\nDetails: ${description.trim() || '(none given)'}`,
    );
  }

  return (
    <div className="rounded-md border border-[rgba(255,255,255,0.08)] p-4">
      <h2 className="mb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">
        Report a breakdown
      </h2>
      <p className="mb-3 text-xs text-[#9aa0ad]">
        There is no persisted breakdown-report endpoint yet — this composes a report for you to
        read out to dispatch over your existing radio/phone channel. A tracked, audited submission
        endpoint is filed as follow-up work.
      </p>

      <form onSubmit={handlePrepare} className="space-y-3">
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
            placeholder="What happened, and where"
            className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-3 py-2 text-sm text-[#e6e9ef] placeholder:text-[#707580] focus:border-[#4f8cff]/70 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          className="rounded-md border border-[rgba(255,255,255,0.14)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#9aa0ad] hover:border-[#4f8cff]/60 hover:text-[#8fb4ff]"
        >
          Prepare report
        </button>
      </form>

      {prepared && (
        <pre
          role="status"
          className="mt-4 whitespace-pre-wrap rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(10,11,16,0.6)] p-3 text-xs text-[#e6e9ef]"
        >
          {prepared}
        </pre>
      )}
    </div>
  );
}
