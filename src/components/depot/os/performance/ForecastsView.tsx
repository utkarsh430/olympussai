'use client';

import { useDepotForecast } from '@/hooks/useDepotForecast';
import { DEFAULT_PRICE_PER_LITRE } from '@/lib/depot/fuel/types';
import { formatCount, signFor } from '@/lib/depot/format';
import { AUDIT_DAYS } from '@/lib/depot/os/intel/fuelAudit';
import { DEPOT_PALETTE } from '@/lib/depot/palette';
import type { MetricKey } from '@/lib/depot/sim/types';
import { useIntel } from '../IntelProvider';
import { OsHeader } from '../OsHeader';
import { EmptyNote, Panel, PanelLoading, StatusTag } from '../ui';

const W = 520;
const H = 170;
const PAD = { l: 44, r: 10, t: 10, b: 22 };

interface Card {
  readonly metric: MetricKey;
  readonly title: string;
  readonly why: string;
}

const CARDS: readonly Card[] = [
  { metric: 'available', title: 'Fleet availability', why: 'Buses available (fleet less off road), with the projected range.' },
  { metric: 'offRoadRate', title: 'Maintenance workload', why: 'Share of the fleet off the road: the workshop’s load ahead.' },
  { metric: 'onRoadShare', title: 'Service coverage', why: 'Share of the fleet on the road at the busiest window of each day.' },
  { metric: 'index', title: 'Depot performance index', why: 'The network efficiency index, a peer-relative score.' },
];

function format(value: number, unit: string): string {
  if (unit === 'fraction') return `${(value * 100).toFixed(1)}%`;
  if (unit === 'buses') return formatCount(Math.round(value));
  return value.toFixed(1);
}

function ForecastCard({ card }: { readonly card: Card }) {
  const { data, error } = useDepotForecast({ metric: card.metric, scope: { kind: 'network' }, horizon: 14 });
  if (error && !data) {
    return (
      <Panel kicker="Forecast" title={card.title}>
        <EmptyNote>{error}</EmptyNote>
      </Panel>
    );
  }
  if (!data) {
    return (
      <Panel kicker="Forecast" title={card.title}>
        <PanelLoading rows={3} label={`Loading ${card.title}`} />
      </Panel>
    );
  }
  const history = data.history.series.slice(-42);
  const forecast = data.forecast.result.status === 'ok' ? data.forecast.result.forecast.points : [];
  const all = [...history.map((p) => p.value), ...forecast.flatMap((p) => [p.low, p.high])];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const n = history.length + forecast.length;
  const x = (i: number): number => PAD.l + (i / Math.max(1, n - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number): number => PAD.t + (1 - (v - min) / span) * (H - PAD.t - PAD.b);
  const hist = history.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const off = history.length - 1;
  const last = history[history.length - 1];
  const lastF = forecast[forecast.length - 1];
  const fLine = [last ? `${x(off).toFixed(1)},${y(last.value).toFixed(1)}` : '', ...forecast.map((p, i) => `${x(off + 1 + i).toFixed(1)},${y(p.value).toFixed(1)}`)].join(' ');
  const band = forecast.length
    ? [...forecast.map((p, i) => `${x(off + 1 + i).toFixed(1)},${y(p.high).toFixed(1)}`), ...[...forecast].reverse().map((p, i) => `${x(off + forecast.length - i).toFixed(1)},${y(p.low).toFixed(1)}`)].join(' ')
    : '';
  const unit = data.metric.unit;
  return (
    <Panel kicker="Forecast · 14 days" title={card.title} actions={<StatusTag status="forecast" />} bodyClassName="space-y-2 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="os-kicker">Now</div>
          <div className="os-value">{last ? format(last.value, unit) : '—'}</div>
        </div>
        <div className="text-right">
          <div className="os-kicker">In 14 days</div>
          <div className="os-value text-holo-teal">{lastF ? format(lastF.value, unit) : '—'}</div>
          {lastF ? <div className="font-mono text-[11px] text-depot-prose">range {format(lastF.low, unit)} – {format(lastF.high, unit)}</div> : null}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[170px] w-full" role="img" aria-label={`${card.title}: history and forecast`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.l} x2={W - PAD.r} y1={PAD.t + f * (H - PAD.t - PAD.b)} y2={PAD.t + f * (H - PAD.t - PAD.b)} stroke={DEPOT_PALETTE.line} strokeWidth={0.5} />
            <text x={PAD.l - 6} y={PAD.t + f * (H - PAD.t - PAD.b) + 3} textAnchor="end" fontSize={10} fill={DEPOT_PALETTE.label} fontFamily="var(--font-mono)">
              {format(max - f * span, unit)}
            </text>
          </g>
        ))}
        {band ? <polygon points={band} fill={DEPOT_PALETTE.teal} opacity={0.15} /> : null}
        <polyline points={hist} fill="none" stroke={DEPOT_PALETTE.glow} strokeWidth={1.6} />
        {forecast.length ? <polyline points={fLine} fill="none" stroke={DEPOT_PALETTE.teal} strokeWidth={1.6} strokeDasharray="5 4" /> : null}
        <line x1={x(off)} x2={x(off)} y1={PAD.t} y2={H - PAD.b} stroke={DEPOT_PALETTE.amber} strokeWidth={1} />
        <text x={x(off) + 4} y={H - 6} fontSize={10} fill={DEPOT_PALETTE.amber} fontFamily="var(--font-mono)">today</text>
      </svg>
      <p className="depot-caption">{card.why}</p>
      {data.sentences.method ? <p className="depot-caption text-depot-muted">{data.sentences.method}{data.sentences.error ? ` ${data.sentences.error}` : ''}</p> : null}
      {data.forecast.result.status !== 'ok' && data.sentences.unavailable ? <p className="depot-caption">{data.sentences.unavailable}</p> : null}
    </Panel>
  );
}

