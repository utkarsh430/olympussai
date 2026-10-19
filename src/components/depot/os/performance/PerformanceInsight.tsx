'use client';

import { formatCount } from '@/lib/depot/format';
import { DEPOT_PALETTE } from '@/lib/depot/palette';
import { AiKindChip } from '../aiKinds';
import { EmptyNote, Panel } from '../ui';

/*
 * Two readings of depot performance beyond the ranking: one depot's profile as its
 * percentile on every measure against the peer median, and the improvement
 * opportunities where a depot sits furthest below the median, sized in buses or rupees.
 */

export interface PerfMetric {
  readonly key: string;
  readonly label: string;
  /** One word for a chart axis. */
  readonly short: string;
  readonly better: 'higher' | 'lower';
}

export interface PerfRow {
  readonly id: string;
  readonly name: string;
  readonly fleet: number;
  readonly values: Readonly<Record<string, number | undefined>>;
}

/** Percentile of each depot on each measure, 1 best, among depots that have the measure. */
export function percentiles(rows: readonly PerfRow[], metrics: readonly PerfMetric[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>(rows.map((r) => [r.id, new Map()]));
  for (const m of metrics) {
    const have = rows.filter((r) => r.values[m.key] !== undefined).sort((a, b) => (m.better === 'higher' ? a.values[m.key]! - b.values[m.key]! : b.values[m.key]! - a.values[m.key]!));
    have.forEach((r, i) => out.get(r.id)!.set(m.key, have.length > 1 ? i / (have.length - 1) : 0.5));
  }
  return out;
}

const SIZE = 300;
const R = 112;

/** The selected depot's percentiles as a radar, with the median ring. */
export function ProfileRadar({ name, metrics, ranks }: { readonly name: string; readonly metrics: readonly PerfMetric[]; readonly ranks: ReadonlyMap<string, number> | undefined }) {
  const axes = metrics.filter((m) => ranks?.has(m.key));
  if (!ranks || axes.length < 3) {
    return (
      <Panel kicker="Depot profile" title={name}>
        <EmptyNote>Too few measures for a profile yet.</EmptyNote>
      </Panel>
    );
  }
  const c = SIZE / 2;
  const point = (i: number, v: number): [number, number] => {
    const a = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
    return [c + Math.cos(a) * R * v, c + Math.sin(a) * R * v];
  };
  const poly = axes.map((m, i) => point(i, Math.max(0.04, ranks.get(m.key) ?? 0)).join(',')).join(' ');
  const median = axes.map((_, i) => point(i, 0.5).join(',')).join(' ');
  return (
    <Panel kicker="Depot profile · percentile among depots" title={name} bodyClassName="p-3" actions={<AiKindChip kind="monitor" />}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mx-auto h-[300px] w-full max-w-[360px]" role="img" aria-label={`${name}'s percentile on each measure`}>
        {[0.25, 0.5, 0.75, 1].map((ring) => (
          <polygon key={ring} points={axes.map((_, i) => point(i, ring).join(',')).join(' ')} fill="none" stroke={DEPOT_PALETTE.line} strokeWidth={ring === 1 ? 1 : 0.6} />
        ))}
        {axes.map((m, i) => {
          const [x, y] = point(i, 1);
          const [lx, ly] = point(i, 1.2);
          return (
            <g key={m.key}>
              <line x1={c} y1={c} x2={x} y2={y} stroke={DEPOT_PALETTE.line} strokeWidth={0.6} />
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize={9.5} fill={DEPOT_PALETTE.label} fontFamily="var(--font-sans)">
                {m.short}
              </text>
            </g>
          );
        })}
        <polygon points={median} fill="none" stroke={DEPOT_PALETTE.slate} strokeDasharray="3 3" strokeWidth={1} />
        <polygon points={poly} fill={DEPOT_PALETTE.glow} fillOpacity={0.18} stroke={DEPOT_PALETTE.glow} strokeWidth={1.6} />
        {axes.map((m, i) => {
          const [x, y] = point(i, Math.max(0.04, ranks.get(m.key) ?? 0));
          return (
            <circle key={m.key} cx={x} cy={y} r={3} fill={(ranks.get(m.key) ?? 0) >= 0.5 ? DEPOT_PALETTE.teal : DEPOT_PALETTE.amber}>
              <title>{`${m.label}: better than ${Math.round((ranks.get(m.key) ?? 0) * 100)}% of depots`}</title>
            </circle>
          );
        })}
      </svg>
      <p className="depot-caption text-center">Outer ring: best depot. Dashed ring: the median. Amber points sit below it.</p>
    </Panel>
  );
}

export interface Opportunity {
  readonly id: string;
  readonly name: string;
  readonly measure: string;
  readonly value: string;
  readonly median: string;
  /** What closing the gap to the median is worth, in plain words. */
  readonly worth: string;
  /** For ranking: buses, or rupees divided by a day of one bus. */
  readonly size: number;
}

/** A day of one bus in rupees, to rank fuel exposure against buses. */
const RUPEES_PER_BUS_DAY = 9_000;

export function opportunities(rows: readonly PerfRow[]): Opportunity[] {
  const med = (key: string): number | null => {
    const v = rows.flatMap((r) => (r.values[key] === undefined ? [] : [r.values[key]!])).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)]! : null;
  };
  const m = { offRoad: med('offRoad'), utilisation: med('utilisation'), telemetry: med('telemetry'), exposure: med('exposure') };
  const out: Opportunity[] = [];
  const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
  for (const r of rows) {
    const v = r.values;
    if (m.offRoad !== null && v.offRoad !== undefined && v.offRoad > m.offRoad) {
      const buses = Math.round((v.offRoad - m.offRoad) * r.fleet);
      if (buses >= 2) out.push({ id: r.id, name: r.name, measure: 'Off-road rate', value: pct(v.offRoad), median: pct(m.offRoad), worth: `${formatCount(buses)} buses back on the road at the median rate`, size: buses });
    }
    if (m.telemetry !== null && v.telemetry !== undefined && v.telemetry < m.telemetry) {
      const buses = Math.round((m.telemetry - v.telemetry) * r.fleet);
      if (buses >= 3) out.push({ id: r.id, name: r.name, measure: 'Telemetry availability', value: pct(v.telemetry), median: pct(m.telemetry), worth: `${formatCount(buses)} more buses observed in the feed`, size: buses * 0.5 });
    }
    if (m.exposure !== null && v.exposure !== undefined && v.exposure > m.exposure) {
      const rupees = Math.round((v.exposure - m.exposure) * r.fleet);
      if (rupees >= 5_000) out.push({ id: r.id, name: r.name, measure: 'Fuel exposure per bus', value: `₹${formatCount(Math.round(v.exposure))}`, median: `₹${formatCount(Math.round(m.exposure))}`, worth: `₹${formatCount(rupees)} of fuel to verify above the median`, size: rupees / RUPEES_PER_BUS_DAY });
    }
  }
  return out.sort((a, b) => b.size - a.size).slice(0, 8);
}

export function OpportunityPanel({ items, onSelect }: { readonly items: readonly Opportunity[]; readonly onSelect: (id: string) => void }) {
  return (
    <Panel kicker="AI-identified improvement opportunities" title="Where a depot sits furthest below the median" bodyClassName="p-0" actions={<AiKindChip kind="recommend" />}>
      {items.length === 0 ? (
        <EmptyNote>No depot sits far enough below the median on these measures.</EmptyNote>
      ) : (
        <ul className="divide-y divide-holo-glow/[0.06]">
          {items.map((o) => (
            <li key={`${o.id}-${o.measure}`}>
              <button type="button" onClick={() => onSelect(o.id)} className="w-full px-4 py-2 text-left transition-colors hover:bg-depot-raised">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-sans text-[12.5px] font-semibold text-depot-ink">{o.name}</span>
                  <span className="shrink-0 font-mono text-[11px] text-alert-amber">
                    {o.value} <span className="text-depot-muted">vs {o.median}</span>
                  </span>
                </span>
                <span className="block font-sans text-[12px] text-depot-prose">
                  {o.measure}: {o.worth}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
