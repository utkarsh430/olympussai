import type { NextRequest } from 'next/server';
import { requireUpsrtcAccess, unauthorizedResponse } from '@/lib/auth/authorize';
import { getRepositories } from '@/lib/depot/repositories';
import { handleCopilotPost } from '@/lib/depot/copilot/service/handle';
import { getCopilotRuntime } from '@/lib/depot/copilot/service/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Above `REQUEST_DEADLINE_MS`, so the scripted answer always goes out before the platform cuts in. */
export const maxDuration = 45;

/**
 * Briefings, transfer rationales and answers to typed questions. Any
 * signed-in user may call it, so the session is checked here, before anything
 * else runs; every other guard (origin, limits, body, deadline) is in the
 * service, which keys its limits on the verified claims. Errors are fixed bodies and never carry the CLI's output.
 */
export async function POST(request: NextRequest): Promise<Response> {
  // Independent authorization check — never rely on middleware alone.
  const session = await requireUpsrtcAccess();
  if (!session) return unauthorizedResponse();
  return handleCopilotPost(
    request,
    getCopilotRuntime(),
    () => getRepositories().fleet.snapshot(),
    session,
  );
}
