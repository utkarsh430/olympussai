'use client';

import Link from 'next/link';
import { dutyLabel } from '@/lib/depot/os/words';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Bot, CheckCircle2, Shuffle } from 'lucide-react';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { useDepotCrew } from '@/hooks/useDepotCrew';
import { useDepotDuties } from '@/hooks/useDepotDuties';
import { depotHref } from '@/lib/depot/depotNav';
import { formatCount, formatFeedTime } from '@/lib/depot/format';
import {
  buildReadiness,
  clockOf,
  feedMinuteOf,
  fitSpares,
  proposeReallocation,
  READINESS_LABEL,
  unverifiedCandidates,
  type Departure,
  type Readiness,
  type ReallocationPlan,
} from '@/lib/depot/os/intel/readiness';
import { haversineKm } from '@/lib/simulation/seededRandom';
import { useIntel } from '../IntelProvider';
import { OsHeader } from '../OsHeader';
import { useOsStore, useReviewFor } from '../osStore';
import { EmptyNote, LocalTabs, Metric, MetricStrip, Panel, PanelLoading, StatusTag } from '../ui';
import { CheckDot, ReadinessChip, READINESS_BAR } from './ReadinessChip';

type Filter = 'upcoming' | 'action' | 'all';
const ORDER: readonly Readiness[] = ['ready', 'at_risk', 'blocked', 'unverified', 'departed', 'completed'];
const TONE = { ready: 'green', at_risk: 'amber', blocked: 'crimson', unverified: 'slate', departed: 'cyan', completed: null } as const;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

