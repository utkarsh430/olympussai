'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { Pager } from '@/components/depot/shell/LongLists';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { routeHourlyPath } from '@/lib/depot/nav';
import { serviceBand } from '@/lib/depot/service/networkHours';
import { heatCell, heatTableRows, type HeatTableRow } from '@/lib/depot/service/networkPageModel';
import { hourLabel } from '@/lib/depot/service/serviceWording';
import type { NetworkHourlyResponse, NetworkRouteStrip } from '@/lib/depot/service/types';
import { heatFill } from './heatStyle';
import { NetworkHeatLegend } from './NetworkHeatLegend';

const TITLE_ID = 'service-heat';
const TABLE_ID = 'service-heat-table';
const HOURS = Array.from({ length: 24 }, (_, h) => h);
/** The route column and 24 hour columns; the frame scrolls sideways below its width. */
const GRID = 'grid grid-cols-[160px_repeat(24,minmax(20px,1fr))] gap-px';

const TABLE_COLUMNS: readonly Column<HeatTableRow>[] = [
  { key: 'route', header: 'Route', render: (r) => r.routeName },
  { key: 'depot', header: 'Depot', render: (r) => r.depot },
  { key: 'peak', header: 'Band peak', render: (r) => r.peak },
  ...HOURS.map((h) => ({
    key: `h${h}`,
    header: String(h).padStart(2, '0'),
    render: (r: HeatTableRow) => r.hours[h] ?? '',
  })),
];

function HeatRow({ strip, band }: { strip: NetworkRouteStrip; band: { fromHour: number; toHour: number } }) {
  return (
    <div className={GRID} role="row" data-testid="heat-row">
      <span role="rowheader" className="min-w-0 truncate">
        <Link
          href={routeHourlyPath(strip.routeName)}
          className="depot-table-link font-mono text-[11px] leading-5"
          title={`${strip.routeName}, hour by hour`}
        >
          {strip.routeName}
        </Link>
      </span>
      {strip.gaps.map((gap, h) => {
        const cell = heatCell(gap, strip.bases[h] ?? 'modelled');
        const inBand = h >= band.fromHour && h <= band.toHour;
        const basis = cell.measured ? 'measured' : 'modelled';
        const words = `${hourLabel(h)}: ${cell.text}, ${cell.words.toLowerCase()} (${basis})`;
        return (
          <span
            key={h}
            role="cell"
            className={`h-5 ${inBand ? '' : 'opacity-60'}`}
            style={heatFill(cell)}
            title={`${strip.routeName} at ${words}`}
            aria-label={words}
            data-tone={cell.tone}
            data-basis={basis}
          />
        );
      })}
    </div>
  );
}

function HourAxis({ band }: { band: { fromHour: number; toHour: number } }) {
  return (
    <div className={GRID} aria-hidden>
      <span />
      {HOURS.map((h) => (
        <span
          key={h}
          className={`text-center font-mono text-[11px] ${h >= band.fromHour && h <= band.toHour ? 'text-depot-ink' : 'depot-faint'}`}
        >
          {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
        </span>
      ))}
    </div>
  );
}

export interface NetworkHeatMapProps {
  readonly response: NetworkHourlyResponse;
  readonly onPage: (page: number) => void;
}

/**
 * The page's hero: routes by hour, the band's largest peak gaps first, a page of 25; every
 * cell's gap is in its title and in the table view, and the legend says each fill in words.
 */
export function NetworkHeatMap({ response, onPage }: NetworkHeatMapProps) {
  const [asTable, setAsTable] = useState(false);
  const band = serviceBand(response.band);
  const rows = response.routes.rows;
  const tableRows = useMemo(() => heatTableRows(rows), [rows]);
  const label = `Gap by hour for ${rows.length} routes, ${band.label.toLowerCase()} highlighted; the table view lists every hour in words.`;
  return (
    <section aria-labelledby={TITLE_ID} className="min-w-0" data-testid="service-heat-map">
      <SectionLabel
        id={TITLE_ID}
        label="Routes by hour"
        note={`Largest ${band.label.toLowerCase()} gap first`}
        controls={
          <button
            type="button"
            className="depot-filter-button"
            aria-pressed={asTable}
            aria-controls={TABLE_ID}
            onClick={() => setAsTable((v) => !v)}
          >
            {asTable ? 'Show as heat map' : 'Show as table'}
          </button>
        }
      />
      {rows.length === 0 ? (
        <StatePanel kind="empty" compact sentence="No route in this selection reports a route name now." />
      ) : asTable ? (
        <div id={TABLE_ID}>
          <DataTable
            columns={TABLE_COLUMNS}
            rows={tableRows}
            rowKey={(r) => r.routeName}
            caption="Gap by hour for each route: + short, − over, measured or modelled"
            fixedRows
          />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto" id={TABLE_ID}>
            <div role="table" aria-label={label} className="min-w-[660px] space-y-px">
              <HourAxis band={band} />
              {rows.map((s) => (
                <HeatRow key={s.routeName} strip={s} band={band} />
              ))}
            </div>
          </div>
          <NetworkHeatLegend />
        </>
      )}
      <Pager page={response.routes.page} total={response.routes.total} pageSize={response.routes.pageSize} onPage={onPage} />
    </section>
  );
}
