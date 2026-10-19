'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Download, Printer, Save, ShieldCheck, Sparkles } from 'lucide-react';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { signFor } from '@/lib/depot/format';
import { DEFAULT_BUS_PARAMS, DEFAULT_CREW_PARAMS, OBJECTIVE_LABEL, PARAM_BOUNDS } from '@/lib/depot/os/sched/config';
import { crewPool } from '@/lib/depot/os/sched/crew';
import { betterJoint, evaluateJoint, jointCandidates, type JointCandidate, type JointResult } from '@/lib/depot/os/sched/joint';
import { tripsFor } from '@/lib/depot/os/sched/trips';
import type { BusParams, CrewParams, CrewSlotView, Objective, SchedBus, Trip } from '@/lib/depot/os/sched/types';
import { baselineBuses, optimiseBuses, restrictBuses } from '@/lib/depot/os/sched/vehicles';
import { AiKindChip } from '../aiKinds';
import { useStepRunner, WorkingSteps, type StepDef } from '../ai/WorkingSteps';
import { OsHeader } from '../OsHeader';
import { useOsStore, useReviewFor } from '../osStore';
import { Gantt, GanttLegend, type GanttRow } from '../gantt/Gantt';
import { EmptyNote, Metric, MetricStrip, Panel, PanelLoading, StatusTag } from '../ui';
import { BusPicker, CompareTable, FieldGroup, RangeField, SelectField, ToggleField, type CompareRow } from './Controls';
import { CoverageGrid, coverageCells } from './CoverageGrid';
import { clock, count, downloadCsv, pct, rupees, rupeesShort } from './fmt';
import { busRows, crewRows } from './ganttRows';
import { DepotDateFields, SavedScenarios, useDateParam } from './SchedChrome';
import { useSchedStore } from './schedStore';
import { useSchedInput } from './useSchedInput';

type Selection = { readonly kind: 'bus' | 'shift' | 'cell' | 'trip'; readonly id: string } | null;

interface Ctx {
  trips: Trip[];
  buses: SchedBus[];
  slots: CrewSlotView[];
  baseline: JointCandidate | null;
  independent: JointCandidate | null;
  candidates: JointCandidate[];
  best: JointCandidate | null;
}

interface Run {
  readonly busParams: BusParams;
  readonly crewParams: CrewParams;
  readonly trips: readonly Trip[];
  readonly slots: readonly CrewSlotView[];
  readonly result: JointResult;
}

const OBJECTIVES = Object.keys(OBJECTIVE_LABEL) as Objective[];

/** The chosen plan first, then the separate plan, the other joint plans and the original. */
function candidateRows(r: JointResult): JointCandidate[] {
  const rest = [r.independent, ...r.candidates, r.baseline];
  return [r.best, ...rest.filter((c) => c.key !== r.best.key)];
}

function whyPreferable(r: JointResult, drivers: number): string[] {
  const { best, independent } = r;
  const out: string[] = [];
  if (independent.busWithoutCrew === 0) {
    out.push(
      `Planned separately, the bus plan's ${count(independent.plan.metrics.busesUsed)} buses need ${count(independent.shifts.length)} crew shifts, and the ${count(drivers)} available drivers can take them all: crew do not limit service today.`,
    );
  } else {
    out.push(
      `Planned separately, ${count(independent.plan.metrics.busesUsed)} buses would need ${count(independent.shifts.length)} crew shifts; with ${count(drivers)} drivers available, ${count(independent.busWithoutCrew)} departures would have a bus but no crew.`,
    );
  }
  if (best.key === independent.key) {
    out.push(
      independent.busWithoutCrew === 0
        ? 'No joint plan does better, so the separately planned buses and crews stand, now checked against each other.'
        : `No joint plan carries more passengers: the shortage is in crew hours, not in how they are arranged. Freeing crew, allowing overtime or accepting the ${count(independent.busWithoutCrew)} departures as uncovered are the remaining options.`,
    );
  } else {
    out.push(
      `${best.label} uses ${count(best.plan.metrics.busesUsed)} buses and ${count(best.shifts.length)} shifts, gives crews to the heaviest shifts first, runs ${count(best.operable)} departures (${signFor(best.operable - independent.operable)}${count(Math.abs(best.operable - independent.operable))} on the separate plan) and carries ${signFor(best.operablePassengers - independent.operablePassengers)}${count(Math.abs(best.operablePassengers - independent.operablePassengers))} passengers.`,
    );
  }
  out.push(
    `Against the original plan it runs ${signFor(best.operable - r.baseline.operable)}${count(Math.abs(best.operable - r.baseline.operable))} departures and removes ${count(r.baseline.plan.conflicts.length)} vehicle conflicts and ${count(r.baseline.roster.metrics.restViolations + r.baseline.roster.metrics.qualificationViolations)} crew rule breaches.`,
  );
  out.push('Preferable under one objective only: the most passengers with both a bus and a crew, then the lowest estimated cost. It is not claimed to be best on every measure.');
  return out;
}