function HourStrip({ departures, nowMin }: { readonly departures: readonly Departure[]; readonly nowMin: number | null }) {
  const byHour = HOURS.map((h) => {
    const counts: Record<Readiness, number> = { ready: 0, at_risk: 0, blocked: 0, unverified: 0, departed: 0, completed: 0 };
    for (const d of departures) if (Math.floor(((d.startMin % 1440) + 1440) % 1440 / 60) === h) counts[d.readiness] += 1;
    return counts;
  });
  const max = Math.max(1, ...byHour.map((c) => ORDER.reduce((s, k) => s + c[k], 0)));
  return (
    <div className="px-4 pb-3 pt-2">
      <div className="flex h-20 items-end gap-[3px]" role="img" aria-label="Departures per hour by readiness">
        {byHour.map((c, h) => {
          const total = ORDER.reduce((s, k) => s + c[k], 0);
          const current = nowMin !== null && Math.floor(nowMin / 60) === h;
          return (
            <div key={h} className={`flex flex-1 flex-col-reverse overflow-hidden rounded-[2px] ${current ? 'outline outline-1 outline-alert-amber' : ''}`} style={{ height: `${(total / max) * 100}%` }} title={`${String(h).padStart(2, '0')}:00 · ${total} departures`}>
              {ORDER.map((k) => (c[k] > 0 ? <span key={k} className={READINESS_BAR[k]} style={{ height: `${(c[k] / total) * 100}%` }} /> : null))}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-depot-muted">
        {[0, 4, 8, 12, 16, 20, 23].map((h) => (
          <span key={h}>{String(h).padStart(2, '0')}</span>
        ))}
      </div>
    </div>
  );
}

function ComparisonBar({ label, counts, total }: { readonly label: string; readonly counts: Readonly<Record<Readiness, number>>; readonly total: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between font-sans text-[12px] text-depot-prose">
        <span>{label}</span>
        <span className="font-mono text-depot-ink">
          {formatCount(counts.ready)} ready · {formatCount(counts.at_risk)} at risk · {formatCount(counts.blocked)} blocked
        </span>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-depot-raised">
        {ORDER.map((k) => (counts[k] > 0 ? <span key={k} className={READINESS_BAR[k]} style={{ width: `${(counts[k] / Math.max(1, total)) * 100}%` }} /> : null))}
      </div>
    </div>
  );
}

/**
 * The departure readiness board: every duty of the day with its bus, position, crew and
 * maintenance checks against the feed clock; the selected departure's constraints and
 * the fit spare buses; and an alternative allocation proposed for every departure a bus
 * would fix, compared before and after, recorded for a person's decision.
 */
export function ReadinessBoard() {
  const { depotId, data: detail } = useDepotDetailContext();
  const duties = useDepotDuties(depotId);
  const crew = useDepotCrew(depotId);
  const intel = useIntel();
  const openEntity = useOsStore((s) => s.openEntity);
  const setFocus = useOsStore((s) => s.setFocus);
  const askCopilot = useOsStore((s) => s.askCopilot);
  const recordReview = useOsStore((s) => s.recordReview);
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [plan, setPlan] = useState<ReallocationPlan | null>(null);
  const name = detail?.depot.name ?? intel.depotsById.get(depotId)?.name ?? `Depot ${depotId}`;
  const nowMin = feedMinuteOf(detail?.feedNow ?? null);
  const buses = useMemo(() => detail?.buses ?? [], [detail]);
  const board = useMemo(
    () => (duties.data ? buildReadiness(duties.data, crew.data ?? null, buses, intel.healthByReg, nowMin) : null),
    [duties.data, crew.data, buses, intel.healthByReg, nowMin],
  );
  const spares = useMemo(() => (duties.data ? fitSpares(duties.data, buses, intel.healthByReg) : []), [duties.data, buses, intel.healthByReg]);
  const candidates = useMemo(
    () => (duties.data ? unverifiedCandidates(duties.data, buses, intel.healthByReg) : []),
    [duties.data, buses, intel.healthByReg],
  );
  const nearestSurplus = useMemo(() => {
    const balances = intel.distribution?.balances ?? [];
    const own = balances.find((b) => b.depotId === depotId)?.position ?? detail?.depot.centroid ?? null;
    if (!own) return [];
    return balances
      .filter((b) => b.kind === 'depot' && b.depotId !== depotId && b.balance > 0 && b.position)
      .map((b) => ({ id: b.depotId, name: b.depotName, surplus: b.balance, km: Math.round(haversineKm(own.lat, own.lng, b.position!.lat, b.position!.lng) * 1.25) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 3);
  }, [intel.distribution, depotId, detail]);
  const planId = `readiness:${depotId}:${duties.data?.operatingDate ?? ''}`;
  const planReview = useReviewFor(planId);

  const shown = useMemo(() => {
    const list = board?.departures ?? [];
    if (filter === 'action') return list.filter((d) => d.readiness === 'blocked' || d.readiness === 'at_risk');
    if (filter === 'upcoming') return list.filter((d) => d.readiness !== 'completed' && d.readiness !== 'departed');
    return list;
  }, [board, filter]);
  const selected = board?.departures.find((d) => d.dutyId === selectedId) ?? shown.find((d) => d.readiness === 'blocked' || d.readiness === 'at_risk') ?? shown[0] ?? null;

  useEffect(() => {
    if (selected?.registration) setFocus({ kind: 'vehicle', id: selected.registration, label: `${selected.registration} on ${dutyLabel(selected.dutyId)}` });
  }, [selected?.registration, selected?.dutyId, setFocus]);

  const root = depotHref(depotId);
  const total = board?.departures.length ?? 0;

  return (
    <div className="space-y-4" data-testid="os-readiness">
      <OsHeader
        title="Dispatch readiness"
        description={`${name}: each departure checked for its bus, position, crew and maintenance against the feed clock.`}
        statuses={['live', 'derived', 'scenario']}
        actions={
          <>
            <span className="font-mono text-[11px] text-depot-muted">Feed clock {formatFeedTime(detail?.feedNow ?? null)}</span>
            <button type="button" onClick={() => askCopilot(`Which buses can cover the next departures at ${name}?`)} className="os-button os-button-quiet">
              <Bot className="h-3.5 w-3.5" aria-hidden />
              Ask the copilot
            </button>
          </>
        }
      />

      {!board ? (
        <PanelLoading rows={6} label="Loading the duty plan and the crew roster" />
      ) : (
        <>
          <MetricStrip columns={6}>
            {ORDER.map((k) => (
              <Metric
                key={k}
                label={READINESS_LABEL[k]}
                value={formatCount(board.counts[k])}
                sub={`${total > 0 ? Math.round((board.counts[k] / total) * 100) : 0}% of ${formatCount(total)} duties`}
                tone={TONE[k]}
                onClick={() => setFilter(k === 'blocked' || k === 'at_risk' ? 'action' : k === 'departed' || k === 'completed' ? 'all' : 'upcoming')}
              />
            ))}
          </MetricStrip>

          <Panel kicker="Departure schedule" title="Departures per hour, by readiness" bodyClassName="p-0" actions={<StatusTag status="derived" />}>
            <HourStrip departures={board.departures} nowMin={nowMin} />
          </Panel>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <Panel kicker="Board" title={`${formatCount(shown.length)} departures`} bodyClassName="flex min-h-0 flex-col p-0" className="h-[640px]">
              <LocalTabs<Filter>
                label="Departures shown"
                value={filter}
                onChange={setFilter}
                items={[
                  { key: 'upcoming', label: 'Upcoming', count: board.departures.filter((d) => d.readiness !== 'completed' && d.readiness !== 'departed').length },
                  { key: 'action', label: 'Needs action', count: board.counts.blocked + board.counts.at_risk },
                  { key: 'all', label: 'All', count: total },
                ]}
              />
              {shown.length === 0 ? (
                <EmptyNote>Nothing to show under this filter.</EmptyNote>
              ) : (
                <div className="os-scroll min-h-0 flex-1 overflow-auto">
                  <table className="os-table">
                    <thead>
                      <tr>
                        <th>Due</th>
                        <th>Duty</th>
                        <th>Route</th>
                        <th>Bus</th>
                        <th>Checks</th>
                        <th>Readiness</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((d) => (
                        <tr key={d.dutyId} onClick={() => setSelectedId(d.dutyId)} className={`os-row ${selected?.dutyId === d.dutyId ? 'os-row-selected' : ''}`}>
                          <td className="font-mono">{clockOf(d.startMin)}</td>
                          <td className="font-mono text-depot-prose">{dutyLabel(d.dutyId).replace('Duty ', '')}</td>
                          <td className="max-w-[12rem] truncate font-mono">{d.routeName}</td>
                          <td className="font-mono">{d.registration ?? <span className="text-alert-crimson">No bus</span>}</td>
                          <td>
                            <span className="flex items-center gap-1">
                              {d.checks.map((c) => (
                                <CheckDot key={c.key} state={c.state} title={`${c.label}: ${c.detail}`} />
                              ))}
                            </span>
                          </td>
                          <td>
                            <ReadinessChip readiness={d.readiness} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <div className="flex min-w-0 flex-col gap-4">
              <Panel kicker="Selected departure" title={selected ? `${clockOf(selected.startMin)} · ${selected.routeName}` : 'None'} bodyClassName="space-y-3 p-4">
                {selected ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[12px] text-depot-prose">{dutyLabel(selected.dutyId)}</span>
                      <ReadinessChip readiness={selected.readiness} />
                    </div>
                    <ul className="space-y-1.5">
                      {selected.checks.map((c) => (
                        <li key={c.key} className="flex items-start gap-2.5 rounded-[4px] border border-holo-glow/10 px-2.5 py-1.5">
                          <span className="mt-1">
                            <CheckDot state={c.state} title={c.label} />
                          </span>
                          <span className="min-w-0">
                            <span className="block font-sans text-[12px] font-semibold text-depot-ink">{c.label}</span>
                            <span className="block font-sans text-[12px] text-depot-prose">{c.detail}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    {selected.registration ? (
                      <button type="button" onClick={() => openEntity({ kind: 'vehicle', id: selected.registration!, depotId })} className="os-button os-button-quiet">
                        Vehicle profile
                      </button>
                    ) : null}
                    {selected.readiness === 'blocked' || selected.readiness === 'at_risk' ? (
                      <div>
                        <div className="os-kicker mb-1">Fit spare buses</div>
                        {spares.length === 0 ? (
                          <p className="depot-note">No spare bus standing is fit: none is free of overdue service and high risk.</p>
                        ) : (
                          <ul className="space-y-1">
                            {spares.slice(0, 4).map((s) => (
                              <li key={s.registration} className="flex items-center justify-between gap-2 font-sans text-[12px]">
                                <button type="button" onClick={() => openEntity({ kind: 'vehicle', id: s.registration, depotId })} className="font-mono text-holo-glow hover:underline">
                                  {s.registration}
                                </button>
                                <span className="truncate text-depot-prose">{s.reason}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <EmptyNote>Select a departure.</EmptyNote>
                )}
              </Panel>

              <Panel
                kicker="AI alternative allocation"
                title="Fix the departures a bus can fix"
                strong
                bodyClassName="space-y-3 p-4"
                actions={<StatusTag status="proposed" />}
              >
                {!plan ? (
                  <>
                    <p className="depot-note">
                      Upcoming departures whose bus, position or maintenance check fails or warns get, in start order, the {formatCount(spares.length)} fit spare
                      buses first, then the {formatCount(candidates.length)} buses that went dark inside the yard, each to be confirmed before dispatch. Crew gaps
                      are not fixed by a bus and stay visible.
                    </p>
                    <button type="button" onClick={() => setPlan(proposeReallocation(board, spares, candidates))} className="os-button os-button-solid" data-testid="os-readiness-propose">
                      <Shuffle className="h-3.5 w-3.5" aria-hidden />
                      Request alternative allocation
                    </button>
                  </>
                ) : (
                  <>
                    <ComparisonBar label="Now" counts={plan.before} total={total} />
                    <ComparisonBar label="With the proposal" counts={plan.after} total={total} />
                    {plan.swaps.length === 0 ? (
                      <p className="depot-note">No departure can be improved with a fit spare bus.</p>
                    ) : (
                      <ul className="os-scroll max-h-44 space-y-1 overflow-y-auto">
                        {plan.swaps.map((s) => (
                          <li key={s.dutyId} className="flex items-center gap-2 font-sans text-[12px] text-depot-prose">
                            <span className="font-mono text-depot-ink">{s.dutyId.split('-').slice(-1)[0]}</span>
                            <span className="font-mono">{s.from ?? 'no bus'}</span>
                            <ArrowRight className="h-3 w-3 text-holo-teal" aria-hidden />
                            <span className="font-mono text-holo-teal">{s.to}</span>
                            {s.conditional ? <span className="os-chip border-slate-400/40 text-slate-300">Confirm</span> : null}
                            <span className="truncate">· {s.why}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {plan.after.blocked + plan.after.at_risk > 0 && nearestSurplus.length > 0 ? (
                      <div className="rounded-[4px] border border-holo-glow/10 p-2.5">
                        <div className="os-kicker mb-1">Still short after the proposal: nearest surplus</div>
                        <ul className="space-y-0.5">
                          {nearestSurplus.map((d) => (
                            <li key={d.id} className="flex justify-between gap-2 font-sans text-[12px] text-depot-prose">
                              <span className="truncate text-depot-ink">{d.name}</span>
                              <span className="font-mono">+{formatCount(d.surplus)} · ~{formatCount(d.km)} km</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {planReview ? (
                      <p className="flex items-center gap-1.5 font-sans text-[12px] text-holo-teal">
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                        Proposed action recorded {new Date(planReview.at).toLocaleTimeString('en-IN', { timeStyle: 'short' })}; the depot controller makes each swap.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={plan.swaps.length === 0}
                          onClick={() =>
                            recordReview({
                              decisionId: planId,
                              title: `${name}: ${plan.swaps.length} bus swaps for departure readiness`,
                              scope: name,
                              action: 'approved',
                              note: `${plan.before.blocked + plan.before.at_risk} → ${plan.after.blocked + plan.after.at_risk} departures needing action`,
                            })
                          }
                          className="os-button os-button-solid"
                        >
                          Record the proposed action
                        </button>
                        <button type="button" onClick={() => setPlan(null)} className="os-button os-button-quiet">
                          Discard
                        </button>
                      </div>
                    )}
                  </>
                )}
                <div className="flex flex-wrap gap-2 border-t border-holo-glow/10 pt-3">
                  <Link href={`${root}/duties`} className="depot-link font-sans text-[12px]">Duty plan</Link>
                  <Link href={`${root}/crew`} className="depot-link font-sans text-[12px]">Crew roster</Link>
                  <Link href={`${root}/yard`} className="depot-link font-sans text-[12px]">Yard</Link>
                </div>
              </Panel>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
