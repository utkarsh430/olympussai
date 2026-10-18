'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, GitBranch } from 'lucide-react';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { useDepotSchedule } from '@/hooks/useDepotSchedule';
import { incidentBusHref } from '@/lib/depot/depotNav';
import { formatCount } from '@/lib/depot/format';
import { fitPlanSpares, propagate, type RecoveryOption } from '@/lib/depot/os/intel/disruption';
import { clockOf, feedMinuteOf } from '@/lib/depot/os/intel/readiness';
import { useIntel } from '../IntelProvider';
import { OsHeader } from '../OsHeader';
import { useOsStore, useReviewFor } from '../osStore';
import { EmptyNote, Fact, Metric, MetricStrip, Panel, PanelLoading, StatusTag } from '../ui';

const DAY_START = 4 * 60;
const DAY_END = 24 * 60;
const x = (min: number): string => `${((Math.min(DAY_END, Math.max(DAY_START, min)) - DAY_START) / (DAY_END - DAY_START)) * 100}%`;

/**
 * Disruption propagation for one depot: choose a bus and the moment it is lost, see its
 * block's remaining pieces turn into service gaps on a dependency timeline, and compare
 * the recovery options in bus-hours kept and lost.
 */
export function DisruptionView() {
  const { depotId, data: detail } = useDepotDetailContext();
  const schedule = useDepotSchedule(depotId);
  const intel = useIntel();
  const params = useSearchParams();
  const recordReview = useOsStore((s) => s.recordReview);
  const openEntity = useOsStore((s) => s.openEntity);
  const plan = schedule.data?.plan ?? null;
  const name = detail?.depot.name ?? intel.depotsById.get(depotId)?.name ?? `Depot ${depotId}`;
  const nowMin = feedMinuteOf(detail?.feedNow ?? null) ?? 9 * 60;

  const assigned = useMemo(
    () => (plan ? plan.assignment.assignments.flatMap((a) => (a.registrationNumber ? [a.registrationNumber] : [])).sort() : []),
    [plan],
  );
  const incidentBus = (intel.incidents?.rows ?? []).find((r) => r.depotId === depotId && assigned.includes(r.registrationNumber))?.registrationNumber;
  const wanted = params?.get('bus');
  const [bus, setBus] = useState<string | null>(null);
  const chosen = bus ?? (wanted && assigned.includes(wanted) ? wanted : (incidentBus ?? assigned[0] ?? null));
  const [atMin, setAtMin] = useState<number | null>(null);
  const spares = useMemo(() => (plan ? fitPlanSpares(plan, intel.healthByReg) : []), [plan, intel.healthByReg]);
  const block = plan && chosen ? (plan.assignment.assignments.find((a) => a.registrationNumber === chosen)?.blockId ?? null) : null;
  const blockObj = plan && block ? (plan.blocks.find((b) => b.id === block) ?? null) : null;
  const at = atMin ?? Math.min(Math.max(nowMin, blockObj?.startMin ?? nowMin), (blockObj?.endMin ?? nowMin) - 1);
  const result = useMemo(() => (plan && chosen ? propagate(plan, chosen, at, spares) : null), [plan, chosen, at, spares]);
  const [optionId, setOptionId] = useState<RecoveryOption['id'] | null>(null);
  const option = result ? (result.options.find((o) => o.id === (optionId ?? result.recommended)) ?? null) : null;
  const reviewId = `disruption:${depotId}:${chosen ?? ''}`;
  const review = useReviewFor(reviewId);

  useEffect(() => {
    setAtMin(null);
    setOptionId(null);
  }, [chosen]);

  return (
    <div className="space-y-4" data-testid="os-disruption">
      <OsHeader
        title="Disruption propagation"
        description={`${name}: what one unavailable bus takes with it through the rest of its scheduled block, and what each recovery saves.`}
        statuses={['derived', 'proposed']}
        actions={
          assigned.length > 0 ? (
            <label className="flex items-center gap-2 font-sans text-[12px] text-depot-prose">
              Bus
              <select value={chosen ?? ''} onChange={(e) => setBus(e.target.value)} className="depot-control depot-select font-mono" aria-label="Bus">
                {assigned.map((reg) => (
                  <option key={reg} value={reg}>
                    {reg}
                    {reg === incidentBus ? ' · suspected breakdown' : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : null
        }
      />
      {!plan ? (
        <PanelLoading rows={5} label="Loading the depot's schedule" />
      ) : !result || !blockObj ? (
        <div className="os-panel">
          <EmptyNote>No bus of this depot holds a block in today&apos;s schedule.</EmptyNote>
        </div>
      ) : (
        <>
          <MetricStrip columns={5}>
            <Metric label="Block" value={blockObj.id.split('-').slice(-1)[0] ?? blockObj.id} sub={`${clockOf(blockObj.startMin)}–${clockOf(blockObj.endMin)} · ${blockObj.pieces.length} pieces`} />
            <Metric label="Lost at" value={clockOf(at)} sub="Drag the marker below" tone="amber" />
            <Metric label="Bus-hours at risk" value={result.lostBusHours.toFixed(1)} tone={result.lostBusHours > 0 ? 'crimson' : null} sub={`${result.pieces.filter((p) => p.lostMinutes > 0).length} pieces`} />
            <Metric label="Routes affected" value={formatCount(result.routesAffected.length)} sub={result.routesAffected.slice(0, 2).join(', ') || '—'} />
            <Metric label="With recovery" value={option ? option.lostBusHours.toFixed(1) : '—'} sub="Bus-hours still lost" tone={option && option.lostBusHours === 0 ? 'green' : 'amber'} status="proposed" />
          </MetricStrip>

          <Panel kicker="Dependency timeline" title={`${chosen}: current trip, next duties and the gaps they leave`} actions={<StatusTag status="derived" />} bodyClassName="space-y-3 p-4">
            <div className="relative h-24 rounded-[4px] bg-depot-raised">
              {result.pieces.map((p) => {
                const covered = option?.covers.has(p.piece.id) ?? false;
                const cls = p.status === 'done' ? 'bg-slate-500/50' : covered ? 'bg-holo-teal/80' : 'bg-alert-crimson/75';
                return (
                  <button
                    key={p.piece.id}
                    type="button"
                    onClick={() => openEntity({ kind: 'route', id: p.piece.routeName, depotId })}
                    className={`absolute top-6 h-10 overflow-hidden rounded-[3px] border border-void/60 px-1.5 text-left ${cls}`}
                    style={{ left: x(p.piece.startMin), width: `calc(${x(p.piece.endMin)} - ${x(p.piece.startMin)})` }}
                    title={`${p.piece.routeName} ${clockOf(p.piece.startMin)}–${clockOf(p.piece.endMin)} · ${p.status === 'done' ? 'run' : covered ? 'recovered' : 'lost'}`}
                  >
                    <span className="block truncate font-mono text-[10px] text-void">{p.piece.routeName}</span>
                    <span className="block truncate font-mono text-[10px] text-void/80">{clockOf(p.piece.startMin)}</span>
                  </button>
                );
              })}
              <div className="absolute inset-y-0 w-[2px] bg-alert-amber" style={{ left: x(at) }}>
                <span className="absolute -top-0.5 left-1.5 whitespace-nowrap font-mono text-[10px] text-alert-amber">Lost {clockOf(at)}</span>
              </div>
            </div>
            <input
              type="range"
              min={blockObj.startMin}
              max={blockObj.endMin - 1}
              step={5}
              value={at}
              onChange={(e) => setAtMin(Number(e.target.value))}
              aria-label="Moment the bus is lost"
              className="w-full accent-alert-amber"
            />
            <div className="flex justify-between font-mono text-[10px] text-depot-muted">
              {[4, 8, 12, 16, 20, 24].map((h) => (
                <span key={h}>{String(h % 24).padStart(2, '0')}:00</span>
              ))}
            </div>
            <div className="flex flex-wrap gap-4 font-sans text-[11.5px] text-depot-prose">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-slate-500/50" aria-hidden />Already run</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-alert-crimson/75" aria-hidden />Service gap</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-holo-teal/80" aria-hidden />Recovered by the chosen option</span>
            </div>
          </Panel>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Panel kicker="Recovery options" title="Compare before choosing" bodyClassName="grid gap-3 p-4 lg:grid-cols-3">
              {result.options.map((o) => {
                const selected = option?.id === o.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    disabled={!o.feasible}
                    onClick={() => setOptionId(o.id)}
                    aria-pressed={selected}
                    className={`rounded-md border p-3 text-left transition-colors disabled:opacity-40 ${selected ? 'os-ai-glow border-holo-glow/60' : 'border-holo-glow/15 hover:border-holo-glow/35'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <GitBranch className="h-4 w-4 text-holo-glow" aria-hidden />
                      {o.id === result.recommended ? <span className="os-chip border-holo-teal/50 text-holo-teal">Recommended</span> : null}
                    </div>
                    <div className="mt-2 font-sans text-[13px] font-semibold text-depot-ink">{o.title}</div>
                    <p className="depot-caption mt-1">{o.detail}</p>
                    <dl className="mt-2">
                      <Fact label="Bus-hours kept" value={o.coveredBusHours.toFixed(1)} tone="teal" />
                      <Fact label="Bus-hours lost" value={o.lostBusHours.toFixed(1)} tone={o.lostBusHours > 0 ? 'crimson' : 'green'} />
                      <Fact label="Service resumes" value={o.resumeAfterMin === null ? '—' : `+${o.resumeAfterMin} min`} />
                    </dl>
                    <p className="mt-2 font-sans text-[11.5px] text-depot-prose">Trade-off: {o.tradeOff}</p>
                  </button>
                );
              })}
            </Panel>
            <Panel kicker="Decision" title="Record the recovery" bodyClassName="space-y-3 p-4" strong>
              <p className="depot-note">
                {option ? `${option.title}: keeps ${option.coveredBusHours.toFixed(1)} of ${result.lostBusHours.toFixed(1)} bus-hours.` : 'Choose an option.'} The depot controller
                confirms the bus is down and dispatches; nothing is sent by the system.
              </p>
              {review ? (
                <p className="flex items-center gap-1.5 font-sans text-[12px] text-holo-teal">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  Recorded: {review.note}
                </p>
              ) : (
                <button
                  type="button"
                  disabled={!option}
                  onClick={() =>
                    option &&
                    recordReview({
                      decisionId: reviewId,
                      title: `${chosen}: recovery if lost at ${clockOf(at)}`,
                      scope: name,
                      action: 'approved',
                      note: `${option.title} (${option.coveredBusHours.toFixed(1)} bus-hours kept)`,
                    })
                  }
                  className="os-button os-button-solid"
                >
                  Record this recovery plan
                </button>
              )}
              {chosen ? (
                <div className="flex flex-wrap gap-2 border-t border-holo-glow/10 pt-3">
                  <Link href={incidentBusHref(depotId, chosen)} className="os-button os-button-quiet">Declare in Incident Response</Link>
                  <button type="button" onClick={() => openEntity({ kind: 'vehicle', id: chosen, depotId })} className="os-button os-button-quiet">Vehicle profile</button>
                </div>
              ) : null}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
