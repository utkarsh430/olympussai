import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BusExceptionTable } from '@/components/depot/exceptions/BusExceptionTable';
import type { BusException, ExceptionSeverity } from '@/lib/depot/exceptions/types';

function bus(id: string, kind: string, severity: ExceptionSeverity): BusException {
  return {
    id,
    kind,
    severity,
    depotId: 'd1',
    depotName: 'KAUSHAMBI',
    registrationNumber: id,
    detail: null,
    lastSeen: '2026-10-06T18:02:00Z',
  } as unknown as BusException;
}

/** Each group row's class list, keyed by its words. */
function groupRows(markup: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const m of markup.matchAll(/<th scope="colgroup"[^>]*class="([^"]*)"[^>]*>([^<]*)</g)) {
    found.set(m[2] as string, m[1] as string);
  }
  return found;
}

describe('the bus exception table group rows', () => {
  it('prints each group in its severity colour, so CRITICAL is never cyan', () => {
    const rows = [bus('A', 'emergency', 'critical'), bus('B', 'power_cut', 'warning')];
    const markup = renderToStaticMarkup(
      <BusExceptionTable rows={rows} feedNow="2026-10-06T19:16:00Z" />,
    );
    const groups = [...groupRows(markup).entries()];
    const critical = groups.find(([text]) => text.endsWith('CRITICAL'));
    const warning = groups.find(([text]) => text.endsWith('WARNING'));
    expect(critical?.[1]).toContain('text-alert-crimson');
    expect(warning?.[1]).toContain('text-alert-amber');
  });
});
