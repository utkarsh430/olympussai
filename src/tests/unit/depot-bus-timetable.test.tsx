import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BusTimetable, type BusTimetableProps } from '@/components/depot/roster/BusTimetable';
import type { CanonicalStop, ScheduleResponse } from '@/models/canonical';

const actGlobal = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const originalActFlag = actGlobal.IS_REACT_ACT_ENVIRONMENT;

const stop = (sequence: number, name: string, longitude: number, time: string): CanonicalStop => ({
  id: `s${sequence}`,
  name,
  sequence,
  latitude: 19,
  longitude,
  scheduledArrival: time,
  scheduledDeparture: time,
});

function scheduleFor(names: readonly string[]): ScheduleResponse {
  return {
    fetchedAt: '2026-10-06T08:00:00.000Z',
    source: 'live',
    stale: false,
    schedule: {
      registrationNumber: 'MH12AB1000',
      date: '2026-10-06',
      routeId: 'r',
      routeName: 'Pune - Satara',
      originName: null,
      destinationName: null,
      tripId: null,
      scheduledDeparture: null,
      scheduledArrival: null,
      direction: null,
      tripCount: 1,
      stops: names.map((name, index) => stop(index + 1, name, 73 + index * 0.1, `0${8 + index}:00:00`)),
    },
  };
}

interface Pending {
  readonly url: string;
  readonly resolve: (body: ScheduleResponse) => void;
  readonly fail: () => void;
}
let pending: Pending[] = [];

const BASE: BusTimetableProps = {
  registration: 'MH12AB1000',
  hasRoute: true,
  tripDate: '2026-10-06',
  journeyId: 'trip-1',
  position: { latitude: 19, longitude: 73.02 },
  gpsAgeMin: 2,
  state: 'in_service',
  feedNow: '2026-10-06T08:10:00.000Z',
};

let container: HTMLDivElement;
let root: Root;

async function show(props: BusTimetableProps): Promise<void> {
  await act(async () => {
    root.render(<BusTimetable {...props} />);
  });
}

async function answerLast(body: ScheduleResponse): Promise<void> {
  await act(async () => {
    pending[pending.length - 1]?.resolve(body);
  });
}

beforeEach(() => {
  actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
  pending = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (url: string) =>
        new Promise<Response>((resolve, reject) => {
          pending.push({
            url,
            resolve: (body) =>
              resolve({ ok: true, status: 200, json: async () => body } as unknown as Response),
            fail: () => reject(new TypeError('offline')),
          });
        }),
    ),
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  actGlobal.IS_REACT_ACT_ENVIRONMENT = originalActFlag;
});

const text = (): string => container.textContent ?? '';

describe('BusTimetable refetch for a changed trip', () => {
  it('says the timetable is updating while the kept list stays on screen', async () => {
    await show(BASE);
    await answerLast(scheduleFor(['Pune', 'Wai']));
    expect(text()).not.toContain('Updating the timetable.');

    await show({ ...BASE, journeyId: 'trip-2' });
    expect(text()).toContain('Updating the timetable.');
    expect(text()).toContain('Wai');
  });

  it('shows the error sentence beside the kept stops when the refetch fails', async () => {
    await show(BASE);
    await answerLast(scheduleFor(['Pune', 'Wai']));

    await show({ ...BASE, journeyId: 'trip-2' });
    await act(async () => {
      pending[pending.length - 1]?.fail();
    });
    expect(text()).toContain("Could not reach the server. These are the previous trip's stops.");
    expect(text()).toContain('Wai');
    expect(text()).not.toContain('Updating the timetable.');
  });
});

describe('BusTimetable next-stop notes', () => {
  it('says the position was not used when the fix is not trusted but the timetable answers', async () => {
    await show({ ...BASE, state: 'standing' });
    await answerLast(scheduleFor(['Pune', 'Wai', 'Satara']));
    expect(text()).toContain('Position not used for the next stop: this bus is not in service.');
    expect(text()).toContain('worked out by timetable');
  });

  it('shows no position note for a trusted fix', async () => {
    await show(BASE);
    await answerLast(scheduleFor(['Pune', 'Wai', 'Satara']));
    expect(text()).not.toContain('Position not used');
    expect(text()).toContain('worked out by position');
  });
});

describe('BusTimetable provenance tags', () => {
  it('tags only what differs from the DERIVED page default: the live timetable, never the derived next stop', async () => {
    await show(BASE);
    await answerLast(scheduleFor(['Pune', 'Wai', 'Satara']));
    expect(text()).toContain('worked out by position');
    expect(text()).toContain('LIVE');
    expect(text()).not.toContain('DERIVED');
  });
});
