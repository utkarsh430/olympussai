'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { RouteDirectionMeta } from '@/models/control';
import { cn } from '@/lib/utils';
import { OpsStatusDot } from '@/components/ops/ui';
import { CORRIDOR_GLOSS, corridorName } from '@/lib/ops/vocabulary';

/**
 * Choosing one corridor out of seven hundred and fifty-nine.
 *
 * ─── WHAT THIS REPLACED, AND WHY IT HAD TO GO ────────────────────────────
 *
 * A native `<select>` holding every mapped corridor. On the live network that
 * is 759 options in one unsearchable drop-down, ordered by route id, of which
 * 198 can report anything at all. Finding corridor 4412 meant scrolling a list
 * as long as a phone book, and the only way to tell a corridor that reports
 * from one that cannot was to read to the end of each line.
 *
 * A native select is genuinely the right control for six options. It is the
 * wrong one for 759, and the difference is not cosmetic: an operator who
 * cannot find a corridor during an incident does not find it.
 *
 * ─── THE THREE THINGS IT CHANGES ─────────────────────────────────────────
 *
 *   1. TYPE TO NARROW. The route id is what an operator knows, so the filter
 *      matches on it (and on the direction word). 759 becomes three.
 *
 *   2. THE ONES THAT CAN REPORT COME FIRST, under their own heading with a
 *      count. This is the honest-data vocabulary applied to a control rather
 *      than to a readout: the console has always marked a non-detecting
 *      corridor BEFORE it is chosen, and grouping states the same fact at the
 *      scale of the list instead of once per line.
 *
 *   3. THE DENOMINATOR SURVIVES. The heading says "198 of 759", never "26%".
 *      A percentage hides the count, and the count is the honest part.
 *
 * ─── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────
 *
 * Hide the 561 corridors that cannot report. They are real corridors carrying
 * real buses; the console simply cannot detect bunching on them. They stay
 * selectable, under a heading that says in words what selecting one will get
 * you. `hasActivePolicy: undefined` means the control service does not report
 * policy state at all — unknown, not false — so those corridors are listed
 * without a claim either way.
 *
 * ─── ACCESSIBILITY ───────────────────────────────────────────────────────
 *
 * A real combobox: `role="combobox"` on the input, `aria-activedescendant`
 * onto the highlighted option, arrow keys and Enter, Escape to close, and the
 * result count announced politely. It is not a div that looks like a select.
 */

/**
 * How many options each GROUP paints before it says how many more it is
 * holding back.
 *
 * ─── WHY PER GROUP AND NOT ONE FLAT BUDGET ───────────────────────────────
 *
 * A single cap across the whole list looked identical in a unit test and was
 * wrong in the browser. The corridors that can report are rendered first, and
 * on the live network there are 198 of them — so a flat budget of 80 was spent
 * entirely on the first group, and the second group rendered its heading
 * ("Cannot report buses closing up · 561") with nothing at all underneath it.
 * The list promised a section it never showed, and the 561 corridors an
 * operator might legitimately want to open were unreachable without guessing a
 * route number.
 *
 * A budget per group keeps both reachable and both counts honest. Caught by
 * opening the real picker in a real browser, which is the only place the
 * interaction between "detecting first" and "cap the list" is visible at all.
 */
const MAX_PER_GROUP = 40;

export interface CorridorPickerProps {
  corridors: readonly RouteDirectionMeta[];
  value: string | null;
  onChange: (routeDirectionId: string) => void;
  /** Visible label. The console's own header already says "Corridor", so it can hide it. */
  label?: string;
  labelHidden?: boolean;
  className?: string;
  /** Rendered under the control while the popover is shut. */
  disabled?: boolean;
}

