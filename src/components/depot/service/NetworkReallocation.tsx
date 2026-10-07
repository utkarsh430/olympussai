'use client';

import { useState } from 'react';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { Pager } from '@/components/depot/shell/LongLists';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { countPhrase, formatCount, formatOneDecimal, pluralWord } from '@/lib/depot/format';
import { pageRange } from '@/lib/depot/listPaging';
import { serviceBand } from '@/lib/depot/service/networkHours';
import { uncoveredWords } from '@/lib/depot/service/networkPageModel';
import { DASH } from '@/lib/depot/service/serviceWording';
import type { BandReallocation, ReallocationMove, ReallocationUncovered } from '@/lib/depot/service/types';

const TITLE_ID = 'service-reallocation';

const MOVE_COLUMNS: readonly Column<ReallocationMove>[] = [
  { key: 'from', header: 'From depot', render: (m) => m.fromDepotName },
  { key: 'route', header: 'Route', render: (m) => <span className="font-mono text-[11px]">{m.routeName}</span> },
  { key: 'to', header: 'Runs from', render: (m) => m.toDepotName ?? DASH },
  { key: 'buses', header: 'Buses', align: 'right', render: (m) => formatCount(m.buses) },
  { key: 'kind', header: 'Move', render: (m) => (m.withinDepot ? 'Within depot' : 'Between depots') },
  {
    key: 'dead',
    header: 'Dead km a bus',
    tag: 'modelled',
    align: 'right',
    render: (m) => (m.withinDepot ? DASH : formatOneDecimal(m.deadKmPerBus)),
  },
];

const UNCOVERED_COLUMNS: readonly Column<ReallocationUncovered>[] = [
  { key: 'route', header: 'Route', render: (u) => <span className="font-mono text-[11px]">{u.routeName}</span> },
  { key: 'buses', header: 'Buses short', align: 'right', render: (u) => formatCount(u.buses) },
  { key: 'why', header: 'Why left', render: (u) => uncoveredWords(u.reason) },
];

/** One sentence of the band's reallocation: within, between, their dead km, and what is left. */
function summary(r: BandReallocation): string {
  const left = r.uncovered.reduce((s, u) => s + u.buses, 0);
  const within = countPhrase(r.busesWithin, 'bus moves', 'buses move');
  const uncovered = `${countPhrase(left, 'bus', 'buses')} short ${pluralWord(left, 'is', 'are')} left uncovered`;
  return `${within} within their depot and ${formatCount(r.busesBetween)} between depots, ${formatOneDecimal(r.deadKm)} empty km in all; ${uncovered}.`;
}

/** The band's hourly reallocation: surplus (held and standing) buses to the short routes. */
export function NetworkReallocation({ reallocation }: { readonly reallocation: BandReallocation }) {
  const [page, setPage] = useState(0);
  const [leftPage, setLeftPage] = useState(0);
  const range = pageRange(page, reallocation.moves.length);
  const left = pageRange(leftPage, reallocation.uncovered.length);
  const band = serviceBand(reallocation.band);
  return (
    <section aria-labelledby={TITLE_ID} className="min-w-0" data-testid="service-reallocation">
      <SectionLabel id={TITLE_ID} label="Reallocation by band" note={band.label} tag="modelled" />
      <p className="depot-prose mb-3">{summary(reallocation)}</p>
      {reallocation.moves.length === 0 ? (
        <StatePanel kind="empty" compact sentence="No bus can move in this band: no depot has buses to spare for a short route within reach." />
      ) : (
        <>
          <DataTable
            columns={MOVE_COLUMNS}
            rows={reallocation.moves.slice(range.start, range.end)}
            rowKey={(m) => `${m.fromDepotId}>${m.routeName}`}
            caption="Buses moved to short routes in this band"
            fixedRows
          />
          <Pager page={range.page} total={reallocation.moves.length} onPage={setPage} />
        </>
      )}
      {reallocation.uncovered.length > 0 ? (
        <div className="mt-4">
          <SectionLabel label="Left uncovered" level={3} count={reallocation.uncovered.length} />
          <DataTable
            columns={UNCOVERED_COLUMNS}
            rows={reallocation.uncovered.slice(left.start, left.end)}
            rowKey={(u) => u.routeName}
            caption="Short routes no surplus reached, and why"
            fixedRows
          />
          <Pager page={left.page} total={reallocation.uncovered.length} onPage={setLeftPage} />
        </div>
      ) : null}
    </section>
  );
}
