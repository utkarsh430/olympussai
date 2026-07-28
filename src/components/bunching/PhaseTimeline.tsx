'use client';

import { cn } from '@/lib/utils';
import { PHASES_WITHOUT_AI, PHASES_WITH_AI } from '@/lib/bunching/config';
import type { Policy } from '@/lib/bunching/types';

/**
 * The narrative arc of each policy as a compact stepper. Reaching "Persistent
 * Instability" on one side while the other reaches "Stable" is the comparison in
 * a single line.
 */
export function PhaseTimeline({
  policy,
  currentIndex,
}: {
  policy: Policy;
  currentIndex: number;
}) {
  const phases = policy === 'withAI' ? PHASES_WITH_AI : PHASES_WITHOUT_AI;
  const active = Math.min(currentIndex, phases.length - 1);
  const accent = policy === 'withAI' ? 'holo-teal' : 'alert-crimson';

  return (
    <ol className="flex items-center gap-1 overflow-x-auto" aria-label={`${policy === 'withAI' ? 'Controlled' : 'Uncontrolled'} corridor phases`}>
      {phases.map((phase, index) => {
        const reached = index <= active;
        const isCurrent = index === active;
        return (
          <li key={phase} className="flex min-w-0 items-center gap-1">
            <span
              className={cn(
                'whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.1em] transition-colors',
                isCurrent
                  ? accent === 'holo-teal'
                    ? 'border-holo-teal/60 bg-holo-teal/15 text-holo-teal'
                    : 'border-alert-crimson/60 bg-alert-crimson/15 text-alert-crimson'
                  : reached
                    ? 'border-holo-glow/25 bg-holo-glow/[0.05] text-holo-glow/60'
                    : 'border-holo-glow/10 text-holo-glow/25',
              )}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {phase}
            </span>
            {index < phases.length - 1 && (
              <span
                aria-hidden
                className={cn('h-px w-2 shrink-0', reached ? 'bg-holo-glow/30' : 'bg-holo-glow/10')}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
