import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Pager, ShowAllButton, ShowMore } from '@/components/depot/shell/LongLists';

afterEach(cleanup);

/** One pager and one "Show all". */
describe('Pager', () => {
  it('prints the only count on the page, with thousands separators, in mono', () => {
    render(<Pager page={0} total={1936} onPage={() => {}} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Rows 1 to 25 of 1,936');
    expect(screen.getByTestId('depot-pager').className).toContain('font-mono');
  });

  it('says No rows for an empty list', () => {
    render(<Pager page={0} total={0} onPage={() => {}} />);
    expect(screen.getByRole('status').textContent).toBe('No rows');
  });
});

describe('Show all', () => {
  it('ShowMore draws one quiet text button with the chevron', () => {
    render(
      <ShowMore
        items={['a', 'b', 'c', 'd', 'e', 'f', 'g']}
        itemKey={(item) => item}
        renderItem={(item) => item}
        label="Buses"
      />,
    );
    const button = screen.getByRole('button', { name: 'Show all 7' });
    expect(button.className).toContain('depot-show-all');
    expect(button.className).not.toContain('depot-filter-button');
    expect(button.querySelector('[data-testid="depot-disclosure-chevron"]')).not.toBeNull();
  });

  it('ShowAllButton serves a capped table or list the page holds itself', () => {
    const onToggle = vi.fn();
    render(<ShowAllButton total={1271} expanded={false} onToggle={onToggle} controls="routes" />);
    const button = screen.getByRole('button', { name: 'Show all 1,271' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe('routes');
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('reads Show fewer once open', () => {
    render(<ShowAllButton total={82} expanded onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: 'Show fewer' })).not.toBeNull();
  });
});