/**
 * The Joint Fleet & Crew Optimizer: plans the depot's buses and crews together. A plan
 * with few buses gives them long days that need two crews; a plan within one shift needs
 * more buses and fewer crews. The optimiser tries both ways, keeps the one that runs the
 * most passengers with both, and shows the vehicle allocation, the crew assignment and
 * the service coverage side by side, linked: select one and the others light.
 */
export function JointOptimizer() {
  const { depotId } = useDepotDetailContext();
  const openEntity = useOsStore((s) => s.openEntity);
  const recordReview = useOsStore((s) => s.recordReview);
  const setFocus = useOsStore((s) => s.setFocus);
  const save = useSchedStore((s) => s.save);
  const setLatest = useSchedStore((s) => s.setLatest);
  const [date, setDate] = useState<string | null>(null);
  const input = useSchedInput(depotId, date);
  useDateParam(input.dates, setDate);
  const [busParams, setBusParams] = useState<BusParams>(DEFAULT_BUS_PARAMS);
  const [crewParams, setCrewParams] = useState<CrewParams>(DEFAULT_CREW_PARAMS);
  const [run, setRun] = useState<Run | null>(null);
  const [shownKey, setShownKey] = useState<string | null>(null);
  const [sel, setSel] = useState<Selection>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const runner = useStepRunner<Ctx>();
  const setB = <K extends keyof BusParams>(k: K, v: BusParams[K]): void => setBusParams((p) => ({ ...p, [k]: v }));
  const setC = <K extends keyof CrewParams>(k: K, v: CrewParams[K]): void => setCrewParams((p) => ({ ...p, [k]: v }));
  const name = input.depot?.name ?? `Depot ${depotId}`;

  const optimise = useCallback(async () => {
    const timetable = input.timetable;
    const depot = input.depot;
    if (!timetable || !depot) return;
    const bp = busParams;
    const cp = crewParams;
    const steps: StepDef<Ctx>[] = [
      {
        label: 'Evaluate demand requirements',
        run: (c) => {
          c.trips = tripsFor(timetable, bp);
          return `${count(c.trips.length)} departures on ${count(new Set(c.trips.map((t) => t.routeId)).size)} routes for ${count(c.trips.reduce((s, t) => s + t.passengers, 0))} forecast passengers.`;
        },
      },
      {
        label: 'Evaluate bus availability',
        run: (c) => {
          c.buses = restrictBuses(input.buses, bp);
          return `${count(c.buses.filter((b) => b.restriction === null).length)} of ${count(input.buses.length)} buses may run after off-road, overdue and reserve holds.`;
        },
      },
      {
        label: 'Evaluate crew availability',
        run: (c) => {
          c.slots = crewPool(depot, input.crewShiftHint, timetable.operatingDate, cp.extraUnavailable);
          const av = (role: 'driver' | 'conductor'): number => c.slots.filter((s) => s.role === role && s.available).length;
          return `${count(av('driver'))} drivers and ${count(av('conductor'))} conductors available; ${count(c.slots.filter((s) => s.available && s.acEndorsed).length)} AC-endorsed.`;
        },
      },
      {
        label: 'Detect constraints and conflicts',
        run: (c) => {
          c.baseline = evaluateJoint(baselineBuses(timetable, c.trips, c.buses, bp), c.slots, cp, 'baseline', 'Original plan', bp.maxBlockHours);
          c.independent = evaluateJoint(optimiseBuses(timetable, c.trips, c.buses, bp), c.slots, cp, 'independent', 'Buses and crew planned separately', bp.maxBlockHours);
          return `Original: ${count(c.baseline.plan.conflicts.length)} vehicle conflicts, ${count(c.baseline.roster.metrics.restViolations + c.baseline.roster.metrics.qualificationViolations)} crew breaches. Planned separately: ${count(c.independent.busWithoutCrew)} departures with a bus but no crew.`;
        },
      },
      {
        label: 'Generate feasible allocations',
        run: (c) => {
          c.candidates = jointCandidates(timetable, c.trips, c.buses, c.slots, bp, cp);
          return `${count(c.candidates.length)} joint plans built, each with its bus allocation and its crew roster.`;
        },
      },
      {
        label: 'Estimate remaining uncovered departures',
        run: (c) => {
          c.best = c.candidates.reduce((acc, x) => (betterJoint(x, acc) ? x : acc), c.independent!);
          return `${c.best.label}: ${count(c.best.operable)} of ${count(c.trips.length)} departures run with a bus and a crew; ${count(c.trips.length - c.best.operable)} remain uncovered.`;
        },
      },
      {
        label: 'Compare the proposed plan with the baseline',
        run: (c) => `${signFor(c.best!.operable - c.baseline!.operable)}${count(Math.abs(c.best!.operable - c.baseline!.operable))} departures run against the original plan; cost ${rupees(c.best!.cost)} against ${rupees(c.baseline!.cost)}.`,
      },
      {
        label: 'Present the solution for manager review',
        run: () => 'Proposed plan ready. Nothing has been sent to any bus or crew.',
      },
    ];
    const ctx = await runner.run(steps, { trips: [], buses: [], slots: [], baseline: null, independent: null, candidates: [], best: null });
    if (!ctx || !ctx.best || !ctx.baseline || !ctx.independent) return;
    const result: JointResult = { baseline: ctx.baseline, independent: ctx.independent, candidates: ctx.candidates, best: ctx.best };
    setRun({ busParams: bp, crewParams: cp, trips: ctx.trips, slots: ctx.slots, result });
    setShownKey(ctx.best.key);
    setSel(null);
    setLatest({
      kind: 'joint',
      depotId,
      date: timetable.operatingDate,
      label: ctx.best.label,
      figures: { operable: ctx.best.operable, departures: ctx.trips.length, buses: ctx.best.plan.metrics.busesUsed, shifts: ctx.best.shifts.length, baselineOperable: ctx.baseline.operable, separateOperable: ctx.independent.operable, busWithoutCrewSeparate: ctx.independent.busWithoutCrew },
      summary: `${name}: the joint plan (${ctx.best.label.toLowerCase()}) runs ${ctx.best.operable} of ${ctx.trips.length} departures with a bus and a crew, against ${ctx.independent.operable} planned separately and ${ctx.baseline.operable} in the original plan.`,
      busParams: { ...bp, maxBlockHours: ctx.best.maxBlockHours },
    });
  }, [input.timetable, input.depot, input.buses, input.crewShiftHint, busParams, crewParams, runner, depotId, name, setLatest]);

  const search = useSearchParams();
  const ran = useRef(false);
  useEffect(() => {
    if (search?.get('run') === '1' && !ran.current && input.timetable) {
      ran.current = true;
      void optimise();
    }
  }, [search, input.timetable, optimise]);

  const shown = run ? [run.result.best, run.result.independent, run.result.baseline, ...run.result.candidates].find((c) => c.key === shownKey) ?? run.result.best : null;
  const withBus = useMemo(() => new Set(shown ? shown.plan.blocks.filter((b) => b.unavailable === null).flatMap((b) => b.trips.map((t) => t.id)) : []), [shown]);
  const cells = useMemo(() => (shown && run ? coverageCells(run.trips, shown.runs, withBus) : new Map()), [shown, run, withBus]);
  const routes = useMemo(() => [...new Set((run?.trips ?? []).map((t) => t.routeId))].sort(), [run]);

  // Linked selection: what a selected bus, shift, cell or departure touches in each view.
  const linked = useMemo(() => {
    const ids = new Set<string>();
    const cellKeys = new Set<string>();
    if (!sel || !shown) return { ids, cellKeys };
    const tripCell = (t: Trip): string => `${t.routeId}|${Math.floor(t.dep / 60)}`;
    const addBus = (reg: string): void => {
      ids.add(reg);
      const block = shown.plan.blocks.find((b) => b.registration === reg);
      for (const t of block?.trips ?? []) {
        ids.add(t.id);
        cellKeys.add(tripCell(t));
      }
      for (const s of shown.shifts) if (s.registration === reg) ids.add(s.id);
    };
    if (sel.kind === 'bus') addBus(sel.id);
    if (sel.kind === 'shift') {
      const shift = shown.shifts.find((s) => s.id === sel.id);
      if (shift) {
        ids.add(shift.id);
        ids.add(shift.registration);
        for (const id of shift.trips) {
          ids.add(id);
          const t = run?.trips.find((x) => x.id === id);
          if (t) cellKeys.add(tripCell(t));
        }
      }
    }
    if (sel.kind === 'trip') {
      const block = shown.plan.blocks.find((b) => b.trips.some((t) => t.id === sel.id));
      if (block) addBus(block.registration);
      ids.add(sel.id);
    }
    if (sel.kind === 'cell') {
      cellKeys.add(sel.id);
      const cell = cells.get(sel.id);
      for (const t of cell?.trips ?? []) {
        ids.add(t.id);
        const block = shown.plan.blocks.find((b) => b.trips.some((x) => x.id === t.id));
        if (block) ids.add(block.registration);
        for (const s of shown.shifts) if (s.trips.includes(t.id)) ids.add(s.id);
      }
    }
    return { ids, cellKeys };
  }, [sel, shown, cells, run]);

  // Departures with a bus but no crew are drawn amber, so the vehicle view shows the risk.
  const vehicleRows = useMemo<GanttRow[]>(() => {
    if (!shown) return [];
    return busRows(shown.plan).map((row) => ({
      ...row,
      bars: row.bars.map((bar) => (withBus.has(bar.id) && !shown.runs.has(bar.id) ? { ...bar, tone: 'amber' as const, hatched: true, title: `${bar.title} · bus but no crew` } : bar)),
    }));
  }, [shown, withBus]);
  const crewRowsShown = useMemo(() => (shown ? crewRows(shown.roster, 'duties') : []), [shown]);
  const planId = run && shown ? `joint-plan:${depotId}:${shown.key}:${shown.operable}:${shown.plan.metrics.busesUsed}` : 'none';
  const review = useReviewFor(planId);
  const stale = run !== null && (JSON.stringify(run.busParams) !== JSON.stringify(busParams) || JSON.stringify(run.crewParams) !== JSON.stringify(crewParams));

  useEffect(() => {
    if (sel?.kind === 'bus') setFocus({ kind: 'vehicle', id: sel.id, label: `${sel.id} in the joint plan` });
    else if (shown) setFocus({ kind: 'scenario', id: planId, label: `${name}: joint fleet and crew plan` });
  }, [sel, shown, planId, name, setFocus]);

  if (!input.timetable) {
    return (
      <div className="space-y-4">
        <OsHeader title="Joint Fleet & Crew Optimizer" description="Buses and crews planned together, so every departure has both" statuses={['live', 'scenario', 'proposed']} />
        <PanelLoading rows={8} label="Reading the depot's roster, crew and timetable" />
      </div>
    );
  }

  const r = run?.result;
  const drivers = run ? run.slots.filter((s) => s.role === 'driver' && s.available).length : 0;
  const cmp: CompareRow[] = r && shown
    ? [
        { label: 'Departures run (bus and crew)', before: r.baseline.operable, after: shown.operable, format: count, better: 'higher' },
        { label: 'Passengers carried', before: r.baseline.operablePassengers, after: shown.operablePassengers, format: count, better: 'higher' },
        { label: 'Departures with a bus but no crew', before: r.baseline.busWithoutCrew, after: shown.busWithoutCrew, format: count, better: 'lower' },
        { label: 'Buses allocated', before: r.baseline.plan.metrics.busesUsed, after: shown.plan.metrics.busesUsed, format: count, better: 'neutral' },
        { label: 'Crew shifts', before: r.baseline.shifts.length, after: shown.shifts.length, format: count, better: 'neutral' },
        { label: 'Vehicle utilisation', before: r.baseline.plan.metrics.utilisation, after: shown.plan.metrics.utilisation, format: pct, better: 'higher' },
        { label: 'Crew utilisation', before: r.baseline.roster.metrics.utilisation, after: shown.roster.metrics.utilisation, format: pct, better: 'neutral' },
        { label: 'Vehicle conflicts', before: r.baseline.plan.conflicts.length, after: shown.plan.conflicts.length, format: count, better: 'lower' },
        { label: 'Crew rule breaches', before: r.baseline.roster.metrics.restViolations + r.baseline.roster.metrics.qualificationViolations, after: shown.roster.metrics.restViolations + shown.roster.metrics.qualificationViolations, format: count, better: 'lower' },
        { label: 'Estimated operating cost', before: r.baseline.cost, after: shown.cost, format: rupees, better: 'neutral' },
      ]
    : [];

  return (
    <div className="space-y-4" data-testid="os-joint-optimizer">
      <OsHeader
        title="Joint Fleet & Crew Optimizer"
        description="Buses and crews planned together, so every departure has both"
        statuses={['live', 'scenario', 'proposed']}
        actions={
          <button type="button" onClick={() => void optimise()} disabled={runner.running} className="os-cta" data-testid="os-optimise-depot">
            <Sparkles className={`h-4 w-4 ${runner.running ? 'animate-pulse' : ''}`} aria-hidden />
            {runner.running ? 'Optimising…' : 'Optimize depot operations'}
          </button>
        }
      />

      {r && shown ? (
        <>
          <div className="os-proposed-banner" role="status">
            <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
            <span>
              <span className="font-semibold">Proposed plan</span> · {shown.label}. Not executed in the network: buses and crews are unchanged until the depot controller acts.
            </span>
          </div>
          <MetricStrip columns={6}>
            <Metric label="Vehicles required" value={count(shown.plan.lowerBound)} sub="Most departures out at once" />
            <Metric label="Vehicles allocated" value={count(shown.plan.metrics.busesUsed)} sub={`of ${count(shown.plan.metrics.eligibleBuses)} eligible`} />
            <Metric label="Drivers · conductors" value={`${count(shown.roster.metrics.used.driver)} · ${count(shown.roster.metrics.used.conductor)}`} sub={`${count(shown.shifts.length)} shifts`} />
            <Metric label="Departures covered" value={`${count(shown.operable)}/${count(run.trips.length)}`} tone="teal" sub="Bus and crew both" />
            <Metric label="Uncovered services" value={count(run.trips.length - shown.operable)} tone={run.trips.length - shown.operable > 0 ? 'crimson' : 'green'} sub={`${count(shown.busWithoutCrew)} bus without crew`} />
            <Metric label="Est. cost" value={rupeesShort(shown.cost)} status="estimate" />
          </MetricStrip>
          <MetricStrip columns={4}>
            <Metric label="Vehicle utilisation" value={pct(shown.plan.metrics.utilisation)} />
            <Metric label="Crew utilisation" value={pct(shown.roster.metrics.utilisation)} />
            <Metric label="Conflicts resolved" value={count(r.baseline.plan.conflicts.length + r.baseline.roster.metrics.restViolations + r.baseline.roster.metrics.qualificationViolations)} tone="green" sub="Vehicle and crew, from the original" />
            <Metric label="Constraints unresolved" value={count(shown.busWithoutCrew + shown.plan.uncovered.length)} tone={shown.busWithoutCrew + shown.plan.uncovered.length > 0 ? 'amber' : 'green'} sub="Short of buses or crew" />
          </MetricStrip>
        </>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel kicker="Joint constraints" title={name} actions={<StatusTag status="scenario" />} bodyClassName="p-0">
            <div className="border-b border-holo-glow/[0.08] px-4 py-3">
              <DepotDateFields depotId={depotId} dates={input.dates} date={input.timetable.operatingDate} onDate={setDate} />
            </div>
            <FieldGroup title="Service and fleet">
              <SelectField<Objective> label="Bus objective" value={busParams.objective} onChange={(v) => setB('objective', v)} options={OBJECTIVES.map((o) => ({ key: o, label: OBJECTIVE_LABEL[o] }))} />
              <RangeField label="Passenger demand forecast" value={busParams.demandPct} {...PARAM_BOUNDS.demandPct} format={(v) => (v === 0 ? 'As forecast' : `${signFor(v)}${Math.abs(v)}%`)} onChange={(v) => setB('demandPct', v)} />
              <RangeField label="Turnaround" value={busParams.turnaroundMin} {...PARAM_BOUNDS.turnaroundMin} format={(v) => `${v} min`} onChange={(v) => setB('turnaroundMin', v)} />
              <RangeField label="Spare fleet" value={busParams.reservePct} {...PARAM_BOUNDS.reservePct} format={(v) => `${v}%`} onChange={(v) => setB('reservePct', v)} />
              <ToggleField label="Maintenance holds (service overdue)" checked={busParams.holdOverdue} onChange={(v) => setB('holdOverdue', v)} />
              <BusPicker label="Buses unavailable" options={input.buses.map((b) => b.registration)} value={busParams.unavailable} onChange={(v) => setB('unavailable', v)} />
            </FieldGroup>
            <FieldGroup title="Crew">
              <RangeField label="Drivers unavailable (beyond leave)" value={crewParams.extraUnavailable.driver} min={0} max={60} step={1} format={(v) => `${v}`} onChange={(v) => setC('extraUnavailable', { ...crewParams.extraUnavailable, driver: v })} hint="Try a shortage: the joint plan then trades buses for crew." />
              <RangeField label="Conductors unavailable (beyond leave)" value={crewParams.extraUnavailable.conductor} min={0} max={60} step={1} format={(v) => `${v}`} onChange={(v) => setC('extraUnavailable', { ...crewParams.extraUnavailable, conductor: v })} />
              <RangeField label="Maximum duty hours" value={crewParams.maxDutyHours} {...PARAM_BOUNDS.maxDutyHours} format={(v) => `${v} h`} onChange={(v) => setC('maxDutyHours', v)} />
              <RangeField label="Minimum break between shifts" value={crewParams.minBreakMin} {...PARAM_BOUNDS.minBreakMin} format={(v) => `${v} min`} onChange={(v) => setC('minBreakMin', v)} />
              <RangeField label="Overtime allowance" value={crewParams.overtimeHours} {...PARAM_BOUNDS.overtimeHours} format={(v) => `${v} h`} onChange={(v) => setC('overtimeHours', v)} />
            </FieldGroup>
          </Panel>
          <Panel kicker="AI optimisation" title={run ? 'Solution for review' : 'Ready to optimise'} strong bodyClassName="space-y-3 p-4" actions={<AiKindChip kind="optimize" />}>
            <WorkingSteps steps={runner.steps} totalMs={runner.totalMs} />
            {!run && runner.steps.length === 0 ? <p className="depot-note">Optimise to plan buses and crews together for {name} and compare with planning them one after the other.</p> : null}
          </Panel>
          <SavedScenarios
            kind="joint"
            depotId={depotId}
            onLoad={(s) => {
              setBusParams(s.busParams);
              if (s.crewParams) setCrewParams(s.crewParams);
              setDate(s.date);
              setFlash(`Loaded "${s.label}". Optimise to recompute it.`);
            }}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {flash ? <p className="os-stream-in font-sans text-[12px] text-holo-teal" role="status">{flash}</p> : null}
          {stale ? <p className="rounded-[4px] border border-alert-amber/30 bg-alert-amber/[0.06] px-4 py-1.5 font-sans text-[12px] text-alert-amber" role="status">The constraints have changed since this plan was made. Optimise again to apply them.</p> : null}
          {!r || !shown ? (
            <Panel kicker="Three linked views" title="Vehicle allocation · crew assignment · service coverage" bodyClassName="p-0">
              <EmptyNote>Optimise depot operations to see which buses run which duties, which crews cover them, and which departures are covered, at risk or uncovered, linked to each other.</EmptyNote>
            </Panel>
          ) : (
            <>
              <Panel kicker="Plans evaluated" title="Candidate plans, the chosen one first" bodyClassName="p-0">
                <table className="os-table">
                  <thead>
                    <tr>
                      <th>Plan</th>
                      <th className="text-right">Run</th>
                      <th className="text-right">Passengers</th>
                      <th className="text-right">Bus, no crew</th>
                      <th className="text-right">Buses</th>
                      <th className="text-right">Shifts</th>
                      <th className="text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidateRows(r).map((c) => (
                      <tr key={c.key} onClick={() => setShownKey(c.key)} className={`os-row ${shown.key === c.key ? 'os-row-selected' : ''}`}>
                        <td className="whitespace-nowrap">
                          {c.key === r.best.key ? <span className="mr-1 text-holo-teal">✓</span> : null}
                          {c.label}
                        </td>
                        <td className="os-num">{count(c.operable)}</td>
                        <td className="os-num">{count(c.operablePassengers)}</td>
                        <td className={`os-num ${c.busWithoutCrew > 0 ? 'text-alert-amber' : ''}`}>{count(c.busWithoutCrew)}</td>
                        <td className="os-num">{count(c.plan.metrics.busesUsed)}</td>
                        <td className="os-num">{count(c.shifts.length)}</td>
                        <td className="os-num">{rupees(c.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="px-4 py-2 font-sans text-[11.5px] text-depot-muted">Click a plan to see it in the three views.</p>
              </Panel>

              <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
                <Panel kicker="1 · Vehicle allocation" title="Which buses run which duties" bodyClassName="p-0" actions={<StatusTag status="proposed" />}>
                  <Gantt rows={vehicleRows} selectedId={sel?.kind === 'trip' ? sel.id : null} highlight={linked.ids} onSelect={(bar, row) => setSel(row.startsWith('uncovered') ? { kind: 'trip', id: bar } : { kind: 'bus', id: row })} ariaLabel="Vehicle allocation" maxHeight={380} rowHeight={20} labelWidth={112} />
                  <div className="border-t border-holo-glow/10 px-3 py-2">
                    <GanttLegend items={[{ tone: 'cyan', label: 'Ordinary' }, { tone: 'teal', label: 'Express' }, { tone: 'violet', label: 'AC' }, { tone: 'amber', label: 'Bus, no crew', hatched: true }, { tone: 'crimson', label: 'Uncovered', hatched: true }]} />
                  </div>
                </Panel>
                <Panel kicker="2 · Crew assignment" title="Which driver and conductor slots cover them" bodyClassName="p-0" actions={<StatusTag status="proposed" />}>
                  <Gantt rows={crewRowsShown} highlight={linked.ids} onSelect={(bar) => setSel({ kind: 'shift', id: bar })} ariaLabel="Crew assignment" maxHeight={380} rowHeight={20} labelWidth={150} />
                  <div className="border-t border-holo-glow/10 px-3 py-2">
                    <GanttLegend items={[{ tone: 'teal', label: 'Crewed' }, { tone: 'violet', label: 'AC shift' }, { tone: 'amber', label: 'Overtime' }, { tone: 'crimson', label: 'No crew', hatched: true }]} />
                  </div>
                </Panel>
              </div>

              <Panel kicker="3 · Service coverage" title="Departures by route and hour: run, at risk, uncovered" bodyClassName="space-y-2 p-3" actions={<StatusTag status="proposed" />}>
                <CoverageGrid routes={routes} cells={cells} selectedKey={sel?.kind === 'cell' ? sel.id : null} lit={linked.cellKeys} onSelect={(key) => setSel({ kind: 'cell', id: key })} />
                <div className="flex flex-wrap items-center gap-4 font-sans text-[11.5px] text-depot-prose">
                  <span className="flex items-center gap-1.5"><span className="os-cell os-cell-covered h-3 w-5" aria-hidden />All run</span>
                  <span className="flex items-center gap-1.5"><span className="os-cell os-cell-risk h-3 w-5" aria-hidden />Bus but no crew</span>
                  <span className="flex items-center gap-1.5"><span className="os-cell os-cell-uncovered h-3 w-5" aria-hidden />Uncovered</span>
                  <span className="text-depot-muted">Select a bus, a shift or a cell: the other views light what it touches.</span>
                  {sel ? (
                    <button type="button" onClick={() => setSel(null)} className="depot-link">
                      Clear selection
                    </button>
                  ) : null}
                  {sel?.kind === 'bus' ? (
                    <button type="button" onClick={() => openEntity({ kind: 'vehicle', id: sel.id, depotId })} className="depot-link">
                      {sel.id} profile
                    </button>
                  ) : null}
                </div>
              </Panel>

              <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <Panel kicker="Why this plan" title="The AI's reasoning, from the figures" strong bodyClassName="space-y-2 p-4" actions={<AiKindChip kind="recommend" />}>
                  {whyPreferable(r, drivers).map((line) => (
                    <p key={line} className="font-sans text-[12.5px] leading-5 text-depot-ink">
                      {line}
                    </p>
                  ))}
                  <div className="flex flex-wrap gap-2 border-t border-holo-glow/10 pt-3">
                    {review ? (
                      <p className="flex items-center gap-1.5 font-sans text-[12px] text-holo-teal">
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                        {review.action === 'approved' ? 'Approved for planning' : 'Deferred'} {new Date(review.at).toLocaleTimeString('en-IN', { timeStyle: 'short' })}. Recorded in this browser; nothing executed.
                      </p>
                    ) : (
                      <>
                        <button type="button" className="os-button os-button-solid" onClick={() => recordReview({ decisionId: planId, title: `${name}: joint fleet and crew plan`, scope: name, action: 'approved', note: `${shown.operable} of ${run.trips.length} departures with bus and crew` })}>
                          Approve the proposed plan
                        </button>
                        <button type="button" className="os-button os-button-quiet" onClick={() => recordReview({ decisionId: planId, title: `${name}: joint plan`, scope: name, action: 'deferred', note: 'Deferred from the Joint Optimizer' })}>
                          Defer
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      className="os-button os-button-quiet"
                      onClick={() => {
                        save({ kind: 'joint', depotId, depotName: name, date: input.timetable!.operatingDate, label: `${shown.label} · ${count(shown.operable)} run`, busParams: { ...run.busParams, maxBlockHours: shown.maxBlockHours }, crewParams: run.crewParams, figures: { run: shown.operable, buses: shown.plan.metrics.busesUsed, shifts: shown.shifts.length } });
                        setFlash('Scenario saved in this browser.');
                      }}
                    >
                      <Save className="h-3.5 w-3.5" aria-hidden />
                      Save scenario
                    </button>
                    <button
                      type="button"
                      className="os-button os-button-quiet"
                      onClick={() =>
                        downloadCsv(
                          `${name.replace(/\W+/g, '-').toLowerCase()}-joint-plan-${input.timetable!.operatingDate}.csv`,
                          ['Bus', 'Route', 'Departs', 'Returns', 'Driver', 'Conductor', 'Runs'],
                          shown.plan.blocks.flatMap((b) =>
                            b.trips.map((t) => {
                              const a = shown.roster.assignments.find((x) => x.shift.trips.includes(t.id));
                              return [b.registration, t.routeId, clock(t.dep), clock(t.arr), a?.driver ?? '', a?.conductor ?? '', shown.runs.has(t.id) ? 'Yes' : 'No crew'];
                            }),
                          ),
                        )
                      }
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden />
                      Export
                    </button>
                    <button type="button" className="os-button os-button-quiet" onClick={() => window.print()}>
                      <Printer className="h-3.5 w-3.5" aria-hidden />
                      Print
                    </button>
                  </div>
                </Panel>
                <Panel kicker="Before vs after" title="Original plan against the proposed plan" bodyClassName="p-0">
                  <CompareTable rows={cmp} beforeLabel="Original" afterLabel="Proposed" />
                </Panel>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
