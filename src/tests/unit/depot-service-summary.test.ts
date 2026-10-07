import { describe, expect, it } from 'vitest';
import { depotPeakWords, nextPeakSummary, serviceHref } from '@/lib/depot/service/serviceSummary';
import { networkHourlyFixture } from './depot-service-network-response';

describe('the network hours in one line', () => {
  it('counts the routes short at the peak now or next', () => {
    const body = networkHourlyFixture({ nextPeak: 'morning_peak' });
    expect(nextPeakSummary(body)).toEqual({ short: 1, routes: 3, peak: 'morning peak' });
  });

  it('says it for one depot', () => {
    expect(depotPeakWords({ short: 2, routes: 14, peak: 'evening peak' })).toBe(
      'of this depot’s 14 routes short at the next peak (evening peak)',
    );
    expect(depotPeakWords({ short: 0, routes: 1, peak: 'evening peak' })).toContain('1 route short');
  });

  it('links to the page, filtered to a well-formed depot only', () => {
    expect(serviceHref(null)).toBe('/project/depots/service');
    expect(serviceHref('12')).toBe('/project/depots/service?depot=12');
    expect(serviceHref('../x')).toBe('/project/depots/service');
  });
});
