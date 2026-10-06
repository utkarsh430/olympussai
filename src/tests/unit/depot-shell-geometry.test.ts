import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BREAKPOINT_PX,
  GUTTER_PX,
  RAIL_WIDTH_PX,
  TABLE_FRAME_BORDER_PX,
  contentWidthAt,
  tableRoomAt,
} from '@/lib/depot/shell/geometry';
import { EXPANDER_WIDTH_PX, tableWidth } from '@/lib/depot/shell/tableWidth';
import { EXPANDER_WIDTH_PX as SHELL_TABLE_EXPANDER_PX } from '@/components/depot/shell/tableLayout';

const SHELL_DIR = join(process.cwd(), 'src/components/depot/shell');
const source = (file: string): string => readFileSync(join(SHELL_DIR, file), 'utf8');

describe('the shell geometry', () => {
  it('leaves the content column the rail and the gutters do not take', () => {
    expect(contentWidthAt(1440)).toBe(1160);
    expect(contentWidthAt(1280)).toBe(1000);
    expect(contentWidthAt(1279)).toBe(1231);
    expect(contentWidthAt(1024)).toBe(976);
    expect(contentWidthAt(800)).toBe(752);
    expect(contentWidthAt(640)).toBe(592);
    expect(contentWidthAt(390)).toBe(358);
    expect(contentWidthAt(360)).toBe(328);
  });

  it('gives a bordered table its frame less the two hairlines', () => {
    expect(tableRoomAt(1440)).toBe(contentWidthAt(1440) - TABLE_FRAME_BORDER_PX);
  });

  it('matches the rail width the navigation is drawn at', () => {
    expect(source('DepotNav.tsx')).toContain(`xl:w-[${RAIL_WIDTH_PX}px]`);
    expect(source('DepotNav.tsx')).toContain('hidden shrink-0');
    expect(BREAKPOINT_PX.xl).toBe(1280);
  });

  it('matches the gutters the main area is drawn with', () => {
    const shell = source('DepotShell.tsx');
    // Tailwind's spacing scale is 4px a step: px-4 is 16px, sm:px-6 is 24px.
    expect(shell).toMatch(new RegExp(`\\bpx-${GUTTER_PX.base / 4}\\b`));
    expect(shell).toContain(`sm:px-${GUTTER_PX.sm / 4}`);
    expect(shell).toContain('xl:flex-row');
  });
});

describe('tableWidth', () => {
  it('sums the named columns', () => {
    expect(tableWidth({ a: 100, b: 50, c: 7 }, ['a', 'b'])).toBe(150);
  });

  it('adds the expander column when the table has one', () => {
    expect(tableWidth({ a: 100 }, ['a'], { expander: true })).toBe(100 + EXPANDER_WIDTH_PX);
  });

  it('throws on a column without a width', () => {
    const widths: Partial<Record<'a' | 'b', number>> = { a: 100 };
    expect(() => tableWidth(widths, ['a', 'b'])).toThrow('table column b has no width');
  });

  it('is the expander width the shared table draws', () => {
    expect(SHELL_TABLE_EXPANDER_PX).toBe(EXPANDER_WIDTH_PX);
  });
});
