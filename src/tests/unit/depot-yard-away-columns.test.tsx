import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CappedTable, awayColumns, rollColumns } from '@/components/depot/yard/YardTables';
import type { AwayRow, RollRow } from '@/lib/depot/yard/yardRollModel';
import { showAtYardFor } from '@/lib/depot/yard/yardTableLayout';

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const away = (registration: string, atYard: string): AwayRow =>
  ({ registration, state: 'standing', km: '2.0', notHeard: '5 min', atYard }) as AwayRow;

const headers = (): string[] =>
  [...host.querySelectorAll('thead th')].map((th) => (th.textContent ?? '').trim());

describe('the away list', () => {
  it('hides "In the yard of" while every row shown is a dash, and shows it once Show all reveals one', () => {
    const rows = [away('UP1', ''), away('UP2', ''), away('UP3', 'Kaiserbagh')];
    act(() =>
      root.render(
        <CappedTable
          columns={(visible: readonly AwayRow[]) => awayColumns('20', showAtYardFor(visible))}
          rows={rows}
          rowKey={(r) => r.registration}
          caption="Nearest buses away from the yard"
          cap={2}
        />,
      ),
    );
    expect(headers().some((h) => h.startsWith('In the yard of'))).toBe(false);
    const showAll = [...host.querySelectorAll('button')].find((b) =>
      /show all/i.test(b.textContent ?? ''),
    );
    act(() => showAll?.click());
    expect(headers().some((h) => h.startsWith('In the yard of'))).toBe(true);
  });

  it('keeps REGISTRATION · STATE · FROM YARD on a phone, with table links', () => {
    act(() =>
      root.render(
        <CappedTable
          columns={awayColumns('20', true, 'phone')}
          rows={[away('UP1', 'Kaiserbagh')]}
          rowKey={(r) => r.registration}
          caption="Nearest buses away from the yard"
          cap={5}
        />,
      ),
    );
    expect(headers()).toEqual(['Registration', 'State', 'From yard km']);
    expect(host.querySelector('tbody a')?.className).toContain('depot-table-link');
  });

  it('drops REASON on a phone and keeps a differing reason in the row title', () => {
    const columns = rollColumns('20', true, 'phone');
    expect(columns.map((c) => c.key)).toEqual(['registration', 'notHeard']);
    const row = { registration: 'UP9', reason: 'stopped on route' } as RollRow;
    expect(columns[0]?.title?.(row)).toBe('UP9; stopped on route');
  });
});
