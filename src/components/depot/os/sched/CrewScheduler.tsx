'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Download, GitCompare, Printer, RefreshCw, Save, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useDepotDetailContext } from '@/components/depot/data/DepotDetailProvider';
import { signFor } from '@/lib/depot/format';
import { CREW_OBJECTIVE_LABEL, DEFAULT_BUS_PARAMS, DEFAULT_CREW_PARAMS, OBJECTIVE_LABEL, PARAM_BOUNDS } from '@/lib/depot/os/sched/config';
import { crewPool, rosterCrew, sequentialRoster, shiftsOf } from '@/lib/depot/os/sched/crew';
import { tripsFor } from '@/lib/depot/os/sched/trips';
import type { BusParams, BusPlan, CrewObjective, CrewParams, CrewRoster, CrewShift, CrewSlotView } from '@/lib/depot/os/sched/types';
import { baselineBuses, optimiseBuses, restrictBuses } from '@/lib/depot/os/sched/vehicles';
import { AiKindChip } from '../aiKinds';
import { useStepRunner, WorkingSteps, type StepDef } from '../ai/WorkingSteps';
import { OsHeader } from '../OsHeader';
import { useOsStore, useReviewFor } from '../osStore';
import { Gantt, GanttLegend } from '../gantt/Gantt';
import { EmptyNote, Fact, LocalTabs, Metric, MetricStrip, Panel, PanelLoading, StatusTag } from '../ui';
import { CompareTable, FieldGroup, RangeField, SelectField, ToggleField, type CompareRow } from './Controls';
import { clock, count, downloadCsv, hours, pct } from './fmt';
import { crewRows } from './ganttRows';
import { DepotDateFields, SavedScenarios, useDateParam } from './SchedChrome';
import { latestKey, useSchedStore } from './schedStore';
import { useSchedInput } from './useSchedInput';

type View = 'driver' | 'conductor' | 'duties' | 'review';
type Source = 'optimised' | 'original';

interface Ctx {
  plan: BusPlan | null;
  shifts: CrewShift[];
  slots: CrewSlotView[];
  baseline: CrewRoster | null;
  roster: CrewRoster | null;
}

interface Result {
  readonly params: CrewParams;
  readonly source: Source;
  readonly shifts: readonly CrewShift[];
  readonly slots: readonly CrewSlotView[];
  readonly baseline: CrewRoster;
  readonly roster: CrewRoster;
}

const OBJECTIVES = Object.keys(CREW_OBJECTIVE_LABEL) as CrewObjective[];

function compareRows(b: CrewRoster, a: CrewRoster): CompareRow[] {
  const x = b.metrics;
  const y = a.metrics;
  return [
    { label: 'Shifts covered', before: x.covered, after: y.covered, format: count, better: 'higher' },
    { label: 'Unassigned shifts', before: x.uncovered, after: y.uncovered, format: count, better: 'lower' },
    { label: 'Overtime hours', before: x.overtimeHours, after: y.overtimeHours, format: (v) => `${v.toFixed(1)} h`, better: 'lower' },
    { label: 'Break violations', before: x.restViolations, after: y.restViolations, format: count, better: 'lower' },
    { label: 'AC endorsement breaches', before: x.qualificationViolations, after: y.qualificationViolations, format: count, better: 'lower' },
    { label: 'Drivers used', before: x.used.driver, after: y.used.driver, format: count, better: 'neutral' },
    { label: 'Conductors used', before: x.used.conductor, after: y.used.conductor, format: count, better: 'neutral' },
    { label: 'Reserve drivers', before: x.reserve.driver, after: y.reserve.driver, format: count, better: 'higher' },
    { label: 'Crew utilisation', before: x.utilisation, after: y.utilisation, format: pct, better: 'neutral' },
    { label: 'Workload spread', before: x.workloadSpread, after: y.workloadSpread, format: (v) => `${v.toFixed(1)} h`, better: 'lower' },
  ];
}

/**
 * The AI Crew Scheduler: rosters anonymous driver and conductor slots onto the day's
 * crew shifts (cut from a bus plan) within the daily limit, overtime allowance, the break
 * between a slot's shifts and the AC endorsement, and compares the roster with the
 * first-free-slot method. Slots are roster places, never people; the roster is a
 * proposal for the depot's crew controller.
 */
