'use client';

import { useState } from 'react';
import { BusStateMark } from '@/components/depot/shell/BusStateMark';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { formatCount } from '@/lib/depot/format';
import type { YardModel } from '@/lib/depot/yard/yardModel';
import { VISITOR_CAP, visitorRows, type VisitorRow } from '@/lib/depot/yard/yardPageModel';

const VISITOR_COLUMNS: readonly Column<VisitorRow>[] = [
  {
    key: 'registration',
    header: 'Registration',
    render: (r) => r.registration,
    sortValue: (r) => r.registration,
  },
  { key: 'home', header: 'Home depot', render: (r) => r.homeDepot, sortValue: (r) => r.homeDepot },
  {
    key: 'state',
    header: 'State',
    render: (r) => <BusStateMark state={r.state} short />,
    sortValue: (r) => r.state,
  },
];

/** Visiting buses as one table by home depot, capped at 15 with "Show all N". */
export function YardVisitors({ model }: { readonly model: YardModel }) {
  const [all, setAll] = useState(false);
  const rows = visitorRows(model.visitorGroups.flatMap((group) => group.buses));
  return (
    <section aria-labelledby="yard-roll-visitors">
      <SectionLabel
        id="yard-roll-visitors"
        label="Visiting buses"
        count={rows.length}
        note="By home depot"
      />
      {rows.length === 0 ? (
        <StatePanel kind="empty" sentence="No bus from another depot is standing in this yard." />
      ) : (
        <>
          <DataTable
            columns={VISITOR_COLUMNS}
            rows={rows}
            rowKey={(r) => r.registration}
            caption="Visiting buses by home depot"
            fixedRows
            maxRows={all ? undefined : VISITOR_CAP}
          />
          {rows.length > VISITOR_CAP ? (
            <button
              type="button"
              aria-expanded={all}
              onClick={() => setAll((open) => !open)}
              className="depot-filter-button mt-2"
            >
              {all ? 'Show fewer' : `Show all ${formatCount(rows.length)}`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
