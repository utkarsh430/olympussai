'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Download, GitCompare, Printer, RefreshCw, Save, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { signFor } from '@/lib/depot/format';
import { DEFAULT_BUS_PARAMS, OBJECTIVE_LABEL, OBJECTIVE_NOTE, PARAM_BOUNDS, PRIORITY_LABEL } from '@/lib/depot/os/sched/config';
import { tripsFor } from '@/lib/depot/os/sched/trips';
import type { BusParams, BusPlan, Objective, SchedBus, Trip } from '@/lib/depot/os/sched/types';
import { baselineBuses, optimiseBuses, restrictBuses, RESTRICTION_LABEL, type OptimiseTrace } from '@/lib/depot/os/sched/vehicles';
import { AiKindChip } from '../aiKinds';
import { useStepRunner, WorkingSteps, type StepDef } from '../ai/WorkingSteps';
import { OsHeader } from '../OsHeader';
import { useOsStore, useReviewFor } from '../osStore';
import { Gantt, GanttLegend } from '../gantt/Gantt';
import { EmptyNote, Fact, LocalTabs, Metric, MetricStrip, Panel, PanelLoading, StatusTag } from '../ui';
import { BusPicker, CompareTable, FieldGroup, RangeField, RouteChecklist, SelectField, ToggleField, type CompareRow } from './Controls';
import { clock, count, downloadCsv, hours, km, pct, rupees, rupeesShort } from './fmt';
import { busRows, CLASS_WORD } from './ganttRows';
import { DepotDateFields, SavedScenarios, useDateParam } from './SchedChrome';
import { useSchedStore } from './schedStore';
import { useSchedInput } from './useSchedInput';

type View = 'original' | 'optimised' | 'compare';

interface Result {
  readonly params: BusParams;
  readonly buses: readonly SchedBus[];
  readonly trips: readonly Trip[];
  readonly baseline: BusPlan;
  readonly optimised: BusPlan;
  readonly trace: OptimiseTrace | null;
  readonly tradeoffs: readonly { readonly objective: Objective; readonly plan: BusPlan }[];
}

interface Ctx {
  params: BusParams;
  trips: Trip[];
  buses: SchedBus[];
  baseline: BusPlan | null;
  optimised: BusPlan | null;
  trace: OptimiseTrace | null;
  tradeoffs: { objective: Objective; plan: BusPlan }[];
}

const OBJECTIVES = Object.keys(OBJECTIVE_LABEL) as Objective[];

function compareRows(before: BusPlan, after: BusPlan): CompareRow[] {
  const b = before.metrics;
  const a = after.metrics;
  return [
    { label: 'Departures covered', before: b.covered, after: a.covered, format: count, better: 'higher' },
    { label: 'Uncovered departures', before: b.uncovered, after: a.uncovered, format: count, better: 'lower' },
    { label: 'Passengers carried', before: b.passengersCovered, after: a.passengersCovered, format: count, better: 'higher' },
    { label: 'Buses utilised', before: b.busesUsed, after: a.busesUsed, format: count, better: 'neutral' },
    { label: 'Bus-hours utilised', before: b.busHours, after: a.busHours, format: hours, better: 'neutral' },
    { label: 'Idle vehicle hours', before: b.idleHours, after: a.idleHours, format: hours, better: 'lower' },
    { label: 'Empty kilometres', before: b.emptyKm, after: a.emptyKm, format: km, better: 'lower' },
    { label: 'Estimated operating cost', before: b.cost.total, after: a.cost.total, format: rupees, better: 'neutral' },
    { label: 'Cost per departure run', before: b.covered > 0 ? b.cost.total / b.covered : null, after: a.covered > 0 ? a.cost.total / a.covered : null, format: rupees, better: 'lower' },
    { label: 'Fleet utilisation', before: b.utilisation, after: a.utilisation, format: pct, better: 'higher' },
    { label: 'Conflicts', before: b.conflicts, after: a.conflicts, format: count, better: 'lower' },
  ];
}

/**
 * The AI Bus Scheduler: generates the depot's bus schedule for a day under constraints
 * and an objective, shows it as a timeline against the original plan, and explains the
 * trade-offs. The roster and each bus's status are live; the timetable and forecast are
 * scenario records. A generated plan is a proposal: it is recorded, never dispatched.
 */
