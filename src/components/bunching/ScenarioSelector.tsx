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
                ? 'border-holo-glow/70 bg-holo-glow/[0.1] shadow-hud'
                : 'border-holo-glow/18 bg-void-900/50 hover:border-holo-glow/40 hover:bg-holo-glow/[0.05]',
            )}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  'font-mono text-[10px] tabular-nums tracking-[0.14em]',
                  active ? 'text-holo-glow' : 'text-holo-glow/45',
                )}
              >
                {scenario.number}
              </span>
              {active && (
                <Check aria-hidden className="h-3 w-3 text-holo-glow" />
              )}
            </div>
            <span
              className={cn(
                'font-mono text-[11px] font-semibold uppercase leading-tight tracking-[0.06em]',
                active ? 'text-holo-glow' : 'text-holo-glow/70',
              )}
            >
              {scenario.name}
            </span>
            <span className="font-mono text-[9px] leading-relaxed text-holo-glow/45">
              {scenario.cause}
            </span>
          </button>
        );
      })}
    </div>
  );
}
