'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { depotHref } from '@/lib/depot/depotNav';
import { formatCount } from '@/lib/depot/format';
import { LEAGUE_PATH } from '@/lib/depot/nav';
import { DEI_COMPONENTS } from '@/lib/depot/score/config';
import { DEPOT_PALETTE, indexRampColour } from '@/lib/depot/palette';
import { useIntel } from '../IntelProvider';
import { OsHeader } from '../OsHeader';
import { useOsStore } from '../osStore';
import { EmptyNote, Fact, MeterBar, Panel, PanelLoading, StatusTag } from '../ui';

type MetricKey = 'index' | 'utilisation' | 'availability' | 'offRoad' | 'telemetry' | 'coverage' | 'fuel' | 'exposure';

interface MetricDef {
  readonly key: MetricKey;
  readonly label: string;
  readonly better: 'higher' | 'lower';
  readonly format: (n: number) => string;
  readonly status: 'live' | 'derived' | 'estimate' | 'scenario';
}

const METRICS: readonly MetricDef[] = [
  { key: 'index', label: 'Efficiency index', better: 'higher', format: (n) => n.toFixed(1), status: 'derived' },
  { key: 'utilisation', label: 'Fleet utilisation (on road)', better: 'higher', format: (n) => `${(n * 100).toFixed(0)}%`, status: 'live' },
  { key: 'availability', label: 'Vehicle availability', better: 'higher', format: (n) => `${(n * 100).toFixed(0)}%`, status: 'live' },
  { key: 'offRoad', label: 'Off-road rate', better: 'lower', format: (n) => `${(n * 100).toFixed(1)}%`, status: 'live' },
  { key: 'telemetry', label: 'Telemetry availability', better: 'higher', format: (n) => `${(n * 100).toFixed(0)}%`, status: 'live' },
  { key: 'coverage', label: 'Peak service coverage', better: 'higher', format: (n) => `${(n * 100).toFixed(0)}%`, status: 'estimate' },
  { key: 'fuel', label: 'Fuel economy, km/L', better: 'higher', format: (n) => n.toFixed(2), status: 'scenario' },
  { key: 'exposure', label: 'Fuel exposure per bus, ₹', better: 'lower', format: (n) => formatCount(Math.round(n)), status: 'scenario' },
];

interface Row {
  readonly id: string;
  readonly name: string;
  readonly fleet: number;
  readonly values: Readonly<Partial<Record<MetricKey, number>>>;
}

/**
 * Depot performance intelligence: every operating depot on one measure at a time as
 * ranked bars, two measures against each other as a scatter, and the selected depot's
 * efficiency index broken into its weighted components.
 */
