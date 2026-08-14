'use client';

import { useCallback, useEffect, useState } from 'react';

interface BreakdownReport {
  id: string;
  driverUserId: string;
  vehicleReg: string;
  category: string;
  description: string;
  createdAt: string;
  reporterName: string;
}

type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; reports: BreakdownReport[]; nextCursor: string | null };

const ENDPOINT: Record<'fleet' | 'mine', string> = {
  fleet: '/api/ops/fleet/breakdown-reports',
  mine: '/api/ops/driver/breakdown-reports',
};

/**
 * Breakdown-report read surface. The write path (BreakdownReportPanel, POST
 * /api/ops/driver/breakdown-reports) has existed since
 * 20260806120000__ops_breakdown_reports.sql with no display anywhere — the
 * only prior consumer was Copilot LLM grounding
 * (src/lib/copilot/grounding.ts), so seeing a filed report meant asking the
 * copilot a question.
 *
 * One shared component for both new read surfaces:
 *   - scope="fleet" (control-room/dispatcher/depot dashboards): every
 *     driver's reports, from GET /api/ops/fleet/breakdown-reports.
 *   - scope="mine" (driver dashboard, under the submit form): only the
 *     signed-in driver's own reports, from GET
 *     /api/ops/driver/breakdown-reports, which scopes server-side to the
 *     caller's session and accepts no client-supplied id override.
 *
 * Fetch-state union, loader and role="alert" error handling copied verbatim
 * from ApprovalQueuePanel, so this reads as its sibling rather than a
 * bespoke panel.
 */
export function BreakdownReportsPanel({ scope }: { scope: 'fleet' | 'mine' }) {
  const [state, setState] = useState<FetchState>({ status: 'loading' });
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const response = await fetch(ENDPOINT[scope], { cache: 'no-store' });
      const data = (await response.json().catch(() => null)) as
        | { reports: BreakdownReport[]; nextCursor: string | null }
        | { error: { message: string } }
        | null;
      if (!response.ok || !data || 'error' in data) {
        setState({
          status: 'error',
          message: (data && 'error' in data && data.error.message) || 'Failed to load breakdown reports.',
        });
        return;
      }
      setState({ status: 'ready', reports: data.reports, nextCursor: data.nextCursor });
    } catch {
      setState({ status: 'error', message: 'Something went wrong. Please try again.' });
    }
  }, [scope]);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    if (state.status !== 'ready' || !state.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(`${ENDPOINT[scope]}?before=${encodeURIComponent(state.nextCursor)}`, {
        cache: 'no-store',
      });
      const data = (await response.json().catch(() => null)) as
        | { reports: BreakdownReport[]; nextCursor: string | null }
        | { error: { message: string } }
        | null;
      if (!response.ok || !data || 'error' in data) {
        setLoadingMore(false);
        return;
      }
      const previous = state;
      setState({
        status: 'ready',
        reports: [...previous.reports, ...data.reports],
        nextCursor: data.nextCursor,
      });
      setLoadingMore(false);
    } catch {
      setLoadingMore(false);
    }
  }

  if (state.status === 'loading') {
    return <p className="text-sm text-ops-muted">Loading breakdown reports…</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="text-sm text-alert-crimson">
        {state.message}
      </p>
    );
  }
  if (state.reports.length === 0) {
    return (
      <p className="ops-well px-4 py-3 text-sm text-ops-muted">
        {scope === 'mine' ? 'You have not filed any breakdown reports yet.' : 'No breakdown reports filed yet.'}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {state.reports.map((report) => (
          <li key={report.id} className="rounded-md border border-ops-line px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs uppercase tracking-[0.1em] text-holo-glow">
                {report.category}
              </span>
              <span className="text-[11px] text-ops-faint">{new Date(report.createdAt).toLocaleString()}</span>
            </div>
            <p className="mt-1 text-sm text-ops-ink">{report.description}</p>
            <p className="mt-1 font-mono text-[11px] text-ops-faint">
              vehicle {report.vehicleReg}
              {scope === 'fleet' ? ` · reported by ${report.reporterName}` : ''}
            </p>
            <p className="mt-1 font-mono text-[10px] text-ops-faint">id: {report.id}</p>
          </li>
        ))}
      </ul>

      {state.nextCursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="ops-button"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
