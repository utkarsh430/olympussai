import { describe, expect, it } from 'vitest';
import { networkHourlyUrl } from '@/hooks/useNetworkHourly';

describe('the network hours URL', () => {
  it('asks for the default band and every depot with no query', () => {
    expect(networkHourlyUrl({ band: null, depotId: null, page: 0 })).toBe('/api/upsrtc/depot/service');
  });

  it('carries a band, a depot and a page past the first', () => {
    expect(networkHourlyUrl({ band: 'midday', depotId: '12', page: 2 })).toBe(
      '/api/upsrtc/depot/service?band=midday&depot=12&page=2',
    );
  });

  it('never sends a hostile value from the address bar', () => {
    const ask = { band: 'night' as never, depotId: '../x', page: -1 };
    expect(networkHourlyUrl(ask)).toBe('/api/upsrtc/depot/service');
  });
});
