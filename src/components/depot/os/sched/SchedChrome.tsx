'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FolderOpen, Trash2 } from 'lucide-react';
import { formatPlainDate } from '@/lib/depot/format';
import { equivalentHref } from '@/lib/depot/os/workspaces';
import { useIntel } from '../IntelProvider';
import { EmptyNote, Panel } from '../ui';
import { useSchedStore, type SavedScenario, type SchedKind } from './schedStore';

/** The depot and the operating date a scheduler plans: a depot change opens the same scheduler there. */
export function DepotDateFields({ depotId, dates, date, onDate }: { readonly depotId: string; readonly dates: readonly string[]; readonly date: string | null; readonly onDate: (d: string) => void }) {
  const intel = useIntel();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const search = useSearchParams()?.toString() ?? '';
  const depots = (intel.network?.depots ?? []).filter((d) => d.kind === 'depot').sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="block">
        <span className="mb-1 block font-sans text-[12px] font-medium text-depot-ink">Depot</span>
        <select value={depotId} onChange={(e) => router.push(equivalentHref(pathname, search, e.target.value))} className="depot-control depot-select w-full font-sans">
          {depots.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block font-sans text-[12px] font-medium text-depot-ink">Operating date</span>
        <select value={date ?? ''} onChange={(e) => onDate(e.target.value)} className="depot-control depot-select w-full font-sans">
          {dates.map((d, i) => (
            <option key={d} value={d}>
              {formatPlainDate(d)}
              {i === 0 ? ' (today)' : i === 1 ? ' (tomorrow)' : ''}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** Reads `?date=` (or `tomorrow`) once, for links from the copilot. */
export function useDateParam(dates: readonly string[], setDate: (d: string) => void): void {
  const params = useSearchParams();
  const wanted = params?.get('date') ?? null;
  useEffect(() => {
    if (!wanted || dates.length === 0) return;
    if (wanted === 'tomorrow' && dates[1]) setDate(dates[1]);
    else if (dates.includes(wanted)) setDate(wanted);
  }, [wanted, dates, setDate]);
}

/** Saved scenarios of this scheduler for the depot, newest first, to load or remove. */
export function SavedScenarios({ kind, depotId, onLoad }: { readonly kind: SchedKind; readonly depotId: string; readonly onLoad: (s: SavedScenario) => void }) {
  const saved = useSchedStore((s) => s.saved);
  const remove = useSchedStore((s) => s.remove);
  const hydrate = useSchedStore((s) => s.hydrate);
  useEffect(() => hydrate(), [hydrate]);
  const mine = saved.filter((s) => s.kind === kind && s.depotId === depotId);
  return (
    <Panel kicker="Saved scenarios" title={`${mine.length} for this depot`} bodyClassName="p-0">
      {mine.length === 0 ? (
        <EmptyNote>Save a generated plan to compare or reload it later. Saved in this browser only.</EmptyNote>
      ) : (
        <ul className="divide-y divide-holo-glow/[0.06]">
          {mine.map((s) => (
            <li key={s.id} className="flex items-center gap-2 px-4 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-sans text-[12.5px] font-semibold text-depot-ink">{s.label}</div>
                <div className="truncate font-mono text-[11px] text-depot-muted">
                  {formatPlainDate(s.date)} · {Object.entries(s.figures).map(([k, v]) => `${k} ${v}`).join(' · ')}
                </div>
              </div>
              <button type="button" onClick={() => onLoad(s)} className="os-button os-button-quiet h-7 px-2" aria-label={`Load ${s.label}`}>
                <FolderOpen className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button type="button" onClick={() => remove(s.id)} className="os-button os-button-quiet h-7 px-2" aria-label={`Delete ${s.label}`}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
