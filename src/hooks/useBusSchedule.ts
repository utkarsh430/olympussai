'use client';

import type { ScheduleResponse } from '@/models/canonical';
import { useFetchedJson, type FetchedState } from '@/hooks/useFetchedJson';

/**
 * One bus's timetable. Pass a null registration for a bus with no route: nothing
 * is fetched. `date` and `tripId` go on the query only when the bus has them, so
 * the service picks the trip the vehicle is actually running.
 */
export function useBusSchedule(
  registration: string | null,
  tripDate: string | null,
  journeyId: string | null,
): FetchedState<ScheduleResponse> {
  let url: string | null = null;
  if (registration) {
    const query = new URLSearchParams({ regNum: registration });
    if (tripDate) query.set('date', tripDate);
    if (journeyId) query.set('tripId', journeyId);
    url = `/api/upsrtc/schedule?${query.toString()}`;
  }
  return useFetchedJson<ScheduleResponse>(url);
}