export function BusScheduler() {
  const { depotId } = useDepotDetailContext();
  const openEntity = useOsStore((s) => s.openEntity);
  const setFocus = useOsStore((s) => s.setFocus);
  const recordReview = useOsStore((s) => s.recordReview);
  const save = useSchedStore((s) => s.save);
  const setLatest = useSchedStore((s) => s.setLatest);
  const [date, setDate] = useState<string | null>(null);
  const input = useSchedInput(depotId, date);
  useDateParam(input.dates, setDate);
  const [params, setParams] = useState<BusParams>(DEFAULT_BUS_PARAMS);
  const [result, setResult] = useState<Result | null>(null);
  const [view, setView] = useState<View>('original');
  const [selected, setSelected] = useState<{ bar: string; row: string } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const paramsRef = useRef<HTMLDivElement>(null);
  const runner = useStepRunner<Ctx>();
  const set = <K extends keyof BusParams>(key: K, value: BusParams[K]): void => setParams((p) => ({ ...p, [key]: value }));
  const name = input.depot?.name ?? `Depot ${depotId}`;
  const day = input.timetable?.operatingDate ?? null;

  // The original plan is drawn before anything is generated.
  const original = useMemo(() => {
    if (!input.timetable) return null;
    const trips = tripsFor(input.timetable, params);
    return baselineBuses(input.timetable, trips, restrictBuses(input.buses, params), params);
  }, [input.timetable, input.buses, params]);

  const generate = useCallback(async () => {
    const timetable = input.timetable;
    if (!timetable) return;
    const steps: StepDef<Ctx>[] = [
      {
        label: 'Read the selected scenario',
        run: (c) => {
          c.trips = tripsFor(timetable, c.params);
          const routes = new Set(c.trips.map((t) => t.routeId)).size;
          return `${count(input.buses.length)} buses on the roster; ${count(routes)} routes need ${count(c.trips.length)} departures.`;
        },
      },
      {
        label: 'Identify eligible buses',
        run: (c) => {
          c.buses = restrictBuses(input.buses, c.params);
          const held = new Map<string, number>();
          for (const b of c.buses) if (b.restriction) held.set(b.restriction, (held.get(b.restriction) ?? 0) + 1);
          const eligible = c.buses.filter((b) => b.restriction === null).length;
          return `${count(eligible)} eligible; held out: ${[...held].map(([k, n]) => `${n} ${RESTRICTION_LABEL[k as keyof typeof RESTRICTION_LABEL].toLowerCase()}`).join(', ') || 'none'}.`;
        },
      },
      {
        label: 'Evaluate route demand against the original plan',
        run: (c) => {
          c.baseline = baselineBuses(timetable, c.trips, c.buses, c.params);
          const m = c.baseline.metrics;
          return `Original plan covers ${count(m.covered)} of ${count(m.departures)}; ${count(c.baseline.conflicts.length)} conflicts; at least ${count(c.baseline.lowerBound)} buses are needed at the busiest moment.`;
        },
      },
      {
        label: 'Generate the optimised assignment',
        run: (c) => {
          c.optimised = optimiseBuses(timetable, c.trips, c.buses, c.params, (t) => {
            c.trace = t;
          });
          const m = c.optimised.metrics;
          return `${OBJECTIVE_LABEL[c.params.objective]}: ${count(m.busesUsed)} buses cover ${count(m.covered)} departures; no bus overlaps, every turnaround and day limit held.`;
        },
      },
      {
        label: 'Recompute utilisation, coverage and trade-offs',
        run: (c) => {
          c.tradeoffs = OBJECTIVES.map((objective) => ({ objective, plan: objective === c.params.objective && c.optimised ? c.optimised : optimiseBuses(timetable, c.trips, c.buses, { ...c.params, objective }) }));
          return `${OBJECTIVES.length} objectives compared on the same departures and buses.`;
        },
      },
      {
        label: 'Compare against the baseline',
        run: (c) => {
          const b = c.baseline!.metrics;
          const a = c.optimised!.metrics;
          return `${signFor(a.covered - b.covered)}${count(Math.abs(a.covered - b.covered))} departures covered, ${count(Math.abs(a.idleHours - b.idleHours))} idle hours ${a.idleHours <= b.idleHours ? 'fewer' : 'more'}, ${count(c.baseline!.conflicts.length)} conflicts resolved.`;
        },
      },
    ];
    const ctx = await runner.run(steps, { params, trips: [], buses: [], baseline: null, optimised: null, trace: null, tradeoffs: [] });
    if (!ctx || !ctx.baseline || !ctx.optimised) return;
    setResult({ params: ctx.params, buses: ctx.buses, trips: ctx.trips, baseline: ctx.baseline, optimised: ctx.optimised, trace: ctx.trace, tradeoffs: ctx.tradeoffs });
    setView('optimised');
    setSelected(null);
    const m = ctx.optimised.metrics;
    const b = ctx.baseline.metrics;
    setLatest({
      kind: 'bus',
      depotId,
      date: timetable.operatingDate,
      label: OBJECTIVE_LABEL[ctx.params.objective],
      figures: { buses: m.busesUsed, covered: m.covered, departures: m.departures, uncovered: m.uncovered, baselineCovered: b.covered, baselineBuses: b.busesUsed, idleHours: Math.round(m.idleHours), baselineIdle: Math.round(b.idleHours) },
      summary: `${OBJECTIVE_LABEL[ctx.params.objective]} for ${name}: ${m.busesUsed} buses cover ${m.covered} of ${m.departures} departures against ${b.covered} in the original plan.`,
    });
  }, [input.timetable, input.buses, params, runner, depotId, name, setLatest]);

  // `?run=1` (from the copilot) generates once the day is ready.
  const search = useSearchParams();
  const autorun = search?.get('run') === '1';
  const ran = useRef(false);
  useEffect(() => {
    if (autorun && !ran.current && input.timetable) {
      ran.current = true;
      void generate();
    }
  }, [autorun, input.timetable, generate]);

  const stale = result !== null && JSON.stringify(result.params) !== JSON.stringify(params);
  const shown = view === 'original' || !result ? (result?.baseline ?? original) : result.optimised;
  const rows = useMemo(() => (shown ? busRows(shown) : []), [shown]);
  const to = useMemo(() => Math.max(1440, Math.ceil(Math.max(0, ...(shown?.trips ?? []).map((t) => t.arr)) / 60) * 60), [shown]);
  const block = shown && selected ? shown.blocks.find((b) => b.registration === selected.row) : undefined;
  const uncoveredPick = shown && selected && !block ? shown.uncovered.find((u) => u.trip.id === selected.bar) : undefined;
  const planId = result ? `bus-plan:${depotId}:${result.trips[0]?.id ?? ''}:${result.params.objective}:${result.optimised.metrics.busesUsed}:${result.optimised.metrics.covered}` : 'none';
  const review = useReviewFor(planId);

  useEffect(() => {
    if (block) setFocus({ kind: 'vehicle', id: block.registration, label: `${block.registration} in the ${view === 'original' ? 'original' : 'optimised'} bus schedule` });
    else if (result) setFocus({ kind: 'scenario', id: planId, label: `${name}: ${OBJECTIVE_LABEL[result.params.objective]} bus schedule` });
  }, [block, result, planId, name, view, setFocus]);

  const note = (text: string): void => {
    setFlash(text);
    window.setTimeout(() => setFlash(null), 3200);
  };

  const exportPlan = (): void => {
    if (!shown || !day) return;
    const rowsOut = [
      ...shown.blocks.flatMap((b) => b.trips.map((t) => [b.registration, CLASS_WORD[b.serviceClass], t.routeId, clock(t.dep), clock(t.arr), t.passengers, b.unavailable ? RESTRICTION_LABEL[b.unavailable] : 'Planned'])),
      ...shown.uncovered.map((u) => ['', '', u.trip.routeId, clock(u.trip.dep), clock(u.trip.arr), u.trip.passengers, `Uncovered (${u.reason.replace('_', ' ')})`]),
    ];
    downloadCsv(`${name.replace(/\W+/g, '-').toLowerCase()}-bus-schedule-${day}-${view}.csv`, ['Bus', 'Class', 'Route', 'Departs', 'Returns', 'Passengers', 'Status'], rowsOut);
  };

  if (!input.timetable || !original) {
    return (
      <div className="space-y-4">
        <OsHeader title="AI Bus Scheduler" description="Intelligent fleet scheduling and resource allocation" statuses={['live', 'scenario', 'proposed']} />
        <PanelLoading rows={8} label="Reading the depot's roster and timetable" />
      </div>
    );
  }

  const tt = input.timetable;
  const m = shown?.metrics;
  const base = result?.baseline.metrics ?? original.metrics;
  const delta = (a: number, b: number, unit = ''): string => (view !== 'optimised' || !result ? '' : a === b ? 'same as original' : `${signFor(a - b)}${count(Math.abs(a - b))}${unit} vs original`);

  return (
    <div className="space-y-4" data-testid="os-bus-scheduler">
      <OsHeader
        title="AI Bus Scheduler"
        description="Intelligent fleet scheduling and resource allocation"
        statuses={['live', 'scenario', 'proposed']}
        actions={
          <button type="button" onClick={() => void generate()} disabled={runner.running} className="os-cta" data-testid="os-generate-bus">
            <Sparkles className={`h-4 w-4 ${runner.running ? 'animate-pulse' : ''}`} aria-hidden />
            {runner.running ? 'Generating…' : result ? 'Regenerate optimal schedule' : 'Generate optimal bus schedule'}
          </button>
        }
      />

      {m ? (
        <MetricStrip columns={8}>
          <Metric label="Buses utilised" value={count(m.busesUsed)} sub={delta(m.busesUsed, base.busesUsed) || `of ${count(m.eligibleBuses)} eligible`} />
          <Metric label="Departures covered" value={`${count(m.covered)}/${count(m.departures)}`} sub={delta(m.covered, base.covered) || 'Required by the forecast'} tone="teal" />
          <Metric label="Uncovered" value={count(m.uncovered)} sub={delta(m.uncovered, base.uncovered)} tone={m.uncovered > 0 ? 'crimson' : 'green'} />
          <Metric label="Bus-hours" value={hours(m.busHours)} sub={`${hours(m.serviceHours)} in service`} />
          <Metric label="Idle vehicle hours" value={hours(m.idleHours)} sub={delta(Math.round(m.idleHours), Math.round(base.idleHours), ' h')} tone="amber" />
          <Metric label="Empty km" value={km(m.emptyKm)} sub="Yard and terminal moves" />
          <Metric label="Est. operating cost" value={rupeesShort(m.cost.total)} sub="Fuel, crew, bus-day" status="estimate" />
          <Metric label="Fleet utilisation" value={pct(m.utilisation)} sub="Service over bus-hours" tone="cyan" />
        </MetricStrip>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)] min-[1760px]:grid-cols-[300px_minmax(0,1fr)_360px]">
        <div ref={paramsRef} className="flex min-w-0 flex-col gap-4 rounded-md transition-shadow">
          <Panel kicker="Scheduling parameters" title={name} actions={<StatusTag status="scenario" />} bodyClassName="p-0">
            <div className="border-b border-holo-glow/[0.08] px-4 py-3">
              <DepotDateFields depotId={depotId} dates={input.dates} date={tt.operatingDate} onDate={setDate} />
            </div>
            <FieldGroup title="Objective">
              <SelectField<Objective> label="Optimisation objective" value={params.objective} onChange={(v) => set('objective', v)} options={OBJECTIVES.map((o) => ({ key: o, label: OBJECTIVE_LABEL[o] }))} hint={OBJECTIVE_NOTE[params.objective]} />
              <SelectField label="Operational priority" value={params.priority} onChange={(v) => set('priority', v)} options={(Object.keys(PRIORITY_LABEL) as (keyof typeof PRIORITY_LABEL)[]).map((k) => ({ key: k, label: PRIORITY_LABEL[k] }))} hint="Which departures count most when the fleet is short." />
            </FieldGroup>
            <FieldGroup title="Service">
              <RouteChecklist routes={tt.routes.map((r) => ({ id: r.id, label: `${r.destination} · ${CLASS_WORD[r.serviceClass]}` }))} value={params.routes} onChange={(v) => set('routes', v)} />
              <RangeField label="Passenger demand forecast" value={params.demandPct} {...PARAM_BOUNDS.demandPct} format={(v) => (v === 0 ? 'As forecast' : `${signFor(v)}${Math.abs(v)}%`)} onChange={(v) => set('demandPct', v)} />
              <RangeField label="Target load factor" value={params.targetLoad} {...PARAM_BOUNDS.targetLoad} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set('targetLoad', v)} />
              <RangeField label="Service frequency floor" value={params.minPerHour} {...PARAM_BOUNDS.minPerHour} format={(v) => `${v} per slot`} onChange={(v) => set('minPerHour', v)} hint="Fewest departures a route keeps in each slot, however light." />
            </FieldGroup>
            <FieldGroup title="Fleet and constraints">
              <RangeField label="Minimum turnaround" value={params.turnaroundMin} {...PARAM_BOUNDS.turnaroundMin} format={(v) => `${v} min`} onChange={(v) => set('turnaroundMin', v)} />
              <RangeField label="Longest bus day" value={params.maxBlockHours} {...PARAM_BOUNDS.maxBlockHours} format={(v) => `${v} h`} onChange={(v) => set('maxBlockHours', v)} />
              <RangeField label="Reserve fleet" value={params.reservePct} {...PARAM_BOUNDS.reservePct} format={(v) => `${v}%`} onChange={(v) => set('reservePct', v)} hint="Lowest-risk eligible buses held back as spares." />
              <ToggleField label="Hold buses past service due" checked={params.holdOverdue} onChange={(v) => set('holdOverdue', v)} />
              <ToggleField label="Hold high breakdown-risk buses" checked={params.holdHighRisk} onChange={(v) => set('holdHighRisk', v)} />
              <BusPicker label="Vehicles unavailable" options={input.buses.map((b) => b.registration)} value={params.unavailable} onChange={(v) => set('unavailable', v)} hint={`Available on the roster: ${count(input.buses.filter((b) => b.state !== 'off_road').length)} of ${count(input.buses.length)} (off road excluded).`} />
            </FieldGroup>
            <div className="flex gap-2 px-4 py-3">
              <button type="button" onClick={() => setParams(DEFAULT_BUS_PARAMS)} className="os-button os-button-quiet flex-1">
                Reset
              </button>
              <button type="button" onClick={() => void generate()} disabled={runner.running} className="os-button os-button-solid flex-1">
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Regenerate
              </button>
            </div>
          </Panel>
          <SavedScenarios
            kind="bus"
            depotId={depotId}
            onLoad={(s) => {
              setParams(s.busParams);
              setDate(s.date);
              note(`Loaded "${s.label}". Generate to recompute it on today's roster.`);
            }}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel
            kicker="Interactive schedule timeline"
            title={view === 'original' || !result ? 'Original plan: buses fixed to routes' : `Optimised: ${OBJECTIVE_LABEL[result.params.objective]}`}
            strong
            bodyClassName="p-0"
            actions={<StatusTag status={view === 'original' || !result ? 'scenario' : 'proposed'} />}
          >
            <div className="flex flex-wrap items-center gap-2 border-b border-holo-glow/10 px-3 py-2">
              <LocalTabs<View>
                label="Plan shown"
                value={view}
                onChange={(v) => {
                  setView(v);
                  setSelected(null);
                }}
                items={[
                  { key: 'original', label: 'View original schedule' },
                  ...(result ? [{ key: 'optimised' as const, label: 'View optimised schedule' }, { key: 'compare' as const, label: 'Compare plans' }] : []),
                ]}
              />
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    paramsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    paramsRef.current?.classList.add('os-attention');
                    window.setTimeout(() => paramsRef.current?.classList.remove('os-attention'), 1400);
                  }}
                  className="os-button os-button-quiet"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
                  Modify constraints
                </button>
                <button
                  type="button"
                  disabled={!result}
                  onClick={() => {
                    if (!result || !day) return;
                    save({ kind: 'bus', depotId, depotName: name, date: day, label: `${OBJECTIVE_LABEL[result.params.objective]} · ${count(result.optimised.metrics.busesUsed)} buses`, busParams: result.params, crewParams: null, figures: { buses: result.optimised.metrics.busesUsed, covered: result.optimised.metrics.covered, uncovered: result.optimised.metrics.uncovered } });
                    note('Scenario saved in this browser.');
                  }}
                  className="os-button os-button-quiet"
                >
                  <Save className="h-3.5 w-3.5" aria-hidden />
                  Save scenario
                </button>
                <button type="button" onClick={exportPlan} className="os-button os-button-quiet">
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  Export
                </button>
                <button type="button" onClick={() => window.print()} className="os-button os-button-quiet">
                  <Printer className="h-3.5 w-3.5" aria-hidden />
                  Print
                </button>
              </div>
            </div>
            {flash ? <p className="os-stream-in border-b border-holo-glow/10 px-4 py-1.5 font-sans text-[12px] text-holo-teal" role="status">{flash}</p> : null}
            {stale ? (
              <p className="border-b border-alert-amber/30 bg-alert-amber/[0.06] px-4 py-1.5 font-sans text-[12px] text-alert-amber" role="status">
                The constraints have changed since this plan was generated. Regenerate to apply them.
              </p>
            ) : null}
            {view === 'compare' && result ? (
              <div className="grid grid-cols-1 gap-0 2xl:grid-cols-2">
                <div className="border-b border-holo-glow/10 2xl:border-b-0 2xl:border-r">
                  <div className="os-kicker px-4 pt-3">Original</div>
                  <Gantt rows={busRows(result.baseline)} to={to} ariaLabel="Original plan" maxHeight={420} rowHeight={20} labelWidth={112} />
                </div>
                <div>
                  <div className="os-kicker px-4 pt-3 text-holo-teal">Optimised</div>
                  <Gantt rows={busRows(result.optimised)} to={to} ariaLabel="Optimised plan" maxHeight={420} rowHeight={20} labelWidth={112} />
                </div>
              </div>
            ) : (
              <div className="os-view-swap" key={view}>
                <Gantt
                  rows={rows}
                  to={to}
                  selectedId={selected?.bar ?? null}
                  highlight={selected ? new Set([selected.row]) : undefined}
                  onSelect={(bar, row) => setSelected({ bar, row })}
                  ariaLabel="Bus schedule: each bus a row, each departure a bar"
                  maxHeight={560}
                  labelWidth={150}
                />
              </div>
            )}
            <div className="border-t border-holo-glow/10 px-4 py-2.5">
              <GanttLegend
                items={[
                  { tone: 'cyan', label: 'Ordinary' },
                  { tone: 'teal', label: 'Express' },
                  { tone: 'violet', label: 'AC' },
                  { tone: 'crimson', label: 'Uncovered or conflict', hatched: true },
                ]}
              />
              <p className="mt-1 font-sans text-[11.5px] text-depot-muted">Gaps between bars are idle time and turnarounds. Click a departure for its allocation.</p>
            </div>
          </Panel>

          {result ? (
            <Panel kicker="Before vs after" title="Original plan against the optimised plan" bodyClassName="p-0" actions={<GitCompare className="h-4 w-4 text-holo-glow" aria-hidden />}>
              <CompareTable rows={compareRows(result.baseline, result.optimised)} beforeLabel="Original" afterLabel="Optimised" />
            </Panel>
          ) : null}
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-4 xl:col-span-2 xl:grid-cols-2 min-[1760px]:col-span-1 min-[1760px]:grid-cols-1">
          <Panel kicker="AI optimisation intelligence" title={result ? 'Plan ready for review' : 'Ready to optimise'} strong bodyClassName="space-y-4 p-4" actions={<AiKindChip kind="optimize" />}>
            <WorkingSteps steps={runner.steps} totalMs={runner.totalMs} />
            {!result && runner.steps.length === 0 ? (
              <p className="depot-note">
                The original plan fixes buses to routes. Generate to share buses across routes under the constraints on the left, keep off-road and overdue buses out,
                and compare every objective on the same departures.
              </p>
            ) : null}
            <section>
              <h3 className="os-kicker mb-1">Scheduling constraints</h3>
              <dl>
                <Fact label="Eligible buses" value={`${count((result?.buses ?? restrictBuses(input.buses, params)).filter((b) => b.restriction === null).length)} of ${count(input.buses.length)}`} />
                <Fact label="Turnaround · longest day" value={`${params.turnaroundMin} min · ${params.maxBlockHours} h`} />
                <Fact label="Fewest buses possible" value={count((result?.optimised ?? original).lowerBound)} />
                <Fact label="Routes · departures" value={`${count(new Set((result?.trips ?? original.trips).map((t) => t.routeId)).size)} · ${count((result?.trips ?? original.trips).length)}`} />
              </dl>
            </section>
            <section>
              <h3 className="os-kicker mb-1">Detected conflicts in the original plan</h3>
              {(result?.baseline ?? original).conflicts.length === 0 ? (
                <p className="depot-note">None.</p>
              ) : (
                <ul className="os-scroll max-h-32 space-y-1 overflow-y-auto">
                  {(result?.baseline ?? original).conflicts.map((c) => (
                    <li key={c.subject + c.kind} className="flex gap-2 font-sans text-[12px] text-depot-prose">
                      <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-alert-crimson" aria-hidden />
                      <button type="button" className="text-left hover:text-depot-ink" onClick={() => openEntity({ kind: 'vehicle', id: c.subject, depotId })}>
                        {c.text}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {result ? <PlanIntelligence result={result} onRoute={(routeId) => openEntity({ kind: 'route', id: routeId, depotId })} /> : null}
            {result ? (
              <section className="border-t border-holo-glow/10 pt-3">
                <h3 className="os-kicker mb-1">Manager review</h3>
                {review ? (
                  <p className="flex items-center gap-1.5 font-sans text-[12px] text-holo-teal">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                    {review.action === 'approved' ? 'Approved for dispatch planning' : 'Deferred'} {new Date(review.at).toLocaleTimeString('en-IN', { timeStyle: 'short' })}. Recorded in this browser; no bus has been dispatched.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="os-button os-button-solid"
                      onClick={() => recordReview({ decisionId: planId, title: `${name}: ${OBJECTIVE_LABEL[result.params.objective]} bus schedule`, scope: name, action: 'approved', note: `${result.optimised.metrics.busesUsed} buses, ${result.optimised.metrics.covered} of ${result.optimised.metrics.departures} departures` })}
                    >
                      Approve for dispatch planning
                    </button>
                    <button type="button" className="os-button os-button-quiet" onClick={() => recordReview({ decisionId: planId, title: `${name}: bus schedule`, scope: name, action: 'deferred', note: 'Deferred from the AI Bus Scheduler' })}>
                      Defer
                    </button>
                  </div>
                )}
              </section>
            ) : null}
          </Panel>

          <Panel kicker="Allocation details" title={block ? block.registration : uncoveredPick ? uncoveredPick.trip.routeId : 'Select a departure'} bodyClassName="space-y-3 p-4">
            {block ? (
              <>
                <dl>
                  <Fact label="Class" value={CLASS_WORD[block.serviceClass]} />
                  <Fact label="Day" value={`${clock(block.start)}–${clock(block.end)} · ${hours((block.end - block.start) / 60)}`} />
                  <Fact label="Departures · passengers" value={`${block.trips.length} · ${count(block.passengers)}`} />
                  <Fact label="Idle · empty km" value={`${hours(block.idleMin / 60)} · ${km(block.deadKm)}`} />
                  {block.unavailable ? <Fact label="Status" value={RESTRICTION_LABEL[block.unavailable]} tone="crimson" /> : null}
                </dl>
                <ul className="space-y-0.5">
                  {block.trips.map((t) => (
                    <li key={t.id} className={`flex justify-between gap-2 rounded-[3px] px-1.5 py-0.5 font-mono text-[11.5px] ${t.id === selected?.bar ? 'bg-depot-selected text-holo-glow' : 'text-depot-prose'}`}>
                      <span>{t.routeId}</span>
                      <span>
                        {clock(t.dep)}–{clock(t.arr)} · {t.passengers}
                      </span>
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={() => openEntity({ kind: 'vehicle', id: block.registration, depotId })} className="os-button os-button-quiet">
                  Vehicle intelligence profile
                </button>
              </>
            ) : uncoveredPick ? (
              <dl>
                <Fact label="Departs · returns" value={`${clock(uncoveredPick.trip.dep)} · ${clock(uncoveredPick.trip.arr)}`} />
                <Fact label="Passengers" value={count(uncoveredPick.trip.passengers)} />
                <Fact label="Why uncovered" value={uncoveredPick.reason === 'no_class_bus' ? 'No bus of this class' : uncoveredPick.reason === 'displaced' ? 'Gave way to a heavier departure' : uncoveredPick.reason === 'bus_unavailable' ? 'Its bus cannot run today' : 'Every suitable bus busy'} tone="crimson" />
              </dl>
            ) : (
              <EmptyNote>Click a bar on the timeline to see the bus, its day and its departures.</EmptyNote>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** What the optimiser found and recommends, with the trade-off between objectives. */
function PlanIntelligence({ result, onRoute }: { readonly result: Result; readonly onRoute: (routeId: string) => void }) {
  const o = result.optimised.metrics;
  const b = result.baseline.metrics;
  const byRoute = new Map<string, number>();
  for (const u of result.optimised.uncovered) byRoute.set(u.trip.routeId, (byRoute.get(u.trip.routeId) ?? 0) + 1);
  const best = (pick: (p: BusPlan) => number, low = true): Objective =>
    result.tradeoffs.reduce((acc, t) => ((low ? pick(t.plan) < pick(acc.plan) : pick(t.plan) > pick(acc.plan)) ? t : acc), result.tradeoffs[0]!).objective;
  return (
    <>
      <section>
        <h3 className="os-kicker mb-1">Uncovered service requirements</h3>
        {result.optimised.uncovered.length === 0 ? (
          <p className="depot-note">Every required departure has a bus.</p>
        ) : (
          <ul className="space-y-0.5">
            {[...byRoute].slice(0, 5).map(([route, n]) => (
              <li key={route} className="flex justify-between font-sans text-[12px]">
                <button type="button" onClick={() => onRoute(route)} className="font-mono text-holo-glow hover:underline">
                  {route}
                </button>
                <span className="text-alert-crimson">{n} uncovered</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {result.trace ? (
        <section>
          <h3 className="os-kicker mb-1">Candidate solutions</h3>
          <ul className="space-y-0.5">
            {result.trace.candidates.map((c) => (
              <li key={c.label} className={`flex justify-between gap-2 font-sans text-[12px] ${c.chosen ? 'text-holo-teal' : 'text-depot-prose'}`}>
                <span>
                  {c.chosen ? '✓ ' : ''}
                  {c.label}
                </span>
                <span className="font-mono">
                  {c.busesUsed} buses · {c.covered} run
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section>
        <h3 className="os-kicker mb-1">Trade-offs between objectives</h3>
        <table className="os-table">
          <thead>
            <tr>
              <th>Objective</th>
              <th className="text-right">Buses</th>
              <th className="text-right">Run</th>
              <th className="text-right">Empty km</th>
              <th className="text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {result.tradeoffs.map((t) => (
              <tr key={t.objective} className={`border-b border-holo-glow/[0.06] ${t.objective === result.params.objective ? 'bg-depot-selected' : ''}`}>
                <td className="max-w-[8rem] truncate text-[11.5px]" title={OBJECTIVE_LABEL[t.objective]}>
                  {OBJECTIVE_LABEL[t.objective]}
                </td>
                <td className="os-num">{t.plan.metrics.busesUsed}</td>
                <td className="os-num">{t.plan.metrics.covered}</td>
                <td className="os-num">{count(t.plan.metrics.emptyKm)}</td>
                <td className="os-num">{rupees(t.plan.metrics.cost.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 font-sans text-[11.5px] text-depot-muted">
          Fewest buses: {OBJECTIVE_LABEL[best((p) => p.metrics.busesUsed)]}. Most departures: {OBJECTIVE_LABEL[best((p) => p.metrics.covered, false)]}. Lowest cost:{' '}
          {OBJECTIVE_LABEL[best((p) => p.metrics.cost.total)]}. No one plan leads on all of them.
        </p>
      </section>
      <section className="rounded-[4px] border border-holo-teal/25 bg-holo-teal/[0.05] p-3">
        <h3 className="os-kicker mb-1 text-holo-teal">Recommendation</h3>
        <p className="font-sans text-[12.5px] leading-5 text-depot-ink">
          Adopt the {OBJECTIVE_LABEL[result.params.objective].toLowerCase()} plan: {count(o.busesUsed)} buses run {count(o.covered)} of {count(o.departures)} departures
          {o.covered !== b.covered ? ` (${signFor(o.covered - b.covered)}${count(Math.abs(o.covered - b.covered))} on the original)` : ''}, with {hours(o.idleHours)} idle against{' '}
          {hours(b.idleHours)}
          {result.baseline.conflicts.length > 0 ? ` and none of the original plan's ${result.baseline.conflicts.length} conflicts` : ''}. Expected impact: {count(Math.max(0, o.passengersCovered - b.passengersCovered))} more
          passengers carried.
        </p>
      </section>
    </>
  );
}
