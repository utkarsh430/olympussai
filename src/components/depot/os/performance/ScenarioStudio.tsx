'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, FlaskConical, RotateCcw } from 'lucide-react';
import { formatCount } from '@/lib/depot/format';
import { AUDIT_DAYS } from '@/lib/depot/os/intel/fuelAudit';
import { BASE_LEVERS, runStudio, type Levers, type StudioMetrics } from '@/lib/depot/os/intel/scenario';
import { isValidDepotId } from '@/lib/depot/ids';
import { useIntel } from '../IntelProvider';
import { OsHeader } from '../OsHeader';
import { useOsStore, useReviewFor } from '../osStore';
import { EmptyNote, Panel, PanelLoading, StatusTag } from '../ui';

interface Preset {
  readonly label: string;
  readonly levers: Partial<Levers>;
}

const PRESETS: readonly Preset[] = [
  { label: 'Festival demand +10%', levers: { demandPct: 10 } },
  { label: '15 buses unavailable', levers: { unavailable: 15 } },
  { label: 'Driver shortage 8%', levers: { driverShortagePct: 8 } },
  { label: 'Workshop backlog 5%', levers: { maintenanceBacklogPct: 5 } },
  { label: 'Diesel +₹6', levers: { dieselPrice: BASE_LEVERS.dieselPrice + 6 } },
  { label: '40 spare buses hired', levers: { addedBuses: 40 } },
  { label: 'No inter-depot transfers', levers: { transfers: false } },
];

const ROWS: readonly { key: keyof StudioMetrics; label: string; better: 'lower' | 'higher'; format: (n: number) => string }[] = [
  { key: 'shortageBefore', label: 'Peak shortage before transfers', better: 'lower', format: formatCount },
  { key: 'shortage', label: 'Peak shortage after transfers', better: 'lower', format: formatCount },
  { key: 'depotsShort', label: 'Depots still short', better: 'lower', format: formatCount },
  { key: 'coverage', label: 'Peak demand coverage', better: 'higher', format: (n) => `${(n * 100).toFixed(1)}%` },
  { key: 'uncoveredBusHours', label: 'Uncovered peak bus-hours', better: 'lower', format: formatCount },
  { key: 'utilisation', label: 'Fleet utilisation at peak', better: 'lower', format: (n) => `${Math.round(n * 100)}%` },
  { key: 'transfers', label: 'Transfers', better: 'lower', format: formatCount },
  { key: 'busesMoved', label: 'Buses repositioned', better: 'lower', format: formatCount },
  { key: 'emptyBusKm', label: 'Empty repositioning bus-km', better: 'lower', format: formatCount },
  { key: 'repositioningCost', label: 'Repositioning diesel, ₹', better: 'lower', format: formatCount },
  { key: 'dailyFuelCost', label: 'Daily fleet diesel, ₹', better: 'lower', format: formatCount },
];

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly unit?: string;
  readonly onChange: (n: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex justify-between font-sans text-[12px] text-depot-prose">
        <span>{label}</span>
        <span className="font-mono text-depot-ink">
          {value > 0 && unit === '%' ? '+' : ''}
          {value}
          {unit}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-holo-glow" aria-label={label} />
    </label>
  );
}

/**
 * The Scenario Studio: change demand, fleet, crew, workshop, diesel and the transfer
 * rules, and see the redistribution re-planned against the same balances as the baseline,
 * metric by metric, depot by depot, with the operational summary and its actions.
 */
