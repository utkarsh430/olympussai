import { DataTable } from '@/components/depot/shell/DataTable';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import type { ShiftRow } from '@/lib/depot/schedule/schedulePageModel';
import { PEOPLE_SENTENCE } from '@/lib/depot/schedule/scheduleWording';

const PAGE_ROWS = 50;

export function ShiftTable({ rows }: { readonly rows: readonly ShiftRow[] }) {
  const short = rows.filter((r) => !r.covered).length;
  return (
    <section aria-label="Crew shifts" className="min-w-0">
      <SectionLabel label="Crew shifts" count={rows.length} note={short === 0 ? 'every shift covered' : `${short} short`} noteTone={short === 0 ? 'better' : 'critical'} />
      <p className="depot-note mb-2">{PEOPLE_SENTENCE}</p>
      <DataTable
        caption="Crew shifts of the plan"
        rows={rows}
        rowKey={(r) => r.id}
        maxRows={PAGE_ROWS}
        freezeFirstColumn
        overflowCue
        columns={[
          { key: 'bus', header: 'Bus', render: (r) => r.bus },
          { key: 'route', header: 'Route', render: (r) => r.route },
          { key: 'start', header: 'Start', render: (r) => r.startText },
          { key: 'end', header: 'End', render: (r) => r.endText },
          { key: 'driver', header: 'Driver slot', render: (r) => r.driverSlot },
          { key: 'conductor', header: 'Conductor slot', render: (r) => r.conductorSlot },
          { key: 'status', header: 'Status', render: (r) => r.statusText },
        ]}
      />
    </section>
  );
}
