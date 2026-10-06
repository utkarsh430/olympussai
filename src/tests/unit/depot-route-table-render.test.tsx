import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RouteTable } from '@/components/depot/routes/RouteTable';
import { DEFAULT_ROUTES_QUERY } from '@/lib/depot/routes/routeQuery';
import { ROUTES_FIXTURE, ROUTE_FIXTURE } from './depot-routes.fixtures';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const noop = () => {};

function markup(query = DEFAULT_ROUTES_QUERY, data = ROUTES_FIXTURE): string {
  return renderToStaticMarkup(
    <RouteTable data={data} query={query} onQueryChange={noop} onOpenRoute={noop} />,
  );
}

describe('the route table as drawn', () => {
  it('puts the TRIPS/DAY tag right after its label, inside the same right-aligned cell', () => {
    const html = markup();
    const th = html.slice(html.indexOf('Trips/day') - 400, html.indexOf('</th>', html.indexOf('Trips/day')));
    const cell = th.slice(th.lastIndexOf('<th'));
    expect(cell).toContain('depot-align-right');
    expect(cell).toMatch(/<span class="inline-flex[^"]*"><button[^>]*>Trips\/day.*<\/button><span[^>]*data-provenance="modelled"/);
  });

  it('draws CLASS and LATE only from 1024 px, the 800 set everywhere', () => {
    const html = markup();
    const head = html.slice(html.indexOf('<thead'), html.indexOf('</thead>'));
    const classCell = head.slice(head.lastIndexOf('<th', head.indexOf('>Class<')), head.indexOf('>Class<'));
    expect(classCell).toContain('hidden lg:table-cell');
    const routeCell = head.slice(head.indexOf('<th'), head.indexOf('>Route<'));
    expect(routeCell).not.toContain('hidden');
  });

  it('styles route and depot names as table links, with no standing underline', () => {
    const html = markup();
    expect(html).toContain('depot-table-link');
    expect(html).not.toMatch(/class="depot-link[ "]/);
  });

  it('shows the pager, the list\'s only count, on a filtered list of one page (R2-m20)', () => {
    const one = { ...ROUTES_FIXTURE, routes: [ROUTE_FIXTURE], total: 1, offset: 0 };
    expect(markup(DEFAULT_ROUTES_QUERY, one)).not.toMatch(/Rows 1 to 1 of 1/);
    expect(markup({ ...DEFAULT_ROUTES_QUERY, q: 'BSI' }, one)).toMatch(/Rows 1 to 1 of 1/);
  });

  it('never puts an ISO date in its text or attributes', () => {
    expect(markup()).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
