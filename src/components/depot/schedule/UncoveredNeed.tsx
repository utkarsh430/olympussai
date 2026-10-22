import { DataTable } from '@/components/depot/shell/DataTable';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import type { UncoveredRow } from '@/lib/depot/schedule/schedulePageModel';
import { COVERED_SENTENCE } from '@/lib/depot/schedule/scheduleWording';

export function UncoveredNeed({ rows, heldOut }: { readonly rows: readonly UncoveredRow[]; readonly heldOut: string | null }) {
  return (
    <section aria-label="Uncovered need" className="min-w-0">
      <SectionLabel label="Uncovered need" count={rows.length} />
      {heldOut ? <p className="depot-note mb-2">{heldOut}</p> : null}
      {rows.length === 0 ? (
        <p className="depot-prose text-alert-green" data-testid="schedule-covered">{COVERED_SENTENCE}</p>
      ) : (
        <DataTable
          caption="Hours whose need the plan does not cover"
          rows={rows}
          rowKey={(r) => r.key}
          columns={[
            { key: 'route', header: 'Route', render: (r) => r.routeName },
            { key: 'hours', header: 'Hours', render: (r) => r.hoursText },
            { key: 'buses', header: 'Buses short', align: 'right', render: (r) => String(r.buses) },
            { key: 'reason', header: 'Reason', render: (r) => r.reasonText },
          ]}
        />
      )}
    </section>
  );
}