export function PerformanceView() {
  const intel = useIntel();
  const openEntity = useOsStore((s) => s.openEntity);
  const [metric, setMetric] = useState<MetricKey>('index');
  const [xMetric, setXMetric] = useState<MetricKey>('utilisation');
  const [selected, setSelected] = useState<string | null>(null);

  const rows = useMemo<Row[]>(() => {
    const scores = new Map((intel.network?.scores ?? []).map((s) => [s.depotId, s]));
    const balances = new Map((intel.distribution?.balances ?? []).map((b) => [b.depotId, b]));
    const fuel = new Map<string, { km: number; l: number; rupees: number }>();
    for (const v of intel.fuel?.vehicles.values() ?? []) {
      if (!v.depotId) continue;
      const g = fuel.get(v.depotId) ?? { km: 0, l: 0, rupees: 0 };
      for (const j of v.journeys) {
        g.km += j.distanceKm;
        g.l += j.fuelLitres;
        g.rupees += j.exposureRupees;
      }
      fuel.set(v.depotId, g);
    }
    return (intel.network?.depots ?? [])
      .filter((d) => d.kind === 'depot' && d.fleet > 0 && (intel.scope === null || intel.scope.has(d.id)))
      .map((d) => {
        const s = scores.get(d.id);
        const b = balances.get(d.id);
        const f = fuel.get(d.id);
        const values: Partial<Record<MetricKey, number>> = {
          utilisation: (d.states.inService + d.states.onRoad) / d.fleet,
          availability: (d.fleet - d.states.offRoad) / d.fleet,
          offRoad: d.states.offRoad / d.fleet,
          telemetry: (d.fleet - d.states.dark) / d.fleet,
        };
        if (s?.index !== null && s?.index !== undefined) values.index = s.index;
        if (b && b.peakRequirement > 0) values.coverage = Math.min(1, b.available / b.required);
        if (f && f.l > 0) {
          values.fuel = f.km / f.l;
          values.exposure = f.rupees / d.fleet;
        }
        return { id: d.id, name: d.name, fleet: d.fleet, values };
      });
  }, [intel.network, intel.distribution, intel.fuel, intel.scope]);

  const def = METRICS.find((m) => m.key === metric)!;
  const xDef = METRICS.find((m) => m.key === xMetric)!;
  const ranked = rows
    .filter((r) => r.values[metric] !== undefined)
    .sort((a, b) => (def.better === 'higher' ? b.values[metric]! - a.values[metric]! : a.values[metric]! - b.values[metric]!));
  const maxValue = Math.max(1e-9, ...ranked.map((r) => r.values[metric]!));
  const median = ranked.length ? ranked[Math.floor(ranked.length / 2)]!.values[metric]! : 0;
  const pick = rows.find((r) => r.id === selected) ?? ranked[ranked.length - 1] ?? null;
  const score = pick ? intel.network?.scores.find((s) => s.depotId === pick.id) : undefined;

  // Scatter.
  const W = 520;
  const H = 320;
  const P = 36;
  const pts = rows.filter((r) => r.values[metric] !== undefined && r.values[xMetric] !== undefined);
  const xs = pts.map((r) => r.values[xMetric]!);
  const ys = pts.map((r) => r.values[metric]!);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sx = (v: number): number => P + ((v - x0) / (x1 - x0 || 1)) * (W - 2 * P);
  const sy = (v: number): number => H - P - ((v - y0) / (y1 - y0 || 1)) * (H - 2 * P);
  const maxFleet = Math.max(1, ...pts.map((r) => r.fleet));

  return (
    <div className="space-y-4" data-testid="os-performance">
      <OsHeader
        title="Depot performance"
        description="Every operating depot on one measure, two measures against each other, and the efficiency index broken into its parts."
        statuses={['live', 'derived', 'scenario']}
        actions={
          <>
            <select value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)} className="depot-control depot-select font-sans" aria-label="Measure">
              {METRICS.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
            <Link href={LEAGUE_PATH} className="os-button os-button-quiet">League table</Link>
          </>
        }
      />
      {!intel.network ? (
        <PanelLoading rows={6} label="Loading the depots" />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Panel kicker="Ranked" title={`${def.label} · ${formatCount(ranked.length)} depots`} actions={<StatusTag status={def.status} />} bodyClassName="p-0">
            {ranked.length === 0 ? (
              <EmptyNote>No depot has this measure yet.</EmptyNote>
            ) : (
              <ul className="os-scroll max-h-[640px] overflow-y-auto py-1">
                {ranked.map((r, i) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => setSelected(r.id)} className={`os-row grid w-full grid-cols-[2rem_minmax(0,11rem)_minmax(0,1fr)_4.5rem] items-center gap-2 px-3 py-1.5 text-left ${pick?.id === r.id ? 'os-row-selected' : ''}`}>
                      <span className="font-mono text-[11px] text-depot-muted">{i + 1}</span>
                      <span className="truncate font-sans text-[12.5px] text-depot-ink">{r.name}</span>
                      <MeterBar value={r.values[metric]!} max={maxValue} marker={median} tone={i < ranked.length / 4 ? 'green' : i >= (ranked.length * 3) / 4 ? 'crimson' : 'cyan'} />
                      <span className="text-right font-mono text-[12px] text-depot-ink">{def.format(r.values[metric]!)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <div className="flex min-w-0 flex-col gap-4">
            <Panel
              kicker="Peer comparison"
              title={`${def.label} against ${xDef.label.toLowerCase()}`}
              actions={
                <select value={xMetric} onChange={(e) => setXMetric(e.target.value as MetricKey)} className="depot-control depot-select h-7 font-sans" aria-label="Horizontal measure">
                  {METRICS.filter((m) => m.key !== metric).map((m) => (
                    <option key={m.key} value={m.key}>{m.label}</option>
                  ))}
                </select>
              }
              bodyClassName="p-3"
            >
              <svg viewBox={`0 0 ${W} ${H}`} className="h-[320px] w-full" role="img" aria-label="Scatter of depots">
                <line x1={P} x2={W - P} y1={H - P} y2={H - P} stroke={DEPOT_PALETTE.line} />
                <line x1={P} x2={P} y1={P} y2={H - P} stroke={DEPOT_PALETTE.line} />
                <text x={W - P} y={H - 10} textAnchor="end" fontSize={10.5} fill={DEPOT_PALETTE.label} fontFamily="var(--font-sans)">{xDef.label} →</text>
                <text x={P} y={P - 12} fontSize={10.5} fill={DEPOT_PALETTE.label} fontFamily="var(--font-sans)">↑ {def.label}</text>
                {pts.map((r) => {
                  const selectedPoint = pick?.id === r.id;
                  return (
                    <circle
                      key={r.id}
                      cx={sx(r.values[xMetric]!)}
                      cy={sy(r.values[metric]!)}
                      r={3 + 7 * Math.sqrt(r.fleet / maxFleet)}
                      fill={r.values.index !== undefined ? indexRampColour(r.values.index) : DEPOT_PALETTE.slate}
                      fillOpacity={selectedPoint ? 0.95 : 0.55}
                      stroke={selectedPoint ? DEPOT_PALETTE.ink : 'none'}
                      strokeWidth={2}
                      className="cursor-pointer"
                      onClick={() => setSelected(r.id)}
                    >
                      <title>{`${r.name}: ${def.format(r.values[metric]!)} · ${xDef.format(r.values[xMetric]!)}`}</title>
                    </circle>
                  );
                })}
              </svg>
              <p className="depot-caption">Size: fleet. Colour: efficiency index, crimson to green.</p>
            </Panel>
            <Panel kicker="Index breakdown" title={pick ? pick.name : 'Select a depot'} bodyClassName="space-y-3 p-4" actions={<StatusTag status="derived" />}>
              {!pick ? (
                <EmptyNote>Select a depot.</EmptyNote>
              ) : (
                <>
                  <dl>
                    {METRICS.map((m) => (
                      <Fact key={m.key} label={m.label} value={pick.values[m.key] === undefined ? '—' : m.format(pick.values[m.key]!)} />
                    ))}
                  </dl>
                  {score && score.ranked ? (
                    <div>
                      <div className="os-kicker mb-1">Efficiency index components (contribution, z against peers)</div>
                      <ul className="space-y-1">
                        {score.components.map((c) => {
                          const cfg = DEI_COMPONENTS.find((x) => x.key === c.key);
                          return (
                            <li key={c.key} className="grid grid-cols-[9rem_minmax(0,1fr)_4rem] items-center gap-2 font-sans text-[12px] text-depot-prose">
                              <span>{cfg?.label ?? c.key} · {Math.round((cfg?.weight ?? 0) * 100)}%</span>
                              <MeterBar value={Math.abs(c.contribution)} max={1} tone={c.contribution >= 0 ? 'green' : 'crimson'} />
                              <span className={`text-right font-mono ${c.contribution >= 0 ? 'text-alert-green' : 'text-alert-crimson'}`}>{c.contribution >= 0 ? '+' : ''}{c.contribution.toFixed(2)}</span>
                            </li>
                          );
                        })}
                      </ul>
                      <p className="depot-caption mt-1">Rank {score.rank} of {score.peerCount} in its peer group; the index is relative to peers of similar fleet size.</p>
                    </div>
                  ) : (
                    <p className="depot-note">This depot is not ranked in a peer group.</p>
                  )}
                  <div className="flex gap-2">
                    <Link href={depotHref(pick.id)} className="os-button">Mission Control</Link>
                    <button type="button" onClick={() => openEntity({ kind: 'depot', id: pick.id })} className="os-button os-button-quiet">Profile</button>
                  </div>
                </>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