export function CorridorPicker({
  corridors,
  value,
  onChange,
  label = 'Corridor',
  labelHidden = false,
  className,
  disabled = false,
}: CorridorPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;

  const selected = corridors.find((c) => c.routeDirectionId === value) ?? null;

  const { detecting, blind, matched } = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches =
      needle.length === 0 ? corridors : corridors.filter((c) => searchText(c).includes(needle));
    return {
      detecting: matches.filter((c) => c.hasActivePolicy === true),
      blind: matches.filter((c) => c.hasActivePolicy !== true),
      matched: matches.length,
    };
  }, [corridors, query]);

  // Each group is capped on its own, then concatenated. `flat` is the exact
  // painted order, so arrow keys walk the list the way the eye does — deriving
  // it here rather than in the JSX is what keeps the keyboard index and the
  // rendered rows from ever disagreeing.
  const shownDetecting = useMemo(() => detecting.slice(0, MAX_PER_GROUP), [detecting]);
  const shownBlind = useMemo(() => blind.slice(0, MAX_PER_GROUP), [blind]);
  const flat = useMemo(() => [...shownDetecting, ...shownBlind], [shownDetecting, shownBlind]);
  const hiddenDetecting = detecting.length - shownDetecting.length;
  const hiddenBlind = blind.length - shownBlind.length;

  useEffect(() => setHighlight(0), [query]);

  // Close on an outside pointer or on Escape. Both are registered only while
  // open, so a console with the picker shut carries no document listeners.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Keep the highlighted option in view when the keyboard, rather than the
  // mouse, is doing the walking. Feature-detected: an environment without
  // scrollIntoView (jsdom) must not take the picker down with it.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>('[data-highlighted="true"]');
    if (typeof node?.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  function choose(corridor: RouteDirectionMeta) {
    onChange(corridor.routeDirectionId);
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((h) => Math.min(h + 1, flat.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const corridor = flat[highlight];
      if (corridor) choose(corridor);
    }
  }

  const totalDetecting = corridors.filter((c) => c.hasActivePolicy === true).length;
  const reportsPolicy = corridors.some((c) => c.hasActivePolicy !== undefined);

  return (
    <div ref={rootRef} className={cn('relative min-w-0', className)}>
      <label
        htmlFor={`${baseId}-input`}
        className={cn('ops-eyebrow mb-1 block', labelHidden && 'sr-only')}
      >
        {label}
      </label>

      {open ? (
        <input
          ref={inputRef}
          id={`${baseId}-input`}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            flat[highlight] ? `${baseId}-opt-${flat[highlight].routeDirectionId}` : undefined
          }
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a route number"
          className="ops-input w-full py-1 text-xs"
        />
      ) : (
        <button
          type="button"
          id={`${baseId}-input`}
          disabled={disabled}
          data-testid="corridor-picker-trigger"
          aria-haspopup="listbox"
          aria-expanded={false}
          onClick={() => setOpen(true)}
          className="ops-input flex w-full items-center gap-2 py-1 text-left text-xs disabled:opacity-60"
        >
          <span className="min-w-0 flex-1 truncate">
            {selected ? corridorName(selected) : 'Choose a corridor'}
          </span>
          {selected ? <DetectionMark corridor={selected} /> : null}
          <span aria-hidden className="shrink-0 text-subtle">
            ▾
          </span>
        </button>
      )}

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-border bg-popover shadow-lg">
          <p className="border-b border-border px-3 py-2 text-[11px] leading-snug text-subtle">
            A corridor is {CORRIDOR_GLOSS}.{' '}
            {reportsPolicy
              ? `${totalDetecting} of ${corridors.length} can report buses closing up.`
              : `${corridors.length} corridors. This control service does not say which of them can report buses closing up.`}
          </p>

          <p aria-live="polite" className="sr-only">
            {matched} of {corridors.length} corridors match.
          </p>

          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            className="max-h-80 overflow-y-auto py-1"
          >
            {flat.length === 0 && (
              <li className="px-3 py-4 text-center text-xs text-muted-foreground">
                No corridor matches “{query}”.
              </li>
            )}

            {shownDetecting.length > 0 && (
              <GroupHeading>
                Can report buses closing up · {detecting.length}
                {query.trim() ? ' matching' : ` of ${corridors.length}`}
              </GroupHeading>
            )}
            {shownDetecting.map((corridor) => (
              <Option
                key={corridor.routeDirectionId}
                baseId={baseId}
                corridor={corridor}
                selected={corridor.routeDirectionId === value}
                highlighted={flat[highlight]?.routeDirectionId === corridor.routeDirectionId}
                onHover={() => setHighlight(flat.indexOf(corridor))}
                onChoose={() => choose(corridor)}
              />
            ))}
            {hiddenDetecting > 0 && <MoreInGroup count={hiddenDetecting} />}

            {shownBlind.length > 0 && (
              <GroupHeading>
                {reportsPolicy
                  ? `Cannot report buses closing up · ${blind.length}`
                  : `Detection state not reported · ${blind.length}`}
              </GroupHeading>
            )}
            {shownBlind.length > 0 && (
              <li className="px-3 pb-1 text-[11px] leading-snug text-subtle">
                {reportsPolicy
                  ? 'No planned gap has been set for these, so they can be opened but will show nothing.'
                  : 'This control service does not say whether these can detect, so it is unknown rather than no.'}
              </li>
            )}
            {shownBlind.map((corridor) => (
              <Option
                key={corridor.routeDirectionId}
                baseId={baseId}
                corridor={corridor}
                selected={corridor.routeDirectionId === value}
                highlighted={flat[highlight]?.routeDirectionId === corridor.routeDirectionId}
                onHover={() => setHighlight(flat.indexOf(corridor))}
                onChoose={() => choose(corridor)}
              />
            ))}
            {hiddenBlind > 0 && <MoreInGroup count={hiddenBlind} />}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The tail of a group that is longer than its budget.
 *
 * Says the count rather than trailing off, and says what to do about it. A
 * list that silently stops at row forty is a list an operator believes they
 * have read to the end of.
 */
function MoreInGroup({ count }: { count: number }) {
  return (
    <li className="border-t border-border px-3 py-2 text-[11px] leading-snug text-subtle">
      {count} more not shown here. Type a route number to find {count === 1 ? 'it' : 'one'}.
    </li>
  );
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  // `role="presentation"` because a heading inside a listbox is not an option,
  // and a screen reader walking options must not land on it.
  return (
    <li
      role="presentation"
      className="sticky top-0 bg-popover px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground"
    >
      {children}
    </li>
  );
}

function Option({
  baseId,
  corridor,
  selected,
  highlighted,
  onHover,
  onChoose,
}: {
  baseId: string;
  corridor: RouteDirectionMeta;
  selected: boolean;
  highlighted: boolean;
  onHover: () => void;
  onChoose: () => void;
}) {
  return (
    <li
      id={`${baseId}-opt-${corridor.routeDirectionId}`}
      role="option"
      aria-selected={selected}
      data-highlighted={highlighted}
      onMouseEnter={onHover}
      onClick={onChoose}
      className={cn(
        'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs',
        highlighted && 'bg-accent',
        selected && 'font-semibold text-foreground',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{corridorName(corridor)}</span>
      <DetectionMark corridor={corridor} />
    </li>
  );
}

/**
 * Whether this corridor can report, as a SHAPE and a word rather than a hue.
 *
 * Roughly one in twelve male operators cannot separate this product's
 * good/degraded pair by colour at all, so the dot's shape carries the state
 * and the text beside it carries it again. See OpsStatusDot.
 */
function DetectionMark({ corridor }: { corridor: RouteDirectionMeta }) {
  if (corridor.hasActivePolicy === true) {
    return (
      <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
        <OpsStatusDot variant="live" />
        reports
      </span>
    );
  }
  if (corridor.hasActivePolicy === false) {
    return (
      <span className="flex shrink-0 items-center gap-1 text-[10px] text-subtle">
        <OpsStatusDot variant="neutral" />
        no detection
      </span>
    );
  }
  return null;
}

function searchText(corridor: RouteDirectionMeta): string {
  return corridorName(corridor).toLowerCase();
}
