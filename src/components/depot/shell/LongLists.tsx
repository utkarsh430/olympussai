'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { formatCount } from '@/lib/depot/format';
import { GROUP_PREVIEW_ROWS, pageRange, visibleRows } from '@/lib/depot/listPaging';

export interface ShowMoreProps<T> {
  readonly items: readonly T[];
  readonly renderItem: (item: T, index: number) => React.ReactNode;
  /** A stable key per item. */
  readonly itemKey: (item: T) => string;
  readonly limit?: number;
  /** Names the list for screen readers. */
  readonly label: string;
}

/**
 * A capped list: the first five rows, then "Show all N" as a real button with
 * `aria-expanded` (and "Show fewer" once open). Use for a secondary list inside a page.
 */
export function ShowMore<T>({ items, renderItem, itemKey, limit = GROUP_PREVIEW_ROWS, label }: ShowMoreProps<T>) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const shown = visibleRows(items, expanded, limit);
  return (
    <div className="min-w-0">
      <ul id={listId} aria-label={label} className="min-w-0">
        {shown.map((item, index) => (
          <li key={itemKey(item)} className="min-w-0 border-b border-depot-line last:border-b-0">
            {renderItem(item, index)}
          </li>
        ))}
      </ul>
      {items.length > limit ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((open) => !open)}
          className="depot-filter-button mt-2"
        >
          {expanded ? 'Show fewer' : `Show all ${formatCount(items.length)}`}
        </button>
      ) : null}
    </div>
  );
}

export interface ListGroup<T> {
  readonly key: string;
  readonly heading: string;
  readonly items: readonly T[];
}

export interface GroupedListProps<T> extends Omit<ShowMoreProps<T>, 'items' | 'label'> {
  readonly groups: readonly ListGroup<T>[];
  readonly headingLevel?: 3 | 4;
}

/** A long list grouped by kind: each group's heading with its count, five rows, "Show all N". */
export function GroupedList<T>({ groups, headingLevel = 3, ...rest }: GroupedListProps<T>) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="depot-grouped-list">
      {groups.map((group) => (
        <section key={group.key} className="min-w-0">
          <Heading className="depot-label mb-1">
            {group.heading} · <span className="tabular-nums">{formatCount(group.items.length)}</span>
          </Heading>
          <ShowMore {...rest} items={group.items} label={group.heading} />
        </section>
      ))}
    </div>
  );
}

export interface PagerProps {
  /** Zero-based page. */
  readonly page: number;
  readonly total: number;
  readonly pageSize?: number;
  readonly onPage: (page: number) => void;
}

/**
 * Previous and Next for a list that pages at 25, with the range in words as a status
 * line. When a press disables the button that had focus (the first or last page),
 * focus moves to the status line so it is never lost to the document body.
 */
export function Pager({ page, total, pageSize, onPage }: PagerProps) {
  const range = pageRange(page, total, pageSize);
  const status = useRef<HTMLSpanElement>(null);
  const [moveFocus, setMoveFocus] = useState(false);

  useEffect(() => {
    if (!moveFocus) return;
    status.current?.focus();
    setMoveFocus(false);
  }, [moveFocus, range.page]);

  const go = (next: number, disablesSelf: boolean): void => {
    if (disablesSelf) setMoveFocus(true);
    onPage(next);
  };

  return (
    <nav aria-label="Pages" className="mt-3 flex flex-wrap items-center gap-3" data-testid="depot-pager">
      <button
        type="button"
        disabled={!range.hasPrevious}
        onClick={() => go(range.page - 1, range.page - 1 === 0)}
        className="depot-filter-button disabled:cursor-not-allowed disabled:opacity-40"
      >
        Previous
      </button>
      <span ref={status} tabIndex={-1} role="status" className="font-mono text-[13px] tabular-nums text-depot-muted">
        {range.words}
      </span>
      <button
        type="button"
        disabled={!range.hasNext}
        onClick={() => go(range.page + 1, range.page + 1 === range.pageCount - 1)}
        className="depot-filter-button disabled:cursor-not-allowed disabled:opacity-40"
      >
        Next
      </button>
    </nav>
  );
}
