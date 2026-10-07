import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProposalsTable } from '@/components/depot/service/ProposalsTable';
import {
  PRINT_BRIEF_ATTR,
  PRINT_KEEP_ATTR,
  SERVICE_PRINT_CSS,
} from '@/components/depot/service/ServicePrintRule';
import { routeHourlyFixture } from './depot-service-fixtures';

describe('the print layout of the brief and the proposals', () => {
  it('applies on paper only, and only where the brief is on the page', () => {
    expect(SERVICE_PRINT_CSS.startsWith('@media print {')).toBe(true);
    expect(SERVICE_PRINT_CSS).toContain(`body:has([${PRINT_BRIEF_ATTR}])`);
  });

  it('keeps the brief, the proposals, what they hold and what holds them; drops their buttons', () => {
    for (const kept of [
      `:not(:is([${PRINT_BRIEF_ATTR}], [${PRINT_KEEP_ATTR}]))`,
      `:not(:is([${PRINT_BRIEF_ATTR}], [${PRINT_KEEP_ATTR}]) *)`,
      `:not(:has([${PRINT_BRIEF_ATTR}], [${PRINT_KEEP_ATTR}]))`,
    ]) {
      expect(SERVICE_PRINT_CSS).toContain(kept);
    }
    expect(SERVICE_PRINT_CSS).toMatch(/button, :is\([^)]*\) input \{ display: none !important; \}/);
  });

  it('marks the proposals section to be kept wherever the table is mounted', () => {
    const day = routeHourlyFixture();
    const markup = renderToStaticMarkup(<ProposalsTable proposals={day.proposals} />);
    expect(markup).toContain(`data-testid="service-proposals" ${PRINT_KEEP_ATTR}=""`);
  });

  it('keeps the table in the page flow, so an opened row and every row of the page print', () => {
    const day = routeHourlyFixture();
    const frame = document.createElement('div');
    frame.innerHTML = renderToStaticMarkup(<ProposalsTable proposals={day.proposals} />);
    expect(frame.querySelector('table')?.closest('.depot-table-flow')).not.toBeNull();
  });
});
