import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatePanel } from '@/components/depot/shell/StatePanel';

afterEach(cleanup);

/** StatePanel: one sentence, one muted line, one action. */
describe('StatePanel forms', () => {
  it('fits its text when no footprint is given', () => {
    render(<StatePanel kind="not-established" sentence="No yard is established yet." />);
    const panel = screen.getByTestId('depot-state-not-established');
    expect(panel.style.minHeight).toBe('');
    expect(panel.className).toContain('py-3');
    expect(panel.className).not.toContain('justify-center');
  });

  it('centres its text in the footprint of what it replaces', () => {
    render(<StatePanel kind="no-data" sentence="No positions." minHeight={460} />);
    const panel = screen.getByTestId('depot-state-no-data');
    expect(panel.style.minHeight).toBe('460px');
    expect(panel.className).toContain('justify-center');
  });

  it('puts the second line in the muted note face', () => {
    render(
      <StatePanel
        kind="empty"
        sentence="No duty today."
        remedy="Duties appear when the feed carries a schedule."
      />,
    );
    expect(screen.getByText('Duties appear when the feed carries a schedule.').className).toContain(
      'depot-note',
    );
  });

  it('links to the closing disclosure by id', () => {
    render(
      <StatePanel
        kind="not-established"
        sentence="No yard is established yet: too few parked buses report a position together."
        howLink={{ label: 'How a yard is found', targetId: 'how-produced' }}
      />,
    );
    const link = screen.getByRole('link', { name: /How a yard is found/ });
    expect(link.getAttribute('href')).toBe('#how-produced');
    expect(link.textContent).toContain('›');
  });

  it('has a compact one-line form with a status square for a nil state inside a section', () => {
    render(<StatePanel kind="empty" compact tone="ok" sentence="No shifts are uncovered" />);
    const line = screen.getByTestId('depot-state-empty');
    expect(line.tagName).toBe('P');
    expect(line.className).toContain('depot-note');
    expect(line.className).not.toContain('depot-panel');
    expect(line.querySelector('[data-testid="depot-state-square"]')?.className).toContain(
      'bg-alert-green',
    );
    expect(line.textContent).toBe('No shifts are uncovered');
  });
});
