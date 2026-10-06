import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Checkbox, FilterRow, SearchField, Select } from '@/components/depot/shell/Controls';

afterEach(cleanup);

/** One filter-row pattern. */
describe('FilterRow', () => {
  it('lays its controls out in one wrapping row, named for assistive technology', () => {
    render(
      <FilterRow label="Filter depots">
        <SearchField label="Search depots" value="" onChange={() => {}} />
        <Select label="Peer group" value="all" onChange={() => {}}>
          <option value="all">All</option>
        </Select>
        <Checkbox label="Show unranked" />
      </FilterRow>,
    );
    const row = screen.getByRole('group', { name: 'Filter depots' });
    expect(row.className).toContain('flex-wrap');
  });

  it('puts each label inline at the left of its 32px control', () => {
    const onChange = vi.fn();
    render(<SearchField label="Search depots" value="" onChange={onChange} />);
    const input = screen.getByLabelText('Search depots');
    expect(input.className).toContain('depot-control');
    expect(screen.getByText('Search depots').className).toContain('depot-label');
    fireEvent.change(input, { target: { value: 'pra' } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('draws the select at the same 32px control height', () => {
    render(
      <Select label="Depot" value="a" onChange={() => {}}>
        <option value="a">A</option>
      </Select>,
    );
    expect(screen.getByLabelText('Depot').className).toContain('depot-control');
  });
});