/**
 * Predictive forecasts for Headquarters: availability, maintenance workload, coverage and
 * the performance index, each as its history and its projection with a range, never one
 * line; and the diesel bill across a range of prices from the fuel audit's daily litres.
 */
export function ForecastsView() {
  const intel = useIntel();
  const dailyLitres = intel.fuel ? intel.fuel.summary.fuelLitres / AUDIT_DAYS : null;
  const prices = [DEFAULT_PRICE_PER_LITRE - 6, DEFAULT_PRICE_PER_LITRE - 3, DEFAULT_PRICE_PER_LITRE, DEFAULT_PRICE_PER_LITRE + 3, DEFAULT_PRICE_PER_LITRE + 6, DEFAULT_PRICE_PER_LITRE + 10];
  return (
    <div className="space-y-4" data-testid="os-forecasts">
      <OsHeader
        title="Predictive forecasts"
        description="Where the network's measures are heading over the next two weeks, as a projection with its range; the solid line is history."
        statuses={['forecast', 'scenario']}
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {CARDS.map((card) => (
          <ForecastCard key={card.metric} card={card} />
        ))}
      </div>
      <Panel kicker="Fuel-cost scenarios" title="Daily and monthly diesel bill by price" actions={<StatusTag status="scenario" />} bodyClassName="p-0">
        {dailyLitres === null ? (
          <PanelLoading rows={3} label="Waiting for the fuel audit" />
        ) : (
          <table className="os-table">
            <thead>
              <tr>
                <th>Diesel, ₹/L</th>
                <th className="text-right">Daily litres</th>
                <th className="text-right">Daily bill, ₹</th>
                <th className="text-right">30-day bill, ₹ crore</th>
                <th className="text-right">Against planning price</th>
              </tr>
            </thead>
            <tbody>
              {prices.map((p) => {
                const daily = dailyLitres * p;
                const base = dailyLitres * DEFAULT_PRICE_PER_LITRE;
                return (
                  <tr key={p} className={`border-b border-holo-glow/[0.07] ${p === DEFAULT_PRICE_PER_LITRE ? 'bg-depot-selected' : ''}`}>
                    <td className="font-mono">{p}{p === DEFAULT_PRICE_PER_LITRE ? ' (planning)' : ''}</td>
                    <td className="os-num">{formatCount(Math.round(dailyLitres))}</td>
                    <td className="os-num">{formatCount(Math.round(daily))}</td>
                    <td className="os-num">{((daily * 30) / 1e7).toFixed(2)}</td>
                    <td className={`os-num ${daily > base ? 'text-alert-crimson' : daily < base ? 'text-alert-green' : 'text-depot-muted'}`}>
                      {daily === base ? '—' : `${signFor(daily - base)}₹${formatCount(Math.round(Math.abs(daily - base) * 30))} / 30 d`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
