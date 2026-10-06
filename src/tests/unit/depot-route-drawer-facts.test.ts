import { describe, expect, it } from 'vitest';
import { LATE_AFTER_MIN } from '@/lib/depot/routes/delayConfig';
import { drawerRowFacts } from '@/lib/depot/routes/routeDrawerModel';
import { ROUTE_FIXTURE } from './depot-routes.fixtures';

describe('the route drawer first line', () => {
  it('says the class, the delay, the late share and the buses they rest on', () => {
    expect(drawerRowFacts(ROUTE_FIXTURE)).toBe(
      `Class ORD. Median delay +4.0 min; 20% more than ${LATE_AFTER_MIN} minutes late, based on 5 of 5 buses.`,
    );
  });

  it('says plainly when no bus gives a usable delay, and when the class is not given', () => {
    const none = {
      ...ROUTE_FIXTURE,
      serviceToken: null,
      delay: { medianMin: null, lateShare: null, coverage: { n: 0, of: 3 } },
    };
    expect(drawerRowFacts(none)).toBe('Class not given. No usable delay from its buses.');
  });
});