export function ScenarioStudio() {
  const intel = useIntel();
  const params = useSearchParams();
  const recordReview = useOsStore((s) => s.recordReview);
  const initial = useMemo<Levers>(() => {
    const n = Number(params?.get('unavailable'));
    const depot = params?.get('depot') ?? null;
    return {
      ...BASE_LEVERS,
      unavailable: Number.isFinite(n) && n > 0 && n <= 500 ? Math.round(n) : 0,
      depotId: depot && isValidDepotId(depot) ? depot : null,
    };
  }, [params]);
  const [levers, setLevers] = useState<Levers>(initial);
  const set = (patch: Partial<Levers>): void => setLevers((l) => ({ ...l, ...patch }));
  const dailyLitres = intel.fuel ? intel.fuel.summary.fuelLitres / AUDIT_DAYS : null;
  const result = useMemo(
    () => (intel.distribution ? runStudio(intel.distribution.balances, levers, dailyLitres) : null),
    [intel.distribution, levers, dailyLitres],
  );
  const changed = JSON.stringify(levers) !== JSON.stringify({ ...BASE_LEVERS, depotId: levers.depotId });
  const depots = useMemo(
    () => (intel.distribution?.balances ?? []).filter((b) => b.kind === 'depot').sort((a, b) => a.depotName.localeCompare(b.depotName, 'en')),
    [intel.distribution],
  );
  const reviewId = `scenario:${JSON.stringify(levers)}`;
  const review = useReviewFor(reviewId);

  const impacts = useMemo(() => {
    if (!result) return [];
    const base = new Map(result.baseOutcome.balances.map((b) => [b.depotId, b]));
    const inbound = new Map<string, number>();
    if (levers.transfers) for (const t of result.outcome.plan.transfers) inbound.set(t.toDepotId, (inbound.get(t.toDepotId) ?? 0) + t.buses);
    return result.outcome.balances
      .filter((b) => b.kind === 'depot')
      .map((b) => ({ b, before: base.get(b.depotId)?.balance ?? 0, inbound: inbound.get(b.depotId) ?? 0 }))
      .filter((x) => x.b.balance !== x.before || x.b.balance < 0)
      .sort((a, b) => a.b.balance + a.inbound - (b.b.balance + b.inbound))
      .slice(0, 14);
  }, [result, levers.transfers]);

  return (
    <div className="space-y-4" data-testid="os-scenario-studio">
      <OsHeader
        title="Scenario Studio"
        description="Change demand, fleet, crew, workshop and diesel; the inter-depot plan is re-optimised on the same balances as today's."
        statuses={['scenario', 'estimate', 'proposed']}
      />
      {!result ? (
        <PanelLoading rows={6} label="Loading the depot balances" />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
          <Panel
            kicker="Levers"
            title="Scenario"
            actions={
              <button type="button" onClick={() => setLevers({ ...BASE_LEVERS })} className="os-button os-button-quiet py-1 text-[11.5px]">
                <RotateCcw className="h-3 w-3" aria-hidden />
                Baseline
              </button>
            }
            bodyClassName="space-y-4 p-4"
          >
            <div>
              <div className="os-kicker mb-1.5">Presets</div>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button key={p.label} type="button" onClick={() => setLevers({ ...BASE_LEVERS, depotId: levers.depotId, ...p.levers })} className="rounded-full border border-holo-glow/20 px-2.5 py-1 font-sans text-[11.5px] text-depot-prose hover:border-holo-glow/50 hover:text-depot-ink">
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="block">
              <span className="mb-1 block font-sans text-[12px] text-depot-prose">Apply fleet and demand levers to</span>
              <select value={levers.depotId ?? ''} onChange={(e) => set({ depotId: e.target.value || null })} className="depot-control depot-select w-full font-sans" aria-label="Scope of the levers">
                <option value="">The whole network, by fleet share</option>
                {depots.map((d) => (
                  <option key={d.depotId} value={d.depotId}>
                    {d.depotName}
                  </option>
                ))}
              </select>
            </label>
            <Slider label="Passenger demand" value={levers.demandPct} min={-20} max={30} unit="%" onChange={(n) => set({ demandPct: n })} />
            <Slider label="Buses unavailable" value={levers.unavailable} min={0} max={200} onChange={(n) => set({ unavailable: n })} />
            <Slider label="Spare buses added" value={levers.addedBuses} min={0} max={200} onChange={(n) => set({ addedBuses: n })} />
            <Slider label="Driver shortage" value={levers.driverShortagePct} min={0} max={20} unit="%" onChange={(n) => set({ driverShortagePct: n })} />
            <Slider label="Workshop backlog" value={levers.maintenanceBacklogPct} min={0} max={15} unit="%" onChange={(n) => set({ maintenanceBacklogPct: n })} />
            <Slider label="Diesel price, ₹/L" value={levers.dieselPrice} min={80} max={115} onChange={(n) => set({ dieselPrice: n })} />
            <Slider label="Spare target, % of peak" value={Math.round(levers.spareRatio * 100)} min={0} max={30} onChange={(n) => set({ spareRatio: n / 100 })} />
            <Slider label="Transfer limit, km" value={levers.maxTransferKm} min={25} max={600} step={25} onChange={(n) => set({ maxTransferKm: n })} />
            <label className="flex items-center gap-2 font-sans text-[12.5px] text-depot-ink">
              <input type="checkbox" className="depot-checkbox" checked={levers.transfers} onChange={(e) => set({ transfers: e.target.checked })} />
              Allow inter-depot transfers
            </label>
            <p className="depot-caption">
              Driver shortage and workshop backlog take that share of the fleet out: a bus without a driver or still in the bay cannot run. Uncovered bus-hours count the
              four peak hours per bus short.
            </p>
          </Panel>

          <div className="flex min-w-0 flex-col gap-4">
            <Panel kicker="Comparison" title={changed ? 'Baseline against the scenario' : 'Baseline (move a lever to compare)'} actions={<StatusTag status="scenario" />} bodyClassName="p-0">
              <table className="os-table">
                <thead>
                  <tr>
                    <th>Measure</th>
                    <th className="text-right">Baseline</th>
                    <th className="text-right">Scenario</th>
                    <th className="text-right">Change</th>
                    <th className="w-[28%]">Shift</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row) => {
                    const a = result.baseline[row.key] as number | null;
                    const b = result.scenario[row.key] as number | null;
                    if (a === null || b === null) {
                      return (
                        <tr key={row.key} className="border-b border-holo-glow/[0.07]">
                          <td>{row.label}</td>
                          <td className="os-num text-depot-muted" colSpan={4}>Waiting for the fuel audit</td>
                        </tr>
                      );
                    }
                    const delta = b - a;
                    const good = delta === 0 ? null : row.better === 'lower' ? delta < 0 : delta > 0;
                    const max = Math.max(Math.abs(a), Math.abs(b), 1e-9);
                    return (
                      <tr key={row.key} className="border-b border-holo-glow/[0.07]">
                        <td>{row.label}</td>
                        <td className="os-num text-depot-prose">{row.format(a)}</td>
                        <td className="os-num font-semibold">{row.format(b)}</td>
                        <td className={`os-num ${good === null ? 'text-depot-muted' : good ? 'text-alert-green' : 'text-alert-crimson'}`}>
                          {delta === 0 ? '—' : `${delta > 0 ? '+' : ''}${row.key === 'coverage' ? `${(delta * 100).toFixed(1)} pt` : row.key === 'utilisation' ? `${Math.round(delta * 100)} pt` : formatCount(Math.round(delta))}`}
                        </td>
                        <td>
                          <div className="space-y-0.5">
                            <div className="h-1.5 rounded-full bg-slate-500/50" style={{ width: `${(Math.abs(a) / max) * 100}%` }} />
                            <div className={`h-1.5 rounded-full ${good === false ? 'bg-alert-crimson' : 'bg-holo-teal'}`} style={{ width: `${(Math.abs(b) / max) * 100}%` }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Panel>

            <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
              <Panel kicker="AI operational summary" title="What changes, and what to do" strong bodyClassName="space-y-3 p-4" actions={<FlaskConical className="h-4 w-4 text-holo-glow" aria-hidden />}>
                {result.summary.map((line) => (
                  <p key={line} className="depot-note">
                    {line}
                  </p>
                ))}
                <div>
                  <div className="os-kicker mb-1">Recommended actions</div>
                  <ul className="space-y-1">
                    {result.actions.map((a) => (
                      <li key={a} className="flex gap-2 font-sans text-[12.5px] text-depot-ink">
                        <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-holo-teal" aria-hidden />
                        {a}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="os-kicker mb-1">Constraints that bind</div>
                  {result.constraints.length === 0 ? (
                    <p className="depot-note">None: every deficit in range is covered.</p>
                  ) : (
                    <ul className="space-y-0.5">
                      {result.constraints.map((c) => (
                        <li key={c} className="font-sans text-[12px] text-depot-prose">
                          {c}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="border-t border-holo-glow/10 pt-3">
                  {review ? (
                    <p className="flex items-center gap-1.5 font-sans text-[12px] text-holo-teal">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                      Saved to the decision trail.
                    </p>
                  ) : (
                    <button
                      type="button"
                      disabled={!changed}
                      onClick={() =>
                        recordReview({
                          decisionId: reviewId,
                          title: `Scenario: ${result.summary[0]}`,
                          scope: levers.depotId ? (depots.find((d) => d.depotId === levers.depotId)?.depotName ?? levers.depotId) : 'Network',
                          action: 'deferred',
                          note: result.actions[0] ?? '',
                        })
                      }
                      className="os-button"
                    >
                      Save the scenario to the decision trail
                    </button>
                  )}
                </div>
              </Panel>

              <Panel kicker="Depot impact" title="Balance at peak, baseline → scenario" bodyClassName="p-0">
                {impacts.length === 0 ? (
                  <EmptyNote>No depot changes balance in this scenario.</EmptyNote>
                ) : (
                  <div className="os-scroll max-h-[420px] overflow-auto">
                    <table className="os-table">
                      <thead>
                        <tr>
                          <th>Depot</th>
                          <th className="text-right">Baseline</th>
                          <th className="text-right">Scenario</th>
                          <th className="text-right">Transfers in</th>
                        </tr>
                      </thead>
                      <tbody>
                        {impacts.map(({ b, before, inbound }) => (
                          <tr key={b.depotId} className="border-b border-holo-glow/[0.07]">
                            <td className="max-w-[12rem] truncate">{b.depotName}</td>
                            <td className={`os-num ${before < 0 ? 'text-alert-crimson' : 'text-depot-prose'}`}>{before > 0 ? '+' : ''}{formatCount(before)}</td>
                            <td className={`os-num font-semibold ${b.balance < 0 ? 'text-alert-crimson' : 'text-alert-green'}`}>{b.balance > 0 ? '+' : ''}{formatCount(b.balance)}</td>
                            <td className="os-num text-holo-teal">{inbound > 0 ? `+${formatCount(inbound)}` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
