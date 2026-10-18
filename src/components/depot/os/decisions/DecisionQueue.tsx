'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  Fuel,
  Gauge,
  RadioTower,
  Siren,
  Users,
  Wrench,
  CalendarClock,
  type LucideIcon,
} from 'lucide-react';
import type { Decision, DecisionCategory } from '@/lib/depot/os/intel/types';
import { useOsStore } from '../osStore';
import { EmptyNote, PanelLoading, SeverityChip, SeverityDot } from '../ui';

export const CATEGORY_ICON: Readonly<Record<DecisionCategory, LucideIcon>> = {
  shortage: AlertTriangle,
  redistribution: ArrowLeftRight,
  maintenance: Wrench,
  incident: Siren,
  fuel: Fuel,
  crew: Users,
  telemetry: RadioTower,
  efficiency: Gauge,
  schedule: CalendarClock,
};

export const CATEGORY_LABEL: Readonly<Record<DecisionCategory, string>> = {
  shortage: 'Shortage',
  redistribution: 'Redistribution',
  maintenance: 'Maintenance',
  incident: 'Incident',
  fuel: 'Fuel',
  crew: 'Crew',
  telemetry: 'Telemetry',
  efficiency: 'Efficiency',
  schedule: 'Schedule',
};

const REVIEW_WORD = {
  approved: 'Approved',
  rejected: 'Rejected',
  deferred: 'Deferred',
  assigned: 'Assigned',
  escalated: 'Escalated',
} as const;

/**
 * The ranked decision queue: severity, the issue, its entity and timing, and the
 * recommendation in one line. A category filter narrows it; a reviewed decision shows
 * what the person recorded.
 */
export function DecisionQueue({
  decisions,
  selectedId,
  onSelect,
  loading,
  maxItems,
  dense = false,
}: {
  readonly decisions: readonly Decision[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly loading: boolean;
  readonly maxItems?: number;
  readonly dense?: boolean;
}) {
  const reviews = useOsStore((s) => s.reviews);
  const reviewed = useMemo(() => new Map(reviews.map((r) => [r.decisionId, r])), [reviews]);
  const [category, setCategory] = useState<DecisionCategory | 'all'>('all');
  const categories = useMemo(() => {
    const counts = new Map<DecisionCategory, number>();
    for (const d of decisions) counts.set(d.category, (counts.get(d.category) ?? 0) + 1);
    return [...counts.entries()];
  }, [decisions]);
  const shown = decisions.filter((d) => category === 'all' || d.category === category);
  const visible = maxItems ? shown.slice(0, maxItems) : shown;

  if (loading && decisions.length === 0) return <PanelLoading rows={6} label="Ranking decisions" />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="os-scroll flex shrink-0 gap-1 overflow-x-auto border-b border-holo-glow/10 px-3 py-2" role="group" aria-label="Filter by category">
        <button
          type="button"
          onClick={() => setCategory('all')}
          aria-pressed={category === 'all'}
          className={`os-chip px-2 py-0.5 ${category === 'all' ? 'border-holo-glow/60 text-holo-glow' : 'border-depot-line text-depot-muted hover:text-depot-ink'}`}
        >
          All {decisions.length}
        </button>
        {categories.map(([key, n]) => (
          <button
            key={key}
            type="button"
            onClick={() => setCategory(key)}
            aria-pressed={category === key}
            className={`os-chip px-2 py-0.5 ${category === key ? 'border-holo-glow/60 text-holo-glow' : 'border-depot-line text-depot-muted hover:text-depot-ink'}`}
          >
            {CATEGORY_LABEL[key]} {n}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <EmptyNote>No decision is open in this scope on the latest snapshot.</EmptyNote>
      ) : (
        <ul className="os-scroll min-h-0 flex-1 overflow-y-auto" aria-label="Decision queue" data-testid="os-decision-queue">
          {visible.map((d) => {
            const Icon = CATEGORY_ICON[d.category];
            const review = reviewed.get(d.id);
            const selected = d.id === selectedId;
            return (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => onSelect(d.id)}
                  aria-current={selected ? 'true' : undefined}
                  className={`os-row flex w-full items-start gap-3 px-3 text-left ${dense ? 'py-2' : 'py-2.5'} ${selected ? 'os-row-selected' : ''}`}
                >
                  <span className="mt-1 flex flex-col items-center gap-1.5">
                    <SeverityDot severity={d.severity} pulse={d.severity === 'critical' && !review} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-depot-muted" aria-hidden />
                      <span className="truncate font-mono text-[10.5px] uppercase tracking-[0.1em] text-depot-muted">
                        {CATEGORY_LABEL[d.category]} · {d.timing}
                      </span>
                    </span>
                    <span className="mt-0.5 block font-sans text-[13px] font-medium leading-[18px] text-depot-ink">{d.title}</span>
                    {!dense ? (
                      <span className="mt-1 block truncate font-sans text-[12px] text-depot-prose">
                        → {d.recommendation.title}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <SeverityChip severity={d.severity} />
                    {review ? (
                      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-holo-teal">{REVIEW_WORD[review.action]}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
          {maxItems && shown.length > maxItems ? (
            <li className="px-3 py-2 font-sans text-[12px] text-depot-prose">
              {shown.length - maxItems} more in the AI Decision Center
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}