export function CrewScheduler() {
  const { depotId } = useDepotDetailContext();
  const recordReview = useOsStore((s) => s.recordReview);
  const setFocus = useOsStore((s) => s.setFocus);
  const latestBus = useSchedStore((s) => s.latest[latestKey('bus', depotId)] ?? null);
  const save = useSchedStore((s) => s.save);
  const setLatest = useSchedStore((s) => s.setLatest);
  const [date, setDate] = useState<string | null>(null);
  const input = useSchedInput(depotId, date);
  useDateParam(input.dates, setDate);
  const [params, setParams] = useState<CrewParams>(DEFAULT_CREW_PARAMS);
  const [source, setSource] = useState<Source>('optimised');
  const [result, setResult] = useState<Result | null>(null);
  const [view, setView] = useState<View>('duties');
  const [showBaseline, setShowBaseline] = useState(false);
  const [selected, setSelected] = useState<{ bar: string; row: string } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const paramsRef = useRef<HTMLDivElement>(null);
  const runner = useStepRunner<Ctx>();
  const set = <K extends keyof CrewParams>(key: K, value: CrewParams[K]): void => setParams((p) => ({ ...p, [key]: value }));
  const name = input.depot?.name ?? `Depot ${depotId}`;
  const busParams: BusParams = latestBus?.busParams ?? DEFAULT_BUS_PARAMS;
  const busLabel = latestBus?.busParams ? `${OBJECTIVE_LABEL[busParams.objective]} plan from the AI Bus Scheduler` : `${OBJECTIVE_LABEL[busParams.objective]} plan (defaults)`;

  const pool = useMemo(
    () => (input.depot && input.timetable ? crewPool(input.depot, input.crewShiftHint, input.timetable.operatingDate, params.extraUnavailable) : []),
    [input.depot, input.timetable, input.crewShiftHint, params.extraUnavailable],
  );
  const absence = useMemo(() => {
    const out = new Map<string, number>();
    for (const s of pool) if (!s.available && s.absence) out.set(s.absence, (out.get(s.absence) ?? 0) + 1);
    return [...out];
  }, [pool]);

  const generate = useCallback(async () => {
    const timetable = input.timetable;
    const depot = input.depot;
    if (!timetable || !depot) return;
    const steps: StepDef<Ctx>[] = [
      {
        label: 'Read the required duties',
        run: (c) => {
          const trips = tripsFor(timetable, busParams);
          const buses = restrictBuses(input.buses, busParams);
          c.plan = source === 'original' ? baselineBuses(timetable, trips, buses, busParams) : optimiseBuses(timetable, trips, buses, busParams);
          c.shifts = shiftsOf(c.plan.blocks, params);
          const relieved = c.plan.blocks.filter((b) => c.shifts.filter((s) => s.registration === b.registration).length > 1).length;
          return `${count(c.shifts.length)} crew shifts from ${count(c.plan.blocks.filter((b) => b.unavailable === null).length)} bus duties; ${count(relieved)} buses need a relief crew; ${count(c.shifts.filter((s) => s.needsAc).length)} shifts on AC coaches.`;
        },
      },
      {
        label: 'Read crew availability',
        run: (c) => {
          c.slots = pool;
          const av = (role: 'driver' | 'conductor'): number => pool.filter((s) => s.role === role && s.available).length;
          return `${count(av('driver'))} drivers and ${count(av('conductor'))} conductors available; ${count(pool.filter((s) => s.available && s.acEndorsed).length)} drivers hold the AC endorsement.`;
        },
      },
      {
        label: 'Check the rules on the first-free-slot roster',
        run: (c) => {
          c.baseline = sequentialRoster(c.shifts, c.slots, params);
          const m = c.baseline.metrics;
          return `${count(m.restViolations)} break violations, ${count(m.qualificationViolations)} AC endorsement breaches, ${m.overtimeHours.toFixed(1)} overtime hours, ${count(m.uncovered)} shifts unassigned.`;
        },
      },
      {
        label: 'Match eligible crew to duties',
        run: (c) => {
          c.roster = rosterCrew(c.shifts, c.slots, params);
          const m = c.roster.metrics;
          return `${CREW_OBJECTIVE_LABEL[params.objective]}: ${count(m.covered)} of ${count(m.shifts)} shifts crewed with no overlap, every break and endorsement held.`;
        },
      },
      {
        label: 'Balance workload and overtime',
        run: (c) => {
          const m = c.roster!.metrics;
          return `${m.overtimeHours.toFixed(1)} overtime hours; spread between the busiest and lightest slot ${m.workloadSpread.toFixed(1)} h; ${count(m.reserve.driver)} drivers and ${count(m.reserve.conductor)} conductors in reserve.`;
        },
      },
      {
        label: 'Compare against the baseline roster',
        run: (c) => {
          const b = c.baseline!.metrics;
          const a = c.roster!.metrics;
          return `${count(b.restViolations + b.qualificationViolations)} rule breaches resolved; overtime ${signFor(a.overtimeHours - b.overtimeHours)}${Math.abs(a.overtimeHours - b.overtimeHours).toFixed(1)} h; ${a.covered === b.covered ? 'the same shifts crewed' : `${signFor(a.covered - b.covered)}${count(Math.abs(a.covered - b.covered))} shifts crewed`}.`;
        },
      },
    ];
    const ctx = await runner.run(steps, { plan: null, shifts: [], slots: [], baseline: null, roster: null });
    if (!ctx || !ctx.baseline || !ctx.roster) return;
    setResult({ params, source, shifts: ctx.shifts, slots: ctx.slots, baseline: ctx.baseline, roster: ctx.roster });
    setShowBaseline(false);
    setSelected(null);
    const m = ctx.roster.metrics;
    setLatest({
      kind: 'crew',
      depotId,
      date: timetable.operatingDate,
      label: CREW_OBJECTIVE_LABEL[params.objective],
      figures: { shifts: m.shifts, covered: m.covered, unassigned: m.uncovered, overtimeHours: Math.round(m.overtimeHours), drivers: m.used.driver, conductors: m.used.conductor, breachesResolved: ctx.baseline.metrics.restViolations + ctx.baseline.metrics.qualificationViolations },
      summary: `${name}: ${m.covered} of ${m.shifts} crew shifts covered with ${m.used.driver} drivers and ${m.used.conductor} conductors, ${m.overtimeHours.toFixed(1)} overtime hours, no rule breaches.`,
    });
  }, [input.timetable, input.depot, input.buses, busParams, source, params, pool, runner, depotId, name, setLatest]);

  const roster = result ? (showBaseline ? result.baseline : result.roster) : null;
  const rows = useMemo(() => (roster && view !== 'review' ? crewRows(roster, view) : []), [roster, view]);
  const pick = roster && selected ? roster.assignments.find((a) => a.shift.id === selected.bar) : undefined;
  const planId = result ? `crew-roster:${depotId}:${result.shifts.length}:${result.roster.metrics.covered}:${result.params.objective}` : 'none';
  const review = useReviewFor(planId);
  const stale = result !== null && (JSON.stringify(result.params) !== JSON.stringify(params) || result.source !== source);

  useEffect(() => {
    if (result) setFocus({ kind: 'scenario', id: planId, label: `${name}: ${CREW_OBJECTIVE_LABEL[result.params.objective]} crew roster` });
  }, [result, planId, name, setFocus]);

  const note = (text: string): void => {
    setFlash(text);
    window.setTimeout(() => setFlash(null), 3200);
  };

  if (!input.timetable) {
    return (
      <div className="space-y-4">
        <OsHeader title="AI Crew Scheduler" description="Feasible, balanced driver and conductor rosters" statuses={['scenario', 'proposed']} />
        <PanelLoading rows={8} label="Reading the depot's duties and crew" />
      </div>
    );
  }
  const drivers = pool.filter((s) => s.role === 'driver');
  const conductors = pool.filter((s) => s.role === 'conductor');
  const m = roster?.metrics;

  return (
    <div className="space-y-4" data-testid="os-crew-scheduler">
      <OsHeader
        title="AI Crew Scheduler"
        description="Feasible, balanced driver and conductor rosters"
        statuses={['scenario', 'proposed']}
        actions={
          <button type="button" onClick={() => void generate()} disabled={runner.running} className="os-cta" data-testid="os-generate-crew">
            <Sparkles className={`h-4 w-4 ${runner.running ? 'animate-pulse' : ''}`} aria-hidden />
            {runner.running ? 'Rostering…' : result ? 'Regenerate optimal crew roster' : 'Generate optimal crew roster'}
          </button>
        }
      />

      <MetricStrip columns={8}>
        <Metric label="Drivers available" value={count(drivers.filter((s) => s.available).length)} sub={`of ${count(drivers.length)} on the roster`} />
        <Metric label="Conductors available" value={count(conductors.filter((s) => s.available).length)} sub={`of ${count(conductors.length)} on the roster`} />
        <Metric label="Shifts covered" value={m ? `${count(m.covered)}/${count(m.shifts)}` : '—'} tone="teal" sub={m ? `${count(m.uncovered)} unassigned` : 'Generate to roster'} />
        <Metric label="Overtime" value={m ? `${m.overtimeHours.toFixed(1)} h` : '—'} tone={m && m.overtimeHours > 0 ? 'amber' : undefined} />
        <Metric label="Break violations" value={m ? count(m.restViolations) : '—'} tone={m && m.restViolations > 0 ? 'crimson' : 'green'} />
        <Metric label="Endorsement breaches" value={m ? count(m.qualificationViolations) : '—'} tone={m && m.qualificationViolations > 0 ? 'crimson' : 'green'} />
        <Metric label="Crew utilisation" value={m ? pct(m.utilisation) : '—'} sub="Hours over the daily limit" />
        <Metric label="Reserve crew" value={m ? `${count(m.reserve.driver)} · ${count(m.reserve.conductor)}` : '—'} sub="Drivers · conductors" />
      </MetricStrip>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)] min-[1760px]:grid-cols-[300px_minmax(0,1fr)_360px]">
        <div ref={paramsRef} className="flex min-w-0 flex-col gap-4 rounded-md transition-shadow">
          <Panel kicker="Availability and constraints" title={name} actions={<StatusTag status="scenario" />} bodyClassName="p-0">
            <div className="border-b border-holo-glow/[0.08] px-4 py-3">
              <DepotDateFields depotId={depotId} dates={input.dates} date={input.timetable.operatingDate} onDate={setDate} />
            </div>
            <FieldGroup title="Required duties">
              <SelectField<Source>
                label="Duties from"
                value={source}
                onChange={setSource}
                options={[
                  { key: 'optimised', label: busLabel },
                  { key: 'original', label: 'Original plan (buses fixed to routes)' },
                ]}
                hint="A bus's day becomes crew shifts: a gap of two hours releases the crew, and a longer day is relieved at a terminal."
              />
            </FieldGroup>
            <FieldGroup title="Crew availability">
              <dl>
                {absence.map(([label, n]) => (
                  <Fact key={label} label={label} value={count(n)} />
                ))}
              </dl>
              <RangeField label="Further drivers unavailable" value={params.extraUnavailable.driver} min={0} max={40} step={1} format={(v) => `${v}`} onChange={(v) => set('extraUnavailable', { ...params.extraUnavailable, driver: v })} />
              <RangeField label="Further conductors unavailable" value={params.extraUnavailable.conductor} min={0} max={40} step={1} format={(v) => `${v}`} onChange={(v) => set('extraUnavailable', { ...params.extraUnavailable, conductor: v })} />
            </FieldGroup>
            <FieldGroup title="Shift rules">
              <RangeField label="Maximum duty hours" value={params.maxDutyHours} {...PARAM_BOUNDS.maxDutyHours} format={(v) => `${v} h`} onChange={(v) => set('maxDutyHours', v)} />
              <RangeField label="Minimum break between shifts" value={params.minBreakMin} {...PARAM_BOUNDS.minBreakMin} format={(v) => `${v} min`} onChange={(v) => set('minBreakMin', v)} />
              <RangeField label="Overtime allowance" value={params.overtimeHours} {...PARAM_BOUNDS.overtimeHours} format={(v) => `${v} h`} onChange={(v) => set('overtimeHours', v)} />
              <ToggleField label="AC coaches need an endorsed driver" checked={params.requireAcEndorsement} onChange={(v) => set('requireAcEndorsement', v)} />
              <SelectField<CrewObjective> label="Objective" value={params.objective} onChange={(v) => set('objective', v)} options={OBJECTIVES.map((o) => ({ key: o, label: CREW_OBJECTIVE_LABEL[o] }))} />
            </FieldGroup>
            <div className="flex gap-2 px-4 py-3">
              <button type="button" onClick={() => setParams(DEFAULT_CREW_PARAMS)} className="os-button os-button-quiet flex-1">
                Reset
              </button>
              <button type="button" onClick={() => void generate()} disabled={runner.running} className="os-button os-button-solid flex-1">
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Regenerate
              </button>
            </div>
          </Panel>
          <SavedScenarios
            kind="crew"
            depotId={depotId}
            onLoad={(s) => {
              if (s.crewParams) setParams(s.crewParams);
              setDate(s.date);
              note(`Loaded "${s.label}". Generate to roster it on today's crew.`);
            }}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Panel kicker="Crew scheduling timeline" title={!result ? 'Generate to see the roster' : showBaseline ? 'First-free-slot roster (baseline)' : `Optimised: ${CREW_OBJECTIVE_LABEL[result.params.objective]}`} strong bodyClassName="p-0" actions={<StatusTag status={showBaseline || !result ? 'scenario' : 'proposed'} />}>
            <div className="flex flex-wrap items-center gap-2 border-b border-holo-glow/10 px-3 py-2">
              <LocalTabs<View>
                label="Rows"
                value={view}
                onChange={(v) => {
                  setView(v);
                  setSelected(null);
                }}
                items={[
                  { key: 'duties', label: 'Duties' },
                  { key: 'driver', label: 'Drivers' },
                  { key: 'conductor', label: 'Conductors' },
                  { key: 'review', label: 'Review assignments' },
                ]}
              />
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                {result ? (
                  <button type="button" onClick={() => setShowBaseline((v) => !v)} className="os-button os-button-quiet" aria-pressed={showBaseline}>
                    <GitCompare className="h-3.5 w-3.5" aria-hidden />
                    {showBaseline ? 'Show optimised' : 'Show baseline'}
                  </button>
                ) : null}
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
                    if (!result) return;
                    save({ kind: 'crew', depotId, depotName: name, date: input.timetable!.operatingDate, label: `${CREW_OBJECTIVE_LABEL[result.params.objective]} · ${result.roster.metrics.covered}/${result.roster.metrics.shifts} shifts`, busParams, crewParams: result.params, figures: { covered: result.roster.metrics.covered, overtime: Math.round(result.roster.metrics.overtimeHours) } });
                    note('Scenario saved in this browser.');
                  }}
                  className="os-button os-button-quiet"
                >
                  <Save className="h-3.5 w-3.5" aria-hidden />
                  Save scenario
                </button>
                <button
                  type="button"
                  disabled={!roster}
                  onClick={() =>
                    roster &&
                    downloadCsv(
                      `${name.replace(/\W+/g, '-').toLowerCase()}-crew-roster-${input.timetable!.operatingDate}.csv`,
                      ['Bus', 'Shift starts', 'Shift ends', 'Driver slot', 'Conductor slot', 'Overtime min', 'Issues'],
                      roster.assignments.map((a) => [a.shift.registration, clock(a.shift.start), clock(a.shift.end), a.driver ?? 'Unassigned', a.conductor ?? 'Unassigned', Math.round(a.overtimeMin), a.issues.map((i) => i.text).join(' ')]),
                    )
                  }
                  className="os-button os-button-quiet"
                >
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
            {stale ? <p className="border-b border-alert-amber/30 bg-alert-amber/[0.06] px-4 py-1.5 font-sans text-[12px] text-alert-amber" role="status">The rules have changed since this roster was made. Regenerate to apply them.</p> : null}
            {!roster ? (
              <EmptyNote>Generate the optimal crew roster: every shift of the bus plan gets a driver and a conductor slot where the rules allow, and the rest are listed with the reason.</EmptyNote>
            ) : view === 'review' ? (
              <div className="os-scroll max-h-[560px] overflow-auto">
                <table className="os-table">
                  <thead>
                    <tr>
                      <th>Bus</th>
                      <th>Shift</th>
                      <th>Driver</th>
                      <th>Conductor</th>
                      <th className="text-right">Overtime</th>
                      <th>Check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.assignments.map((a) => (
                      <tr key={a.shift.id} className={`os-row ${selected?.bar === a.shift.id ? 'os-row-selected' : ''}`} onClick={() => setSelected({ bar: a.shift.id, row: a.shift.registration })}>
                        <td className="font-mono">{a.shift.registration}</td>
                        <td className="font-mono">
                          {clock(a.shift.start)}–{clock(a.shift.end)}
                        </td>
                        <td className="font-mono">{a.driver ?? <span className="text-alert-crimson">None</span>}</td>
                        <td className="font-mono">{a.conductor ?? <span className="text-alert-crimson">None</span>}</td>
                        <td className="os-num">{a.overtimeMin > 0 ? `${Math.round(a.overtimeMin)} min` : '—'}</td>
                        <td className="text-[11.5px]">{a.issues.length > 0 ? <span className="text-alert-crimson">{a.issues.length} issue{a.issues.length === 1 ? '' : 's'}</span> : <span className="text-holo-teal">Within the rules</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="os-view-swap" key={`${view}-${showBaseline}`}>
                <Gantt rows={rows} selectedId={selected?.bar ?? null} onSelect={(bar, row) => setSelected({ bar, row })} ariaLabel="Crew roster: each row a slot or a duty, each bar a shift" maxHeight={560} labelWidth={view === 'duties' ? 168 : 120} />
              </div>
            )}
            <div className="border-t border-holo-glow/10 px-4 py-2.5">
              <GanttLegend
                items={[
                  { tone: 'teal', label: 'Shift within the rules' },
                  { tone: 'violet', label: 'AC coach shift' },
                  { tone: 'amber', label: 'Overtime' },
                  { tone: 'crimson', label: 'Rule breach or unassigned', hatched: true },
                ]}
              />
            </div>
          </Panel>
          {result ? (
            <Panel kicker="Before vs after" title="First-free-slot roster against the optimised roster" bodyClassName="p-0">
              <CompareTable rows={compareRows(result.baseline, result.roster)} beforeLabel="Baseline" afterLabel="Optimised" />
            </Panel>
          ) : null}
        </div>

        <div className="grid min-w-0 grid-cols-1 content-start gap-4 xl:col-span-2 xl:grid-cols-2 min-[1760px]:col-span-1 min-[1760px]:grid-cols-1">
          <Panel kicker="AI scheduling insights" title={result ? 'Roster ready for review' : 'Ready to roster'} strong bodyClassName="space-y-4 p-4" actions={<AiKindChip kind="optimize" />}>
            <WorkingSteps steps={runner.steps} totalMs={runner.totalMs} />
            {result ? (
              <>
                <section>
                  <h3 className="os-kicker mb-1">Scheduling conflicts in the baseline</h3>
                  {result.baseline.assignments.flatMap((a) => a.issues).length === 0 ? (
                    <p className="depot-note">None.</p>
                  ) : (
                    <ul className="os-scroll max-h-32 space-y-1 overflow-y-auto">
                      {result.baseline.assignments
                        .flatMap((a) => a.issues)
                        .slice(0, 30)
                        .map((c, i) => (
                          <li key={`${c.subject}-${i}`} className="flex gap-2 font-sans text-[12px] text-depot-prose">
                            <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-alert-crimson" aria-hidden />
                            {c.text}
                          </li>
                        ))}
                    </ul>
                  )}
                </section>
                <section>
                  <h3 className="os-kicker mb-1">Unassigned shifts</h3>
                  {result.roster.metrics.uncovered === 0 ? (
                    <p className="depot-note">Every shift has a driver and a conductor within the rules.</p>
                  ) : (
                    <p className="font-sans text-[12.5px] text-alert-crimson">
                      {count(result.roster.metrics.uncovered)} shifts have no crew within the rules. Mark fewer slots unavailable, allow more overtime, or plan buses and crew together in the Joint Fleet &amp; Crew Optimizer.
                    </p>
                  )}
                </section>
                <section className="rounded-[4px] border border-holo-teal/25 bg-holo-teal/[0.05] p-3">
                  <h3 className="os-kicker mb-1 text-holo-teal">Recommendation</h3>
                  <p className="font-sans text-[12.5px] leading-5 text-depot-ink">
                    Adopt the optimised roster: {count(result.roster.metrics.covered)} of {count(result.roster.metrics.shifts)} shifts crewed with{' '}
                    {result.roster.metrics.overtimeHours.toFixed(1)} overtime hours against {result.baseline.metrics.overtimeHours.toFixed(1)}, and none of the baseline&apos;s{' '}
                    {count(result.baseline.metrics.restViolations + result.baseline.metrics.qualificationViolations)} rule breaches. {count(result.roster.metrics.reserve.driver)} drivers stay in reserve.
                  </p>
                </section>
                <section className="border-t border-holo-glow/10 pt-3">
                  <h3 className="os-kicker mb-1">Manager review</h3>
                  {review ? (
                    <p className="flex items-center gap-1.5 font-sans text-[12px] text-holo-teal">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                      {review.action === 'approved' ? 'Approved for the duty roster' : 'Deferred'} {new Date(review.at).toLocaleTimeString('en-IN', { timeStyle: 'short' })}. Recorded in this browser; no one has been notified.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="os-button os-button-solid" onClick={() => recordReview({ decisionId: planId, title: `${name}: crew roster`, scope: name, action: 'approved', note: `${result.roster.metrics.covered} of ${result.roster.metrics.shifts} shifts` })}>
                        Approve for the duty roster
                      </button>
                      <button type="button" className="os-button os-button-quiet" onClick={() => recordReview({ decisionId: planId, title: `${name}: crew roster`, scope: name, action: 'deferred', note: 'Deferred from the AI Crew Scheduler' })}>
                        Defer
                      </button>
                    </div>
                  )}
                </section>
              </>
            ) : runner.steps.length === 0 ? (
              <p className="depot-note">
                The baseline gives each shift the first free slot in roster order, then checks the rules. Generate to roster within the daily limit, the overtime allowance, the
                break between shifts and the AC endorsement.
              </p>
            ) : null}
          </Panel>
          <Panel kicker="Shift details" title={pick ? `${pick.shift.registration} · ${clock(pick.shift.start)}–${clock(pick.shift.end)}` : 'Select a shift'} bodyClassName="space-y-2 p-4">
            {pick ? (
              <dl>
                <Fact label="Driver slot" value={pick.driver ?? 'Unassigned'} tone={pick.driver ? undefined : 'crimson'} />
                <Fact label="Conductor slot" value={pick.conductor ?? 'Unassigned'} tone={pick.conductor ? undefined : 'crimson'} />
                <Fact label="Length" value={hours((pick.shift.end - pick.shift.start) / 60)} />
                <Fact label="Departures" value={count(pick.shift.trips.length)} />
                <Fact label="AC coach" value={pick.shift.needsAc ? 'Yes: endorsed driver' : 'No'} />
                <Fact label="Overtime" value={pick.overtimeMin > 0 ? `${Math.round(pick.overtimeMin)} min` : 'None'} tone={pick.overtimeMin > 0 ? 'amber' : undefined} />
                {pick.issues.map((i) => (
                  <Fact key={i.text} label="Rule" value={i.text} tone="crimson" />
                ))}
              </dl>
            ) : (
              <EmptyNote>Click a shift on the timeline or a row in Review assignments.</EmptyNote>
            )}
            <p className="font-sans text-[11px] text-depot-muted">Slots are anonymous roster places: no person is named, scored or judged.</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
