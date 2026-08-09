'use client';

import { useEffect, useId, useState } from 'react';
import type { CanonicalSchedule, UpstreamSource } from '@/models/canonical';

interface ScheduleApiResponse {
  schedule: CanonicalSchedule | null;
  source: UpstreamSource;
  stale: boolean;
  error: string | null;
  message?: string;
}

/**
 * Real schedule/roster lookup for one vehicle (GET /api/ops/fleet/schedule),
 * shared by the depot and planner dashboards (AC2's "schedule/roster view")
 * and the driver dashboard (AC5's "own schedule", narrowed to a single
 * vehicle rather than the fleet-wide views the other roles get).
 */
export function ScheduleLookupForm({
  defaultRegNum = '',
  title = 'Look up a schedule',
  rememberKey,
}: {
  defaultRegNum?: string;
  title?: string;
  /**
   * When set, the entered registration is remembered in localStorage under
   * this key: a driver's "own vehicle" convenience for accounts with no
   * admin-set vehicle assignment yet
   * (db/migrations/20260806180000__ops_users_vehicle_assignment.sql). This is
   * a category (2) read-only convenience surface in that migration's column
   * comment — falling back to a self-reported registration is allowed here
   * precisely because a schedule lookup carries no command authority.
   * Callers that already know the caller's assigned vehicle should pass it
   * via `defaultRegNum` instead and omit this prop, so the remembered
   * value (if any, possibly stale or someone else's) never overrides the
   * authoritative one; see DriverDashboard.
   */
  rememberKey?: string;
}) {
  const [regNum, setRegNum] = useState(defaultRegNum);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'done'>('idle');
  const [result, setResult] = useState<ScheduleApiResponse | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const inputId = useId();
  const errorId = useId();

  // Restore a remembered registration (driver's own vehicle, for accounts
  // with no admin-set vehicle assignment yet) once the component mounts in
  // the browser.
  useEffect(() => {
    if (!rememberKey || defaultRegNum) return;
    try {
      const remembered = window.localStorage.getItem(rememberKey);
      if (remembered) setRegNum(remembered);
    } catch {
      // Ignore — remembering the vehicle is a convenience, never required.
    }
    // Intentionally runs once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (status === 'loading') return;
    const trimmed = regNum.trim();
    if (!trimmed) {
      setFormError('Enter a registration number.');
      return;
    }
    setFormError(null);
    setStatus('loading');
    setResult(null);

    if (rememberKey && typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(rememberKey, trimmed.toUpperCase());
      } catch {
        // localStorage can throw in private-browsing/quota-exceeded modes —
        // remembering the vehicle is a convenience, never required.
      }
    }

    try {
      const response = await fetch(`/api/ops/fleet/schedule?regNum=${encodeURIComponent(trimmed)}`);

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        setFormError(data?.error?.message ?? 'Failed to load the schedule.');
        setStatus('error');
        return;
      }

      const data = (await response.json().catch(() => null)) as ScheduleApiResponse | null;
      if (!data) {
        setFormError('Failed to load the schedule.');
        setStatus('error');
        return;
      }

      setResult(data);
      setStatus('done');
    } catch {
      setFormError('Something went wrong. Please try again.');
      setStatus('error');
    }
  }

  const loading = status === 'loading';

  return (
    <div className="rounded-md border border-[rgba(255,255,255,0.08)] p-4">
      <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">{title}</h2>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label htmlFor={inputId} className="mb-1 block text-xs text-[#9aa0ad]">
            Registration number
          </label>
          <input
            id={inputId}
            value={regNum}
            onChange={(e) => setRegNum(e.target.value)}
            placeholder="e.g. UP25FT4823"
            aria-describedby={formError ? errorId : undefined}
            className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-3 py-2 text-sm text-[#e6e9ef] placeholder:text-[#707580] focus:border-[#4f8cff]/70 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="rounded-md border border-[rgba(255,255,255,0.14)] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#9aa0ad] hover:border-[#4f8cff]/60 hover:text-[#8fb4ff] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Loading…' : 'Load schedule'}
        </button>
      </form>

      {formError && (
        <p id={errorId} role="alert" className="mt-3 text-sm text-[#f0857d]">
          {formError}
        </p>
      )}

      {result && (
        <div className="mt-4">
          {(result.source === 'fixture' || result.stale) && (
            <p role="status" className="mb-3 text-sm text-[#e8c07a]">
              {result.source === 'fixture'
                ? 'Live schedule data is unavailable — showing demo/fixture data.'
                : 'Showing the last known schedule — the live feed did not respond.'}
            </p>
          )}

          {!result.schedule ? (
            <p className="text-sm text-[#9aa0ad]">{result.message ?? 'No schedule found for this vehicle.'}</p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-[#e6e9ef]">
                <span className="text-[#9aa0ad]">Route:</span> {result.schedule.routeName ?? result.schedule.routeId ?? '—'}
                {' · '}
                <span className="text-[#9aa0ad]">Origin:</span> {result.schedule.originName ?? '—'}
                {' → '}
                <span className="text-[#9aa0ad]">Destination:</span> {result.schedule.destinationName ?? '—'}
              </p>
              <ol className="max-h-72 space-y-1 overflow-y-auto text-sm text-[#9aa0ad]">
                {result.schedule.stops.map((stop) => (
                  <li key={stop.id} className="flex justify-between gap-4 border-b border-[rgba(255,255,255,0.04)] py-1">
                    <span className="text-[#e6e9ef]">
                      {stop.sequence}. {stop.name}
                    </span>
                    <span className="font-mono">{stop.scheduledArrival ?? '—'}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
