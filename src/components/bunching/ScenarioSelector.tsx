'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SCENARIOS } from '@/lib/bunching/scenarios';
import type { ScenarioId } from '@/lib/bunching/types';

/**
 * The six scenarios. Rendered as a radio group so keyboard users get arrow-key
 * selection for free, and the active card is marked with a tick and a border
 * change as well as colour.
 */
export function ScenarioSelector({
  selected,
  onSelect,
}: {
  selected: ScenarioId;
  onSelect: (id: ScenarioId) => void;
}) {
  return (
    <div
      className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
      role="radiogroup"
      aria-label="Bunching scenario"
      data-testid="scenario-selector"
    >
      {SCENARIOS.map((scenario) => {
        const active = scenario.id === selected;
        return (
          <button
            key={scenario.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(scenario.id)}
            data-testid={`scenario-${scenario.id}`}
            className={cn(
              'group relative flex flex-col gap-1 rounded border px-3 py-2.5 text-left transition-colors',
              active
                ? 'border-sim-accent/70 bg-sim-accent/[0.1] shadow-[0_0_0_1px_rgba(11,110,135,0.22),0_6px_18px_-10px_rgba(11,110,135,0.35)]'
                : 'border-sim-line bg-sim-well hover:border-sim-accent/40 hover:bg-sim-accent/[0.05]',
            )}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  'font-mono text-[10px] tabular-nums tracking-[0.14em]',
                  active ? 'text-sim-ink' : 'text-sim-muted',
                )}
              >
                {scenario.number}
              </span>
              {active && (
                <Check aria-hidden className="h-3 w-3 text-sim-ink" />
              )}
            </div>
            <span
              className={cn(
                'font-mono text-[11px] font-semibold uppercase leading-tight tracking-[0.06em]',
                active ? 'text-sim-ink' : 'text-sim-muted',
              )}
            >
              {scenario.name}
            </span>
            <span className="font-mono text-[9px] leading-relaxed text-sim-muted">
              {scenario.cause}
            </span>
          </button>
        );
      })}
    </div>
  );
}
