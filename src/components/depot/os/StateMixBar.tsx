import { formatCount } from '@/lib/depot/format';
import { meaningColour } from '@/lib/depot/palette';
import type { StateMix } from '@/lib/depot/types';

const PARTS = [
  { key: 'inService', label: 'In service' },
  { key: 'onRoad', label: 'On road' },
  { key: 'standing', label: 'Standing' },
  { key: 'dark', label: 'Dark' },
  { key: 'offRoad', label: 'Off road' },
] as const;

/** A fleet's five states as one stacked bar, in the module's state colours. */
export function StateMixBar({
  states,
  fleet,
  legend = false,
  height = 'h-1.5',
}: {
  readonly states: StateMix;
  readonly fleet: number;
  readonly legend?: boolean;
  readonly height?: string;
}) {
  const label = PARTS.map((p) => `${p.label} ${formatCount(states[p.key])}`).join(', ');
  return (
    <div>
      <div className={`flex ${height} w-full overflow-hidden rounded-full bg-depot-raised`} role="img" aria-label={label} title={label}>
        {fleet > 0
          ? PARTS.map((p) =>
              states[p.key] > 0 ? (
                <span key={p.key} style={{ width: `${(states[p.key] / fleet) * 100}%`, backgroundColor: meaningColour(p.key) }} />
              ) : null,
            )
          : null}
      </div>
      {legend ? (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
          {PARTS.map((p) => (
            <span key={p.key} className="flex items-center gap-1.5 font-sans text-[11.5px] text-depot-prose">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: meaningColour(p.key) }} aria-hidden />
              {p.label}
              <span className="font-mono text-depot-ink">{formatCount(states[p.key])}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
