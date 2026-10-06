import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RosterFilters } from '@/components/depot/roster/RosterFilters';
import { DEFAULT_ROSTER_FILTERS } from '@/lib/depot/roster/rosterModel';

afterEach(cleanup);

/** The field's 13 px mono (0.6 em a glyph), its 8 px padding a side and 1 px borders. */
const MONO_13_ADVANCE_PX = 13 * 0.6;
const FIELD_INSET_PX = 2 * 8 + 2 * 1;
/** Room the browser keeps at a search field's end for its clear button. */
const CLEAR_BUTTON_PX = 24;

function field(): HTMLInputElement {
  render(
    <RosterFilters
      filters={DEFAULT_ROSTER_FILTERS}
      counts={{ in_service: 4, on_road: 51, standing: 98, dark: 36, off_road: 10 }}
      onChange={() => {}}
    />,
  );
  return screen.getByRole('searchbox', { name: 'Search registration or route' }) as HTMLInputElement;
}

describe('the roster search field', () => {
  it('keeps its accessible name', () => {
    expect(field()).toBeTruthy();
  });

  it('is wide enough to show its whole placeholder', () => {
    const input = field();
    const width = /\bw-\[(\d+)px\]/.exec(input.className)?.[1];
    expect(width, 'a fixed pixel width').toBeDefined();
    const needed =
      input.placeholder.length * MONO_13_ADVANCE_PX + FIELD_INSET_PX + CLEAR_BUTTON_PX;
    expect(Number(width)).toBeGreaterThanOrEqual(needed);
    // It never pushes the row wider than a phone's column.
    expect(input.className).toContain('max-w-full');
  });
});
