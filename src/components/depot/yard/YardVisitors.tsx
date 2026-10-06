'use client';

import { BusStateMark } from '@/components/depot/shell/BusStateMark';
import type { Column } from '@/components/depot/shell/DataTable';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import type { YardModel } from '@/lib/depot/yard/yardModel';
import { VISITOR_CAP, visitorRows, type VisitorRow } from '@/lib/depot/yard/yardPageModel';
import { CappedTable } from './YardTables';

/** A visitor is on another depot's roster, so its registration is text, not a link here. */
const VISITOR_COLUMNS: readonly Column<VisitorRow>[] = [
  {
    key: 'registration',
    header: 'Registration',
    width: '10rem',
    render: (r) => r.registration,
    sortValue: (r) => r.registration,
  },
  { key: 'home', header: 'Home depot', render: (r) => r.homeDepot, sortValue: (r) => r.homeDepot },
  {
    key: 'state',
    header: 'State',
    width: '8rem',
    render: (r) => <BusStateMark state={r.state} short />,
    sortValue: (r) => r.state,
  },
];

/** Visiting buses as one table by home depot, capped at 15 with "Show all N". */
export function YardVisitors({ model }: { readonly model: YardModel }) {
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
        <StatePanel
          kind="empty"
          compact
          sentence="No bus from another depot is standing in this yard"
        />
      ) : (
        <CappedTable
          columns={VISITOR_COLUMNS}
          rows={rows}
          rowKey={(r) => r.registration}
          caption="Visiting buses by home depot"
          cap={VISITOR_CAP}
        />
      )}
    </section>
  );
}
