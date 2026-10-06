import type { NextRequest } from 'next/server';
import { jsonResponse } from '@/lib/upsrtc/respond';
import { requireUpsrtcAccess, unauthorizedResponse } from '@/lib/auth/authorize';
import { z } from 'zod';
import { isValidRegistrationNumber } from '@/lib/upsrtc/client';
import { fetchBusSchedule } from '@/lib/upsrtc/scheduleService';
import type { ScheduleResponse } from '@/models/canonical';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const querySchema = z.object({
  regNum: z
    .string()
    .min(4)
    .max(16)
    .refine(isValidRegistrationNumber, { message: 'Malformed registration number' }),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
    .optional(),
  /** Live vehicle_journey_id, used to pick the running trip out of the day's list. */
  tripId: z.string().min(1).max(32).optional(),
});

export async function GET(request: NextRequest): Promise<Response> {
  // Independent authorization check — never rely on middleware alone.
  const session = await requireUpsrtcAccess();
  if (!session) return unauthorizedResponse();

  const acceptEncoding = request.headers.get('accept-encoding');
  const { searchParams } = new URL(request.url);

  const parsed = querySchema.safeParse({
    regNum: searchParams.get('regNum') ?? '',
    date: searchParams.get('date') ?? undefined,
    tripId: searchParams.get('tripId') ?? undefined,
  });

  if (!parsed.success) {
    return jsonResponse({
        schedule: null,
        fetchedAt: new Date().toISOString(),
        source: 'live' as const,
        stale: false,
        message: parsed.error.issues[0]?.message ?? 'Invalid request',
      } satisfies ScheduleResponse, { status: 400, acceptEncoding });
  }

  const response = await fetchBusSchedule({
    regNum: parsed.data.regNum.toUpperCase(),
    date: parsed.data.date ?? null,
    tripId: parsed.data.tripId ?? null,
  });
  return jsonResponse(response, { acceptEncoding });
}
