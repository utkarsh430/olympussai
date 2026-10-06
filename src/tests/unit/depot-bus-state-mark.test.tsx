import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BUS_STATE_SQUARE, BusStateMark } from '@/components/depot/shell/BusStateMark';
import { BUS_STATE_LABEL } from '@/lib/depot/labels';
import type { BusOpState } from '@/lib/depot/types';

afterEach(cleanup);

const STATES = Object.keys(BUS_STATE_LABEL) as BusOpState[];

describe('BusStateMark', () => {
  it.each(STATES)('shows the word from labels.ts beside the square for %s', (state) => {
    render(<BusStateMark state={state} />);
    const mark = screen.getByTestId('depot-bus-state');
    expect(mark.textContent).toBe(BUS_STATE_LABEL[state]);
    expect(mark.querySelector('[aria-hidden]')?.className).toContain(BUS_STATE_SQUARE[state]);
  });

  it('gives every state its own colour', () => {
    expect(new Set(Object.values(BUS_STATE_SQUARE)).size).toBe(STATES.length);
  });

  it('keeps the full label in title when the short word is used', () => {
    render(<BusStateMark state="on_road" short />);
    const mark = screen.getByTestId('depot-bus-state');
    expect(mark.textContent).toBe('On road');
    expect(mark.getAttribute('title')).toBe(BUS_STATE_LABEL.on_road);
  });
});
