'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { formatCount } from '@/lib/depot/format';
import { GROUP_PREVIEW_ROWS, pageRange, visibleRows, type PageRange } from '@/lib/depot/listPaging';
import { DisclosureChevron } from './DisclosureChevron';

export interface ShowMoreProps<T> {
  readonly items: readonly T[];
  readonly renderItem: (item: T, index: number) => React.ReactNode;
  /** A stable key per item. */
  readonly itemKey: (item: T) => string;
  readonly limit?: number;
  /** Names the list for screen readers. */
  readonly label: string;
}

export interface ShowAllButtonProps {
  /** Every row the capped group holds. */
  readonly total: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  /** Id of the list or table it opens. */
  readonly controls?: string;
}

/**
 * The one "Show all N" (design critique round 4, F): a quiet text button with the
 * disclosure chevron, for any capped group. `ShowMore` uses it; a page that caps a table
 * or list itself (the overview's segments, the yard's lists) uses it directly.
 */
export function ShowAllButton({ total, expanded, onToggle, controls }: ShowAllButtonProps) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
      className="depot-show-all"
    >
      {expanded ? 'Show fewer' : `Show all ${formatCount(total)}`}
      <DisclosureChevron open={expanded} />
    </button>
  );
}

/**
 * A capped list: the first five rows, then "Show all N" (`ShowAllButton`), a real
 * button with `aria-expanded`. Use for a secondary list inside a page.
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
        <ShowAllButton
          total={items.length}
          expanded={expanded}
          onToggle={() => setExpanded((open) => !open)}
          controls={listId}
        />
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

export interface PagerProps {
  /** Zero-based page. */
  readonly page: number;
  readonly total: number;
  readonly pageSize?: number;
  readonly onPage: (page: number) => void;
}

/** "Rows 1 to 25 of 1,936": the range in words, with thousands separators. */
function rangeWords(range: PageRange, total: number): string {
  if (range.end === 0) return 'No rows';
  return `Rows ${formatCount(range.start + 1)} to ${formatCount(range.end)} of ${formatCount(total)}`;
}

/**
 * Previous and Next for a list that pages at 25, under the table, mono, with the range
 * in words as a status line. It is the ONLY place a list's "x of y" count appears: a
 * page prints no "Showing 1-25 of N" sentence above the table.
 * When a press disables the button that had focus (the first or last page),
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
    <nav
      aria-label="Pages"
      className="mt-3 flex flex-wrap items-center gap-3 font-mono"
      data-testid="depot-pager"
    >
      <button
        type="button"
        disabled={!range.hasPrevious}
        onClick={() => go(range.page - 1, range.page - 1 === 0)}
        className="depot-filter-button disabled:cursor-not-allowed disabled:opacity-40"
      >
        Previous
      </button>
      <span ref={status} tabIndex={-1} role="status" className="font-mono text-[13px] tabular-nums text-depot-muted">
        {rangeWords(range, Math.max(0, Math.floor(total)))}
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
