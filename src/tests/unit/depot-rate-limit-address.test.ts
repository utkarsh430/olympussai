import { describe, expect, it } from 'vitest';
import { requestAddress } from '@/lib/depot/rateLimit';

const ENV = { DEPOT_TRUSTED_IP_HEADER: 'x-real-ip' };
const addressOf = (value: string): string | null =>
  requestAddress(new Headers({ 'x-real-ip': value }), ENV);

describe('the trusted client address as a limiter key', () => {
  it('keeps an IPv4 address as it is', () => {
    expect(addressOf('203.0.113.7')).toBe('203.0.113.7');
  });

  it('keys an IPv6 address on its /64, however it is written', () => {
    const key = addressOf('2001:db8:1:2:aaaa:bbbb:cccc:dddd');
    expect(key).toBe('2001:db8:1:2::/64');
    expect(addressOf('2001:0DB8:0001:0002:0:0:0:1')).toBe(key);
    expect(addressOf('2001:db8:1:2::9')).toBe(key);
    expect(addressOf('2001:db8:1:3::9')).not.toBe(key);
    expect(addressOf('::1')).toBe('0:0:0:0::/64');
    expect(addressOf('2001:db8::')).toBe('2001:db8:0:0::/64');
  });

  it('treats an IPv4-mapped IPv6 address as the IPv4 address', () => {
    expect(addressOf('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(addressOf('::FFFF:cb00:7107')).toBe('203.0.113.7');
  });

  it('falls back exactly as before for malformed values', () => {
    expect(addressOf('not-an-address')).toBeNull();
    expect(addressOf('')).toBeNull();
    // Passes the character check but is not a parseable address: kept as written, as before.
    expect(addressOf('1:2:3')).toBe('1:2:3');
    expect(addressOf('1::2::3')).toBe('1::2::3');
    expect(addressOf('999.1.1.1')).toBe('999.1.1.1');
  });

  it('still reads only the last entry of a list', () => {
    expect(addressOf('198.51.100.1, 2001:db8:1:2::9')).toBe('2001:db8:1:2::/64');
  });
});
