import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { clearOpsSession } from '@/lib/auth/rbac/server';
import { isSameOrigin } from '@/lib/auth/origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<Response> {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: { code: 'INVALID_ORIGIN', message: 'Invalid request origin.' } },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  await clearOpsSession();
  return NextResponse.json({ ok: true }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
