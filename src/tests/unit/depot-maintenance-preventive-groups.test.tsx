import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PreventiveSection } from '@/components/depot/maintenance/PreventiveSection';
import type { MaintenanceResponse } from '@/lib/depot/maintenance/api';

/* Each capped group ends in its own "Show all N ›", never two
 * in one footer line; the group rows keep "Modelled overdue · N" (the status's own word). */

const bus = (i: number, group: 'overdue' | 'due_soon', km: number) => ({
  registrationNumber: `UP32A${String(i).padStart(4, '0')}`,
  serviceClass: 'ordinary',
  ageYears: 9,
  odometerKm: 90_000 + i,
  lastServiceKm: 80_000,
  intervalKm: 10_000,
  kmToNextService: km,
  group,
});

const PREVENTIVE = {
  provenance: 'modelled',
  dueSoonWithinKm: 1500,
  counts: { overdue: 7, due_soon: 6, not_due: 0 },
  buses: [
    ...Array.from({ length: 7 }, (_, i) => bus(i, 'overdue', -100 - i)),
    ...Array.from({ length: 6 }, (_, i) => bus(20 + i, 'due_soon', 100 + i)),
  ],
} as unknown as MaintenanceResponse['preventive'];

describe('the preventive groups', () => {
  it('puts one Show all N under each capped group, as that group\'s last row', () => {
    const markup = renderToStaticMarkup(<PreventiveSection depotId="20" preventive={PREVENTIVE} />);
    const page = new DOMParser().parseFromString(markup, 'text/html');
    const groups = [...page.querySelectorAll('[data-testid="depot-preventive-group"]')];
    expect(groups).toHaveLength(2);
    const shown = groups.map((g) => ({
      label: g.querySelector('[data-testid="depot-table-group"]')?.textContent,
      rows: g.querySelectorAll('tbody tr:not([data-testid="depot-table-group"])').length,
      showAll: [...g.querySelectorAll('button.depot-show-all')].map((b) => b.textContent),
      last: g.lastElementChild?.textContent,
    }));
    expect(shown[0]?.label).toMatch(/^Modelled overdue · 7$/i);
    expect(shown[1]?.label).toMatch(/^Modelled due soon · 6$/i);
    expect(shown.map((s) => s.showAll)).toEqual([['Show all 7›'], ['Show all 6›']]);
    expect(shown.map((s) => s.last)).toEqual(['Show all 7›', 'Show all 6›']);
    // the per-figure km title says it is modelled and not a workshop record
    const titles = [...page.querySelectorAll('td span[title]')].map((s) => s.getAttribute('title'));
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.every((t) => t?.endsWith('not a workshop record'))).toBe(true);
    expect(markup).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
