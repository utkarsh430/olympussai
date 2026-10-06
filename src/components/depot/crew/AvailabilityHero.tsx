import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import type { AvailabilityCounts } from '@/lib/depot/crew/api';
import {
  HATCHED_AVAILABILITY,
  availabilitySegments,
  availabilityText,
  totalSlots,
} from '@/lib/depot/crew/crewPageModel';
import type { CrewAvailability, CrewRole } from '@/lib/depot/crew/types';
import { formatCount } from '@/lib/depot/format';

/*
 * One segment style per availability word. The word and the count are always
 * written beside the bar, so the fill only reinforces them; the fills are one
 * accent for "available", a paler accent for training, two greys and an outline.
 */
const FILL: Readonly<Record<CrewAvailability, string>> = {
  available: 'bg-holo-glow',
  weekly_off: 'bg-depot-muted',
  leave: 'bg-depot-faint',
  training: 'bg-holo-glow/40',
  absent: 'border border-depot-muted bg-depot-raised',
};

/** 45 degree ink lines over the grey: a pattern that survives greyscale and colour blindness. */
const HATCH_STYLE: React.CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(45deg, currentColor 0, currentColor 1.5px, transparent 1.5px, transparent 4px)',
};

const styleOf = (key: CrewAvailability): React.CSSProperties | undefined =>
  HATCHED_AVAILABILITY.includes(key) ? HATCH_STYLE : undefined;

const ROLES: readonly { readonly role: CrewRole; readonly title: string }[] = [
  { role: 'driver', title: 'Drivers' },
  { role: 'conductor', title: 'Conductors' },
];

interface RoleBarProps {
  readonly role: CrewRole;
  readonly title: string;
  readonly counts: AvailabilityCounts;
}

function RoleBar({ role, title, counts }: RoleBarProps) {
  const segments = availabilitySegments(counts);
  const total = totalSlots(counts);
  return (
    <div className="min-w-0">
      <h3 className="mb-2 font-mono text-[13px] text-depot-ink">
        {title} <span className="tabular-nums text-depot-muted">{formatCount(total)} slots</span>
      </h3>
      <div
        role="img"
        aria-label={availabilityText(role, counts)}
        className="flex h-3 w-full gap-0.5 overflow-hidden rounded-[2px] bg-depot-raised"
      >
        {segments
          .filter((segment) => segment.count > 0)
          .map((segment) => (
            <div
              key={segment.key}
              className={`min-w-[2px] text-depot-ink ${FILL[segment.key]}`}
              style={{ ...styleOf(segment.key), flexGrow: segment.count, flexBasis: 0 }}
            />
          ))}
      </div>
      <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        {segments.map((segment) => (
          <li key={segment.key} className="flex min-w-0 items-center gap-2 font-mono text-[12px]">
            <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-[2px] text-depot-ink ${FILL[segment.key]}`}
              style={styleOf(segment.key)}
            />
            <span className="min-w-0 truncate text-depot-muted">{segment.label}</span>
            <span className="ml-auto tabular-nums text-depot-ink">{formatCount(segment.count)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface AvailabilityHeroProps {
  readonly availability: Readonly<Record<CrewRole, AvailabilityCounts>>;
}

/** The page's hero: crew slots by availability for each role, as counts and a simple bar. */
export function AvailabilityHero({ availability }: AvailabilityHeroProps) {
  return (
    <section aria-labelledby="depot-crew-availability-heading" className="min-w-0 animate-rise">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="depot-crew-availability-heading" className="depot-section-label !mb-0">
          Crew availability by role
        </h2>
        <ProvenanceBadge provenance="modelled" />
      </div>
      <div className="depot-panel grid grid-cols-1 gap-6 p-4 xl:grid-cols-2">
        {ROLES.map(({ role, title }) => (
          <RoleBar key={role} role={role} title={title} counts={availability[role]} />
        ))}
      </div>
    </section>
  );
}
