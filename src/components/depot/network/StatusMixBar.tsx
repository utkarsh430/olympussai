import { BUS_STATE_LABEL } from '@/lib/depot/labels';
import type { BusOpState, StateMix, StatusMix } from '@/lib/depot/types';
import { BUS_STATE_SQUARE } from '@/components/depot/shell/BusStateMark';

export interface MixSegment {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  /** Tailwind background class. Status colours keep their meaning; the label carries it too. */
  readonly tone: string;
}

/** Upstream `vehicle_status`, exactly as the feed reports it. */
export function statusSegments(status: StatusMix): MixSegment[] {
  return [
    { key: 'live', label: 'Live', count: status.live, tone: 'bg-alert-green' },
    { key: 'stationary', label: 'Stationary', count: status.stationary, tone: 'bg-depot-muted' },
    { key: 'noSignal', label: 'No signal', count: status.noSignal, tone: 'bg-alert-crimson' },
    {
      key: 'underMaintenance',
      label: 'Maintenance',
      count: status.underMaintenance,
      tone: 'bg-alert-amber',
    },
    { key: 'unknown', label: 'Unknown', count: status.unknown, tone: 'bg-depot-faint/60' },
  ];
}

/**
 * Inferred operational state; sums to the depot's fleet. Each segment takes its state's
 * square colour (`BUS_STATE_SQUARE`), so a state is the same colour in this bar as in the
 * figure band, the legend and the yard map on every page.
 */
export function stateSegments(states: StateMix): MixSegment[] {
  const segment = (key: keyof StateMix, state: BusOpState): MixSegment => ({
    key,
    label: BUS_STATE_LABEL[state],
    count: states[key],
    tone: BUS_STATE_SQUARE[state],
  });
  return [
    segment('inService', 'in_service'),
    segment('onRoad', 'on_road'),
    segment('standing', 'standing'),
    segment('dark', 'dark'),
    segment('offRoad', 'off_road'),
  ];
}

/** The mix in words, for screen readers and for anyone who cannot tell the colours apart. */
export function describeMix(segments: readonly MixSegment[]): string {
  return segments.map((segment) => `${segment.label} ${segment.count}`).join(', ');
}

export interface StatusMixBarProps {
  readonly segments: readonly MixSegment[];
  /** Prefix for the text alternative, e.g. "Status of 142 buses". */
  readonly caption: string;
  readonly width?: number;
}

const DEFAULT_WIDTH_PX = 96;

/**
 * A 4px stacked bar of a depot's mix, segments split by a 1px gap. Purely a
 * glance aid: the same numbers are in words in its accessible name and title.
 */
export function StatusMixBar({ segments, caption, width = DEFAULT_WIDTH_PX }: StatusMixBarProps) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.count), 0);
  const text = `${caption}: ${describeMix(segments)}`;

  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      data-testid="depot-status-mix"
      className="inline-flex h-1 gap-px overflow-hidden rounded-[1px] bg-depot-raised align-middle"
      style={{ width }}
    >
      {total > 0
        ? segments
            .filter((segment) => segment.count > 0)
            .map((segment) => (
              <span
                key={segment.key}
                className={`h-full ${segment.tone}`}
                style={{ flexGrow: segment.count, flexBasis: 0 }}
              />
            ))
        : null}
    </span>
  );
}
