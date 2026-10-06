import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmptyState, ErrorPanel, LoadingBlock } from '@/components/depot/shell/DataStates';
import { StatePanel } from '@/components/depot/shell/StatePanel';

afterEach(cleanup);

describe('StatePanel', () => {
  it('says what is absent, what would change it, and offers the action', () => {
    render(
      <StatePanel
        kind="not-ranked"
        sentence="No depot is ranked yet."
        remedy="Ranks appear once 20 buses report."
        action={<a href="/x">See the unranked list</a>}
        rows={4}
      />,
    );
    const panel = screen.getByTestId('depot-state-not-ranked');
    expect(panel.textContent).toContain('No depot is ranked yet.');
    expect(panel.textContent).toContain('Ranks appear once 20 buses report.');
    expect(panel.style.minHeight).toBe(`${4 * 36 + 3 * 8}px`);
    expect(screen.getByRole('link', { name: 'See the unranked list' })).toBeTruthy();
  });

  it('holds a given minimum height for a map or chart', () => {
    render(<StatePanel kind="no-data" sentence="No positions." minHeight={460} />);
    expect(screen.getByTestId('depot-state-no-data').style.minHeight).toBe('460px');
  });
});

describe('the earlier state components, expressed through StatePanel', () => {
  it('LoadingBlock keeps its rows, label and busy status', () => {
    render(<LoadingBlock rows={3} label="Loading the roster" />);
    const block = screen.getByRole('status');
    expect(block.getAttribute('data-testid')).toBe('depot-loading');
    expect(block.getAttribute('aria-busy')).toBe('true');
    expect(block.querySelectorAll('.depot-skeleton')).toHaveLength(3);
    expect(block.textContent).toBe('Loading the roster');
  });

  it('ErrorPanel keeps its title, body, Retry and extra ways out', () => {
    const retry = vi.fn();
    render(
      <ErrorPanel title="Could not load the league" message="Timed out." onRetry={retry}>
        <a href="/project/upsrtc">Operations</a>
      </ErrorPanel>,
    );
    const panel = screen.getByRole('alert');
    expect(panel.getAttribute('data-testid')).toBe('depot-error');
    expect(screen.getByRole('heading', { name: 'Could not load the league' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'Operations' })).toBeTruthy();
  });

  it('EmptyState keeps its test id and sentence', () => {
    render(<EmptyState>No routes in the feed.</EmptyState>);
    expect(screen.getByTestId('depot-empty').textContent).toBe('No routes in the feed.');
  });
});
