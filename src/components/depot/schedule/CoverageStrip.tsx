import { SectionLabel } from '@/components/depot/shell/SectionLabel';
import type { CoverageRow } from '@/lib/depot/schedule/schedulePageModel';

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * One row per route, 24 cells of "needed/scheduled". A short cell is marked by a crimson
 * tick and hatching as well as its figures, never by colour alone.
 */
export function CoverageStrip({ rows }: { readonly rows: readonly CoverageRow[] }) {
  return (
    <section aria-label="Route coverage by hour" className="min-w-0">
      <SectionLabel label="Route coverage by hour" count={rows.length} note="needed / scheduled" />
      <div className="depot-table-frame overflow-x-auto">
        <table className="depot-table w-full text-[11px]">
          <caption className="sr-only">Buses needed and scheduled per route and hour</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 bg-depot-surface px-2 text-left">Route</th>
              {HOURS.map((h) => (
                <th key={h} scope="col" className="px-1 text-right font-mono">{String(h).padStart(2, '0')}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.routeName}>
                <th scope="row" className="sticky left-0 bg-depot-surface px-2 text-left font-mono">
                  {row.routeName}
                  <span className="sr-only">{row.shortHours === 0 ? ', every hour covered' : `, ${row.shortHours} hours short`}</span>
                </th>
                {row.cells.map((c) => (
                  <td
                    key={c.hour}
                    title={`${row.routeName} ${String(c.hour).padStart(2, '0')}:00: ${c.needed} needed, ${c.scheduled} scheduled`}
                    className={`px-1 text-right font-mono ${c.needed === 0 ? 'text-depot-faint' : c.short ? 'border-l-2 border-alert-crimson bg-[repeating-linear-gradient(135deg,transparent_0_3px,rgba(220,38,38,0.18)_3px_6px)] text-depot-ink' : 'text-depot-ink'}`}
                  >
                    {c.needed === 0 ? '·' : `${c.needed}/${c.scheduled}`}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
