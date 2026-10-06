import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Checkbox, Select } from '@/components/depot/shell/Controls';

afterEach(cleanup);

describe('themed controls wrap the native elements', () => {
  it('Checkbox is a labelled native checkbox', () => {
    const change = vi.fn();
    render(<Checkbox label="Only buses in the yard" checked={false} onChange={change} />);
    const box = screen.getByRole('checkbox', { name: 'Only buses in the yard' });
    expect(box.className).toContain('depot-checkbox');
    fireEvent.click(box);
    expect(change).toHaveBeenCalledOnce();
  });

  it('Select is a labelled native select, with a hidden label when asked', () => {
    const change = vi.fn();
    render(
      <Select label="Peer group" hideLabel value="b" onChange={change}>
        <option value="a">All</option>
        <option value="b">Large</option>
      </Select>,
    );
    const select = screen.getByRole('combobox', { name: 'Peer group' });
    expect(select.className).toContain('depot-select');
    expect(screen.getByText('Peer group').className).toBe('sr-only');
    fireEvent.change(select, { target: { value: 'a' } });
    expect(change).toHaveBeenCalledOnce();
  });
});
