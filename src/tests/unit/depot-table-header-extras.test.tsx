import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DataTable, type Column } from '@/components/depot/shell/DataTable';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';

afterEach(cleanup);

interface Row {
  readonly id: string;
  readonly group: string;
  readonly earnings: number;
  readonly trips: number;
}

const COLUMNS: readonly Column<Row>[] = [
  { key: 'id', header: 'Depot', render: (row) => row.id },
  {
    key: 'earnings',
    header: 'Earnings',
    unit: '₹/km',
    align: 'right',
    sortValue: (row) => row.earnings,
    render: (row) => row.earnings.toFixed(2),
  },
  { key: 'trips', header: 'Trips/day', tag: 'modelled', align: 'right', render: (row) => row.trips },
];

const ROWS: readonly Row[] = [
  { id: 'PRAYAG', group: 'Small fleets', earnings: 40.81, trips: 12 },
  { id: 'MEERUT', group: 'Large fleets', earnings: 31.2, trips: 40 },
  { id: 'DHAMPUR', group: 'Small fleets', earnings: 38.36, trips: 9 },
];

/** Tags in the ruled places and units in the header (critique round 4, I and K). */
describe('table header extras', () => {
  it('puts a column tag as a pill inside its header cell', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} caption="Depots" />);
    const header = screen.getByRole('columnheader', { name: /Trips\/day/ });
    const tag = within(header).getByText('MODELLED');
    expect(tag.className).toContain('depot-tag-pill');
  });

  it('shows a column unit in the header, so cells carry bare numbers', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} caption="Depots" />);
    const header = screen.getByRole('columnheader', { name: /Earnings/ });
    expect(within(header).getByText('₹/km')).not.toBeNull();
    expect(screen.getByRole('cell', { name: '40.81' })).not.toBeNull();
  });
});

describe('SectionLabel tag', () => {
  it('draws its tag as a pill after the label', () => {
    render(<SectionLabel label="Night parking order" tag="modelled" />);
    expect(screen.getByText('MODELLED').className).toContain('depot-tag-pill');
  });
});
