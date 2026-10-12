'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DataTable } from '@/components/depot/shell/DataTable';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { rosterBusHref } from '@/lib/depot/depotNav';
import { axisTicks, nowLinePct } from '@/lib/depot/duties/dutyBoardModel';
import { DEPOT_CATEGORY_HUES } from '@/lib/depot/palette';
import type { BlockRow } from '@/lib/depot/schedule/schedulePageModel';

/** The palette's six category hues, then the same six hatched; the route code sits in every leg. */
const HUES = DEPOT_CATEGORY_HUES;
/** Two hex digits of alpha appended to a palette hue: a third of full strength. */
const FILL_ALPHA = '55';

function legStyle(colour: number): { readonly background: string; readonly border: string } {
  const hue = HUES[colour % HUES.length] as string;
  const hatched = colour >= HUES.length;
  return {
    background: hatched ? `repeating-linear-gradient(135deg, ${hue}${FILL_ALPHA} 0 4px, transparent 4px 8px)` : `${hue}${FILL_ALPHA}`,
    border: hue,
  };
}

const LABEL = 'w-[96px] shrink-0 sm:w-[160px]';
const TRACK = 'relative mx-4 flex-1';

function Timeline({ depotId, rows, feedNow }: { readonly depotId: string; readonly rows: readonly BlockRow[]; readonly feedNow: string | null }) {
  const now = nowLinePct(feedNow);
  return (
    <div role="region" aria-label="Block timeline, scrolls inside its frame" tabIndex={0} className="relative max-h-[480px] overflow-auto rounded-md border border-depot-line bg-depot-page">
      <div className="relative min-w-[900px] sm:min-w-0">
        <div className="sticky top-0 z-30 flex border-b border-depot-line bg-depot-surface">
          <div className={`${LABEL} depot-label sticky left-0 z-40 bg-depot-surface px-3 py-2`}>Bus</div>
          <div className={TRACK} style={{ height: 28 }}>
            {axisTicks().map((tick) => (
              <span key={tick.label} className="absolute -translate-x-1/2 font-mono text-[11px] leading-4 text-depot-muted" style={{ left: `${tick.leftPct}%`, top: 4 }}>
                {tick.label}
              </span>
            ))}
          </div>
        </div>
        <div className="relative">
          <div aria-hidden className="pointer-events-none absolute inset-y-0 left-[112px] right-4 sm:left-[176px]">
            {axisTicks().map((tick) => (
              <span key={tick.label} className="absolute inset-y-0 w-px bg-depot-line" style={{ left: `${tick.leftPct}%` }} />
            ))}
            {now === null ? null : <span className="absolute inset-y-0 z-[5] w-[2px] bg-alert-amber" style={{ left: `${now}%` }} />}
          </div>
          {rows.map((row) => (
            <div key={row.id} className="relative flex h-9 border-b border-depot-line">
              <span className="sr-only">{row.ariaLabel}</span>
              <div className={`${LABEL} sticky left-0 z-20 flex items-center bg-depot-page px-2 font-mono text-[11px]`} title={row.legsText}>
                {row.registrationNumber === null ? (
                  <span className="text-alert-crimson">no bus</span>
                ) : (
                  <Link href={rosterBusHref(depotId, row.registrationNumber)} className="truncate text-holo-glow underline-offset-2 hover:underline">
                    {row.registrationNumber}
                  </Link>
                )}
              </div>
              <div className={TRACK}>
                {row.legs.map((leg) => {
                  const style = legStyle(leg.colour);
                  return (
                    <span
                      key={`${leg.routeName}-${leg.startMin}`}
                      aria-hidden
                      className="absolute top-1.5 flex h-6 items-center overflow-hidden rounded-[3px] border px-1 font-mono text-[10px] text-depot-ink"
                      style={{ left: `${leg.geometry.leftPct}%`, width: `${leg.geometry.widthPct}%`, background: style.background, borderColor: style.border }}
                      title={`${leg.routeName} ${row.spanText}`}
                    >
                      <span className="truncate">{leg.routeName}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function BlockBoard({ depotId, rows, feedNow }: { readonly depotId: string; readonly rows: readonly BlockRow[]; readonly feedNow: string | null }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <section aria-label="Block timeline" className="min-w-0">
      <SectionLabel label="Block timeline" count={rows.length} note="one row per bus, a leg per route" />
      <div className="mb-2 flex gap-2">
        {(['chart', 'table'] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className="depot-filter-button">
            {v === 'chart' ? 'Chart' : 'Table'}
          </button>
        ))}
      </div>
      {view === 'chart' ? (
        <Timeline depotId={depotId} rows={rows} feedNow={feedNow} />
      ) : (
        <DataTable
          caption="Blocks of the day, one per bus"
          rows={rows}
          rowKey={(r) => r.id}
          freezeFirstColumn
          overflowCue
          columns={[
            { key: 'bus', header: 'Bus', render: (r) => r.registrationNumber ?? 'no bus' },
            { key: 'span', header: 'Span', render: (r) => r.spanText },
            { key: 'legs', header: 'Legs', render: (r) => r.legsText },
            { key: 'hours', header: 'Hours', align: 'right', render: (r) => r.hoursText },
            { key: 'status', header: 'Status', render: (r) => r.statusText },
          ]}
        />
      )}
    </section>
  );
}
