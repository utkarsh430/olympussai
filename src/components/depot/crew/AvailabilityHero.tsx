import type { AvailabilityCounts } from '@/lib/depot/crew/api';
import {
  AVAILABILITY_PATTERN,
  SHORTFALL_EXPLANATION,
  availabilitySegments,
  availabilityText,
  coverageLine,
  totalSlots,
  type CoverageInput,
  type SegmentPattern,
} from '@/lib/depot/crew/crewPageModel';
import type { CrewAvailability, CrewRole, RoleShortfall } from '@/lib/depot/crew/types';
import { formatCount } from '@/lib/depot/format';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';

/*
 * One texture per availability word, so the segments differ without colour: the
 * accent solid, a solid grey, 45 degree hatching, dots and vertical stripes (the
 * same patterns on the bar and on the legend swatch). The legend line writes the
 * word and the count, so the texture only reinforces them.
 */
const PATTERN_CLASS: Readonly<Record<SegmentPattern, string>> = {
  solid: 'bg-holo-glow',
  grey: 'bg-depot-muted',
  diagonal: 'bg-depot-faint text-depot-ink',
  dots: 'bg-depot-faint text-depot-ink',
  vertical: 'border border-depot-muted bg-depot-raised text-depot-ink',
};

const PATTERN_STYLE: Readonly<Record<SegmentPattern, React.CSSProperties | undefined>> = {
  solid: undefined,
  grey: undefined,
  diagonal: {
    backgroundImage:
      'repeating-linear-gradient(45deg, currentColor 0, currentColor 1.5px, transparent 1.5px, transparent 4px)',
  },
  dots: {
    backgroundImage: 'radial-gradient(currentColor 1.1px, transparent 1.3px)',
    backgroundSize: '4px 4px',
  },
  vertical: {
    backgroundImage:
      'repeating-linear-gradient(90deg, currentColor 0, currentColor 1.5px, transparent 1.5px, transparent 4px)',
  },
};

const classOf = (key: CrewAvailability): string => PATTERN_CLASS[AVAILABILITY_PATTERN[key]];
const styleOf = (key: CrewAvailability): React.CSSProperties | undefined =>
  PATTERN_STYLE[AVAILABILITY_PATTERN[key]];

const ROLES: readonly { readonly role: CrewRole; readonly title: string }[] = [
  { role: 'driver', title: 'Drivers' },
  { role: 'conductor', title: 'Conductors' },
];

function RoleBar({
  role,
  title,
  counts,
}: {
  readonly role: CrewRole;
  readonly title: string;
  readonly counts: AvailabilityCounts;
}) {
  const segments = availabilitySegments(counts);
  return (
    <div className="min-w-0">
      <h3 className="mb-2 font-mono text-[13px] text-depot-ink">
        {title}{' '}
        <span className="tabular-nums text-depot-muted">{formatCount(totalSlots(counts))} slots</span>
      </h3>
      <div
        role="img"
        aria-label={availabilityText(role, counts)}
        className="flex h-4 w-full gap-0.5 overflow-hidden rounded-[2px] bg-depot-raised"
      >
        {segments
          .filter((segment) => segment.count > 0)
          .map((segment) => (
            <div
              key={segment.key}
              className={`min-w-[2px] ${classOf(segment.key)}`}
              style={{ ...styleOf(segment.key), flexGrow: segment.count, flexBasis: 0 }}
            />
          ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center gap-1.5 font-mono text-[12px]">
            <span
              aria-hidden
              className={`h-2.5 w-2.5 shrink-0 rounded-[2px] ${classOf(segment.key)}`}
              style={styleOf(segment.key)}
            />
            <span className="text-depot-muted">{segment.label}</span>
            <span className="tabular-nums text-depot-ink">{formatCount(segment.count)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface AvailabilityHeroProps {
  readonly availability: Readonly<Record<CrewRole, AvailabilityCounts>>;
  readonly summary: CoverageInput;
  readonly uncovered: readonly { readonly shortfalls: readonly RoleShortfall[] }[];
}

/**
 * The page's hero: one coverage line in a mono callout, then crew slots by availability
 * for each role. A shortfall adds the one line that says it is a model outcome.
 */
export function AvailabilityHero({ availability, summary, uncovered }: AvailabilityHeroProps) {
  return (
    <section aria-labelledby="depot-crew-availability-heading" className="min-w-0 animate-rise">
      <SectionLabel
        id="depot-crew-availability-heading"
        label="Crew availability"
        note="Slots by role, today"
      />
      <p
        role="status"
        data-testid="crew-coverage-line"
        className="mb-1 font-mono text-[15px] leading-snug text-depot-ink sm:text-[17px]"
      >
        {coverageLine(summary, uncovered)}
      </p>
      {summary.shiftsUncovered > 0 ? (
        <p className="depot-prose mb-4" data-testid="crew-shortfall-explanation">
          {SHORTFALL_EXPLANATION}
        </p>
      ) : (
        <div className="mb-4" />
      )}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {ROLES.map(({ role, title }) => (
          <RoleBar key={role} role={role} title={title} counts={availability[role]} />
        ))}
      </div>
    </section>
  );
}
