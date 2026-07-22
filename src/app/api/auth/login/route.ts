import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  AuthConfigError,
  getConfiguredProjectName,
  getProjectPinHash,
  normalizeProjectName,
} from '@/lib/auth/config';
import { verifyPin } from '@/lib/auth/password';
import { establishSession } from '@/lib/auth/server';
import {
  checkRateLimit,
  clearFailures,
  clientIpFrom,
  recordFailure,
} from '@/lib/auth/rate-limit';
import { isSameOrigin } from '@/lib/auth/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Single generic message — never reveals which field was wrong (Section 9). */
const INVALID_MESSAGE = 'Invalid project name or PIN.';

const bodySchema = z.object({
  projectName: z.string().min(1).max(64),
  pin: z.string().min(1).max(32),
});

function invalid(status = 401) {
  return NextResponse.json(
    { error: INVALID_MESSAGE },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(request: NextRequest): Promise<Response> {
  // State-changing request: require same-origin.
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: 'Invalid request origin.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Require JSON content type.
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return NextResponse.json(
      { error: 'Unsupported content type.' },
      { status: 415, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return invalid(400);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return invalid(400);
  }

  const submittedProject = normalizeProjectName(parsed.data.projectName);
  const { pin } = parsed.data;

  // Rate-limit key: IP + normalized project name.
  const ip = clientIpFrom(request.headers);
  const rlKey = `${ip}:${submittedProject}`;

  const preCheck = checkRateLimit(rlKey);
  if (preCheck.limited) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again later.' },
      {
        status: 429,
        headers: {
          'Cache-Control': 'no-store',
          'Retry-After': String(preCheck.retryAfterSeconds),
        },
      },
    );
  }

  let expectedProject: string;
  let pinHash: string;
  try {
    expectedProject = getConfiguredProjectName();
    pinHash = getProjectPinHash();
  } catch (error) {
    if (error instanceof AuthConfigError) {
      // Misconfiguration — do not leak which variable, do not enumerate.
      return NextResponse.json(
        { error: 'Authentication is not configured.' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    throw error;
  }

  // Always run the bcrypt comparison, even when the project name is wrong, so
  // response timing does not distinguish "wrong name" from "wrong PIN".
  const pinMatches = await verifyPin(pin, pinHash);
  const projectMatches = submittedProject === expectedProject;

  if (!projectMatches || !pinMatches) {
    const result = recordFailure(rlKey);
    if (result.limited) {
      return NextResponse.json(
        { error: 'Too many attempts. Try again later.' },
        {
          status: 429,
          headers: {
            'Cache-Control': 'no-store',
            'Retry-After': String(result.retryAfterSeconds),
          },
        },
      );
    }
    return invalid();
  }

  clearFailures(rlKey);
  await establishSession(expectedProject);

  // Only safe success information — never the token, hash, or secret.
  return NextResponse.json(
    { ok: true, project: expectedProject },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
