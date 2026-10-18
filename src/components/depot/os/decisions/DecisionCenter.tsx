'use client';

import { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ClipboardCopy, Trash2 } from 'lucide-react';
import { formatCount } from '@/lib/depot/format';
import { buildBriefing } from '@/lib/depot/os/intel/briefing';
import { SEVERITY_RANK, type Severity } from '@/lib/depot/os/intel/types';
import { regionById } from '@/lib/depot/os/regions';
import { useIntel } from '../IntelProvider';
import { OsHeader } from '../OsHeader';
import { useOsStore } from '../osStore';
import { EmptyNote, Metric, MetricStrip, Panel } from '../ui';
import { DecisionPanel } from './DecisionPanel';
import { DecisionQueue } from './DecisionQueue';

const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low'];
const TONE = { critical: 'crimson', high: 'amber', medium: 'cyan', low: 'slate' } as const;

/**
 * The AI Decision Center: every decision in the context, ranked, with the selected one in
 * its seven parts, the review trail of what people recorded, and the briefing that can be
 * copied into a shift report. Selection lives in the address (`?d=`), so a decision can be
 * linked from anywhere.
 */
export function DecisionCenter() {
  const intel = useIntel();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const reviews = useOsStore((s) => s.reviews);
  const clearReview = useOsStore((s) => s.clearReview);
  const regionId = useOsStore((s) => s.regionId);
  const [copied, setCopied] = useState(false);
  const selectedId = params?.get('d') ?? null;
  const decision = intel.decisions.find((d) => d.id === selectedId) ?? intel.decisions[0] ?? null;
  const depotName = intel.scopeDepotId ? (intel.depotsById.get(intel.scopeDepotId)?.name ?? intel.scopeDepotId) : null;
  const scopeLabel = depotName ?? (regionById(regionId)?.name ? `${regionById(regionId)!.name} region` : 'UPSRTC network');

  const counts = useMemo(() => {
    const c: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const d of intel.decisions) c[d.severity] += 1;
    return c;
  }, [intel.decisions]);
  const openIds = new Set(intel.decisions.map((d) => d.id));
  const reviewed = reviews.filter((r) => openIds.has(r.decisionId)).length;

  const briefing = useMemo(() => {
    const depots = (intel.network?.depots ?? []).filter((d) => intel.scope === null || intel.scope.has(d.id));
    const health = intel.health?.filter((h) => intel.scope === null || (h.depotId !== null && intel.scope.has(h.depotId))) ?? null;
    return buildBriefing({ scopeLabel, depots, decisions: intel.decisions, health, fuel: intel.fuel });
  }, [intel, scopeLabel]);

  const select = (id: string): void => {
    const next = new URLSearchParams(params?.toString() ?? '');
    next.set('d', id);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const copyBriefing = (): void => {
    const text = [briefing.headline, '', ...briefing.situation, '', ...briefing.priorities.map((p) => p.text), '', briefing.outlook].join('\n');
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };

  const sortedReviews = [...reviews].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="space-y-4" data-testid="os-decision-center">
      <OsHeader
        title="AI Decision Center"
        description={`${scopeLabel}: every decision the AI ranked, its evidence and options, and what people recorded.`}
        statuses={['derived', 'estimate', 'proposed']}
      />
      <MetricStrip columns={6}>
        <Metric label="Open decisions" value={formatCount(intel.decisions.length)} sub={scopeLabel} />
        {SEVERITIES.map((s) => (
          <Metric key={s} label={s} value={formatCount(counts[s])} tone={counts[s] > 0 ? TONE[s] : null} sub={`${s === 'critical' ? 'Act now' : s === 'high' ? 'Before the next peak' : s === 'medium' ? 'Today' : 'Watch'}`} />
        ))}
        <Metric label="Reviewed" value={`${formatCount(reviewed)}/${formatCount(intel.decisions.length)}`} sub="Recorded in this browser" tone="teal" />
      </MetricStrip>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
        <Panel kicker="Queue" title="Ranked by severity, then weight" className="h-[760px]" bodyClassName="flex min-h-0 flex-col">
          <DecisionQueue decisions={intel.decisions} selectedId={decision?.id ?? null} onSelect={select} loading={!intel.ready} />
        </Panel>
        <Panel kicker="Selected decision" title={decision ? `Rank ${intel.decisions.indexOf(decision) + 1} of ${intel.decisions.length}` : 'Nothing selected'} strong bodyClassName="p-0" className="xl:min-h-[760px]">
          <DecisionPanel decision={decision} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel kicker="Decision history" title="Review trail" bodyClassName="p-0" testId="os-review-trail">
          {sortedReviews.length === 0 ? (
            <EmptyNote>No review recorded yet. Approve, defer or reject a decision and it is listed here with its time and note.</EmptyNote>
          ) : (
            <div className="os-scroll max-h-[360px] overflow-auto">
              <table className="os-table">
                <thead>
                  <tr>
                    <th>Recorded</th>
                    <th>Decision</th>
                    <th>Scope</th>
                    <th>Action</th>
                    <th>Note</th>
                    <th aria-label="Remove" />
                  </tr>
                </thead>
                <tbody>
                  {sortedReviews.map((r) => (
                    <tr key={r.decisionId} className="os-row" onClick={() => openIds.has(r.decisionId) && select(r.decisionId)}>
                      <td className="whitespace-nowrap font-mono text-depot-prose">
                        {new Date(r.at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td className="max-w-[22rem] truncate">{r.title}</td>
                      <td className="whitespace-nowrap text-depot-prose">{r.scope}</td>
                      <td className="whitespace-nowrap font-semibold capitalize text-holo-teal">{r.action}</td>
                      <td className="max-w-[14rem] truncate text-depot-prose">{r.note || '—'}</td>
                      <td>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            clearReview(r.decisionId);
                          }}
                          aria-label={`Remove the review of ${r.title}`}
                          className="text-depot-muted hover:text-alert-crimson"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel
          kicker="Automated operational briefing"
          title={briefing.headline}
          actions={
            <button type="button" onClick={copyBriefing} className="os-button os-button-quiet py-1 text-[11.5px]">
              <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
              {copied ? 'Copied' : 'Copy'}
            </button>
          }
          bodyClassName="space-y-2 p-4"
        >
          {briefing.situation.map((line) => (
            <p key={line} className="depot-note">
              {line}
            </p>
          ))}
          <ol className="space-y-1.5 pt-1">
            {briefing.priorities
              .slice()
              .sort((a, b) => {
                const da = intel.decisions.find((d) => d.id === a.decisionId);
                const db = intel.decisions.find((d) => d.id === b.decisionId);
                return (da ? SEVERITY_RANK[da.severity] : 9) - (db ? SEVERITY_RANK[db.severity] : 9);
              })
              .map((p) => (
                <li key={p.decisionId}>
                  <button type="button" onClick={() => select(p.decisionId)} className="text-left font-sans text-[12px] leading-4 text-depot-prose hover:text-holo-glow">
                    {p.text}
                  </button>
                </li>
              ))}
          </ol>
          <p className="font-sans text-[12px] font-medium text-holo-teal">{briefing.outlook}</p>
        </Panel>
      </div>
    </div>
  );
}
