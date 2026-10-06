import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DepotScopeIdProvider } from '@/components/depot/shell/DepotEyebrow';
import { PageHeader } from '@/components/depot/shell/PageHeader';

vi.mock('@/components/depot/data/DepotNetworkProvider', () => ({
  useDepotNetworkContext: (): unknown => ({
    data: {
      depots: [{ id: '49', name: 'KAUSHAMBI' }],
      source: 'live',
      stale: false,
      feedNow: '2026-10-06T12:36:00Z',
    },
    error: null,
  }),
}));

afterEach(cleanup);

describe('PageHeader anatomy', () => {
  it('names the depot above the title inside a depot scope', () => {
    render(
      <DepotScopeIdProvider depotId="49">
        <PageHeader title="Crew" description="One sentence." />
      </DepotScopeIdProvider>,
    );
    const header = screen.getByTestId('depot-page-header');
    expect(header.firstElementChild?.textContent).toBe('KAUSHAMBI');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('shows no label on a network page, and an explicit eyebrow wins', () => {
    const { rerender } = render(<PageHeader title="League" description="x" />);
    expect(screen.getByTestId('depot-page-header').firstElementChild?.tagName).toBe('DIV');
    rerender(<PageHeader title="League" description="x" eyebrow="Network" />);
    expect(screen.getByText('Network').className).toContain('depot-eyebrow');
  });

  it('renders the provenance line with its link for a modelled page', () => {
    render(
      <PageHeader
        title="Crew"
        description="x"
        provenanceLine={{ default: 'modelled', replacedBy: 'a crew roster and leave feed' }}
        controls={<button type="button">Refresh</button>}
      />,
    );
    const line = screen.getByTestId('depot-provenance-line');
    expect(line.textContent).toContain('MODELLED');
    expect(line.textContent).toContain('Replaced when a crew roster and leave feed is connected.');
    expect(screen.getByRole('link', { name: 'Data sources' }).getAttribute('href')).toBe(
      '/project/depots/sources',
    );
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
  });

  it('keeps the earlier provenance prop and children working', () => {
    render(
      <PageHeader title="League" description="x" provenance="derived">
        <button type="button">Sort</button>
      </PageHeader>,
    );
    expect(screen.getByTestId('depot-header-provenance').textContent).toContain(
      'Derived from the live feed at 12:36',
    );
    expect(screen.getByRole('button', { name: 'Sort' })).toBeTruthy();
  });
});
