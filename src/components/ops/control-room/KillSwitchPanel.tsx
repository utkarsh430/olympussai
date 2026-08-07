'use client';

import { useId, useState } from 'react';
import type { KillSwitchRecord } from '@/lib/auth/rbac/repo';

/**
 * Route-level and network-wide kill switches (this ticket's AC4:
 * "immediately halt new automatic commands ... both logged"). Server-
 * seeded with the currently-active list so the page never renders an
 * empty flash before the first client fetch; every engage/disengage is
 * attributed and reasoned (POST /api/ops/control-room/kill-switches,
 * .../:id/disengage), enforced at command-creation time by
 * src/app/api/ops/control-room/commands/route.ts.
 */
export function KillSwitchPanel({ initialActive }: { initialActive: KillSwitchRecord[] }) {
  const [active, setActive] = useState<KillSwitchRecord[]>(initialActive);
  const [scope, setScope] = useState<'network' | 'route'>('network');
  const [routeDirectionId, setRouteDirectionId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [disengageReason, setDisengageReason] = useState<Record<string, string>>({});
  const [disengagingId, setDisengagingId] = useState<string | null>(null);

  const errorId = useId();

  async function refresh() {
    const response = await fetch('/api/ops/control-room/kill-switches', { cache: 'no-store' });
    const data = (await response.json().catch(() => null)) as { active: KillSwitchRecord[] } | null;
    if (response.ok && data && Array.isArray(data.active)) setActive(data.active);
  }

  async function engage(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/ops/control-room/kill-switches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          scope === 'network' ? { scope: 'network', reason } : { scope: 'route', routeDirectionId, reason },
        ),
      });
      const data = (await response.json().catch(() => null)) as { ok: true } | { error: { message: string } } | null;
      if (!response.ok || !data || !('ok' in data)) {
        setError((data && 'error' in data && data.error.message) || 'Failed to engage the kill switch.');
        setSubmitting(false);
        return;
      }
      setReason('');
      setRouteDirectionId('');
      await refresh();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function disengage(id: string) {
    const reasonValue = disengageReason[id]?.trim();
    if (!reasonValue) return;
    setDisengagingId(id);
    try {
      const response = await fetch(`/api/ops/control-room/kill-switches/${id}/disengage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reasonValue }),
      });
      if (response.ok) {
        await refresh();
        setDisengageReason((prev) => ({ ...prev, [id]: '' }));
      }
    } finally {
      setDisengagingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {active.length === 0 ? (
        <p className="rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-4 py-3 text-sm text-[#9aa0ad]">
          No kill switches engaged — automatic commands are permitted.
        </p>
      ) : (
        <ul className="space-y-2">
          {active.map((ks) => (
            <li key={ks.id} className="rounded-md border border-[#f0857d]/40 bg-[#f0857d]/10 px-4 py-3 text-sm text-[#f5a89f]">
              <p>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em]">
                  {ks.scope === 'network' ? 'Network-wide' : `Route-direction ${ks.routeDirectionId}`}
                </span>{' '}
                — engaged {new Date(ks.engagedAt).toLocaleString()}
              </p>
              <p className="mt-1">Reason: {ks.reason}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={disengageReason[ks.id] ?? ''}
                  onChange={(e) => setDisengageReason((prev) => ({ ...prev, [ks.id]: e.target.value }))}
                  placeholder="Reason for disengaging"
                  className="min-w-[220px] flex-1 rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-3 py-1.5 text-xs text-[#e6e9ef] placeholder:text-[#707580] focus:border-[#4f8cff]/70 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={disengagingId === ks.id || !(disengageReason[ks.id]?.trim())}
                  onClick={() => disengage(ks.id)}
                  className="rounded-md border border-[#4fbf82]/60 bg-[#4fbf82]/12 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[#7fd9a4] hover:bg-[#4fbf82]/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {disengagingId === ks.id ? 'Disengaging…' : 'Disengage'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={engage} className="space-y-3 rounded-md border border-[rgba(255,255,255,0.08)] p-4">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#6f7684]">Engage a kill switch</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="kill-switch-scope" className="mb-1 block text-xs text-[#9aa0ad]">
              Scope
            </label>
            <select
              id="kill-switch-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as 'network' | 'route')}
              className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-3 py-2 text-sm text-[#e6e9ef] focus:border-[#4f8cff]/70 focus:outline-none"
            >
              <option value="network">Network-wide</option>
              <option value="route">Route-direction</option>
            </select>
          </div>
          {scope === 'route' && (
            <div>
              <label htmlFor="kill-switch-route" className="mb-1 block text-xs text-[#9aa0ad]">
                Route-direction id
              </label>
              <input
                id="kill-switch-route"
                required
                value={routeDirectionId}
                onChange={(e) => setRouteDirectionId(e.target.value)}
                className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-3 py-2 text-sm text-[#e6e9ef] focus:border-[#4f8cff]/70 focus:outline-none"
              />
            </div>
          )}
        </div>
        <div>
          <label htmlFor="kill-switch-reason" className="mb-1 block text-xs text-[#9aa0ad]">
            Reason
          </label>
          <textarea
            id="kill-switch-reason"
            required
            minLength={1}
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            aria-describedby={error ? errorId : undefined}
            className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-3 py-2 text-sm text-[#e6e9ef] focus:border-[#4f8cff]/70 focus:outline-none"
          />
        </div>
        {error && (
          <p id={errorId} role="alert" className="text-sm text-[#f0857d]">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting || reason.trim().length === 0 || (scope === 'route' && routeDirectionId.trim().length === 0)}
          className="rounded-md border border-[#f0857d]/60 bg-[#f0857d]/12 px-5 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#f5a89f] transition-all hover:bg-[#f0857d]/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Engaging…' : 'Engage kill switch'}
        </button>
      </form>
    </div>
  );
}
