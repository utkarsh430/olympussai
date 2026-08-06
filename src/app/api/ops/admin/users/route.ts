import { NextResponse } from 'next/server';
import { requireOpsRole } from '@/lib/auth/rbac/guard';
import { getOpsRepo } from '@/lib/auth/rbac/repo';
import { OpsDbConfigError } from '@/lib/db/pool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Admin-only roster. Never returns password_hash. */
export async function GET(): Promise<Response> {
  const guard = await requireOpsRole(['admin']);
  if (!guard.ok) return guard.response;

  try {
    const users = await getOpsRepo().listUsers();
    return NextResponse.json(
      {
        users: users.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          status: u.status,
          createdAt: u.createdAt,
        })),
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof OpsDbConfigError) {
      return NextResponse.json(
        { error: { code: 'NOT_CONFIGURED', message: 'Ops authentication is not configured.' } },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    throw error;
  }
}
