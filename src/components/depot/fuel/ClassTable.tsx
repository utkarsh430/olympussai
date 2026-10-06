'use client';

import { useMemo } from 'react';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import { formatCount } from '@/lib/depot/format';
import { groupLabel } from '@/lib/depot/fuel/fuelPageModel';
import { classNote, classTableRows, type ClassTableRow } from '@/lib/depot/fuel/fuelPageTables';
import type { FuelGroupRow } from '@/lib/depot/fuel/types';

const COLUMNS: readonly Column<ClassTableRow>[] = [
  { key: 'class', header: 'Class', sortValue: (r) => r.label, render: (r) => r.label },
  {
    key: 'kmpl',
    header: 'Km per litre',
    sortValue: (r) => r.kmPerLitre,
    title: (r) => r.valueText,
    render: (r) => (
      <span className="flex min-w-0 items-center gap-2">
        <span aria-hidden className="depot-bar-track w-28 !min-w-0 shrink-0">
          <span className="depot-bar-fill" style={{ width: `${r.widthPct}%` }} />
        </span>
        <span>{r.valueText}</span>
      </span>
    ),
  },
  {
    key: 'buses',
    header: 'Buses',
    align: 'right',
    sortValue: (r) => r.busCount,
    render: (r) => formatCount(r.busCount),
  },
  { key: 'distance', header: 'Distance', align: 'right', render: (r) => r.distanceText },
  { key: 'cpk', header: 'Cost per km', align: 'right', render: (r) => r.costPerKmText },
];

/** Kilometres per litre by service class: four rows, each with an inline bar and its value at the bar's end. */
export function ClassTable({ rows }: { readonly rows: readonly FuelGroupRow[] }) {
  const shaped = useMemo(() => classTableRows(rows, groupLabel), [rows]);
  return (
    <section aria-labelledby="depot-fuel-class-heading" className="min-w-0">
      <SectionLabel id="depot-fuel-class-heading" label="By service class" note={classNote(rows)} />
      <DataTable
        columns={COLUMNS}
        rows={shaped}
        rowKey={(r) => r.key}
        caption="Kilometres per litre, distance and cost per kilometre by service class"
        fixedRows
      />
    </section>
  );
}
