import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BusExceptionTable } from '@/components/depot/exceptions/BusExceptionTable';
import type { BusException } from '@/lib/depot/exceptions/types';

/*
 * The exceptions page's bus table beside the feed's clock: a bus last heard on an
 * earlier day than the feed's carries that day, so it never reads as a time later than now.
 */

const FEED_NOW = '2026-10-06T19:16:00Z';

function bus(registrationNumber: string, lastSeen: string): BusException {
  return {
    id: registrationNumber,
    kind: 'power_cut',
    severity: 'warning',
    depotId: 'd1',
    depotName: 'KAUSHAMBI',
    registrationNumber,
    detail: null,
    lastSeen,
  } as unknown as BusException;
}

function textOf(markup: string): string {
  return markup.replace(/<[^>]*>/g, ' ');
}

describe('bus exception table last-seen times', () => {
  it('gives a report from the previous day its day, and a report from today its bare time', () => {
    const rows = [bus('UP13T7118', '2026-10-05T21:50:00Z'), bus('UP13T0001', '2026-10-06T18:02:00Z')];
    const text = textOf(renderToStaticMarkup(<BusExceptionTable rows={rows} feedNow={FEED_NOW} />));
    expect(text).toContain('5 Oct, 21:50');
    expect(text).toContain('18:02');
    expect(text).not.toMatch(/(?<!, )21:50/);
  });
});
