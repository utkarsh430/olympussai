import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { GroupedList, Pager } from '@/components/depot/shell/LongLists';
import { pageRange, visibleRows } from '@/lib/depot/listPaging';

afterEach(cleanup);

describe('listPaging', () => {
  it('caps a list until it is expanded', () => {
    expect(visibleRows([1, 2, 3, 4, 5, 6, 7], false, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(visibleRows([1, 2, 3, 4, 5, 6, 7], true, 5)).toHaveLength(7);
  });

  it('says the range in words and clamps the page', () => {
    expect(pageRange(1, 132).words).toBe('Rows 26 to 50 of 132');
    expect(pageRange(9, 132)).toMatchObject({ page: 5, words: 'Rows 126 to 132 of 132', hasNext: false });
    expect(pageRange(0, 0)).toMatchObject({ words: 'No rows', hasPrevious: false, hasNext: false });
  });
});

describe('GroupedList', () => {
  it('heads each group with its count and shows all on a real button', () => {
    const items = Array.from({ length: 8 }, (_, i) => `bus ${i}`);
    render(
      <GroupedList
        groups={[{ key: 'dark', heading: 'Dark', items }]}
        itemKey={(item) => item}
        renderItem={(item) => item}
      />,
    );
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('Dark · 8');
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    const button = screen.getByRole('button', { name: 'Show all 8' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });
});

function PagerHarness({ total }: { readonly total: number }) {
  const [page, setPage] = useState(0);
  return <Pager page={page} total={total} onPage={setPage} />;
}

describe('Pager', () => {
  it('moves focus to the status line when Next disables itself on the last page', () => {
    render(<PagerHarness total={40} />);
    const next = screen.getByRole('button', { name: 'Next' });
    next.focus();
    fireEvent.click(next);
    expect(next).toHaveProperty('disabled', true);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Rows 26 to 40 of 40');
    expect(document.activeElement).toBe(status);
  });

  it('keeps focus on Next while more pages follow', () => {
    render(<PagerHarness total={80} />);
    const next = screen.getByRole('button', { name: 'Next' });
    next.focus();
    fireEvent.click(next);
    expect(document.activeElement).toBe(next);
    expect(screen.getByRole('status').textContent).toBe('Rows 26 to 50 of 80');
  });
});
