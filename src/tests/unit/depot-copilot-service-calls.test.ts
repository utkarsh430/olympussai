// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import liveFixture from '@/fixtures/upsrtc-live-sample.json';
import { deriveFeedNow, normalizeDepotRows } from '@/lib/upsrtc/depotNormalizer';
import { resetAnalysisForTests } from '@/lib/depot/live/analysis';
import { CopilotFailure, type CopilotDraft, type CopilotRequest } from '@/lib/depot/copilot/types';
import { IDENTITY_CLAUDE_CALLS_PER_HOUR } from '@/lib/depot/copilot/service/constants';
import { answerCopilot, type AnswerCall } from '@/lib/depot/copilot/service/generate';
import { prepareCopilotRequest } from '@/lib/depot/copilot/service/prepare';
import { buildCopilotRuntime } from '@/lib/depot/copilot/service/runtime';
import { parseCopilotBody } from '@/lib/depot/copilot/service/schema';

/** How the service spends Claude calls. Providers are fakes; no process runs. */

const rows = normalizeDepotRows(liveFixture).rows;
const VIEW = {
  rows,
  feedNow: deriveFeedNow(rows),
  fetchedAt: '2026-10-06T08:00:05.000Z',
  source: 'live' as const,
  stale: false,
  recordCount: rows.length,
};

function prepared(depotIndex = -1) {
  const scope =
    depotIndex < 0
      ? { kind: 'network' }
      : { kind: 'depot', depotId: rows[depotIndex]?.depotId ?? 'none' };
  const body = parseCopilotBody(JSON.stringify({ task: 'briefing', scope }));
  const result = body ? prepareCopilotRequest(body, VIEW) : null;
  if (!result?.ok) throw new Error('fixture must prepare');
  return result;
}

type Draft = (request: CopilotRequest, signal?: AbortSignal) => Promise<CopilotDraft>;
function runtimeWith(draft: Draft, minClaudeMs = 0) {
  const provider = { id: 'claude-cli' as const, draft: vi.fn(draft) };
  return {
    provider,
    runtime: buildCopilotRuntime({ setting: 'auto', cli: provider, minClaudeMs }),
  };
}

/** Like the real provider: never settles until its signal aborts. */
const hangUntilAborted: Draft = (_request, signal) =>
  new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new CopilotFailure('aborted', 'gone')));
  });

const call = (over: Partial<AnswerCall> = {}): AnswerCall => ({
  deadlineAt: Date.now() + 5_000,
  signal: new AbortController().signal,
  identity: 'me',
  ...over,
});

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetAnalysisForTests();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errorSpy.mockRestore());
const logLines = (): string[] => errorSpy.mock.calls.map((c) => String(c[0]));

describe('answerCopilot spending Claude calls', () => {
  it('makes one provider call for concurrent requests with the same key', async () => {
    const { runtime, provider } = runtimeWith(async (r) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return r.scriptedDraft;
    });
    const answers = await Promise.all([
      answerCopilot(runtime, prepared(), call({ identity: 'a' })),
      answerCopilot(runtime, prepared(), call({ identity: 'b' })),
      answerCopilot(runtime, prepared(), call({ identity: 'c' })),
    ]);
    expect(provider.draft).toHaveBeenCalledTimes(1);
    expect(answers.every((a) => a.provider === 'claude')).toBe(true);
  });

  it('on the deadline aborts the provider call and writes exactly one log line', async () => {
    const { runtime, provider } = runtimeWith(hangUntilAborted);
    const response = await answerCopilot(
      runtime,
      prepared(),
      call({ deadlineAt: Date.now() + 20 }),
    );
    expect(response).toMatchObject({ provider: 'scripted', notice: 'claude_unavailable' });
    expect(provider.draft.mock.calls[0]?.[1]?.aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(logLines()).toEqual(['[depot:copilot-api] deadline']);
  });

  it('aborts the provider call when the client disconnects', async () => {
    const { runtime, provider } = runtimeWith(hangUntilAborted);
    const client = new AbortController();
    const pending = answerCopilot(runtime, prepared(), call({ signal: client.signal }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    client.abort();
    await pending;
    expect(provider.draft.mock.calls[0]?.[1]?.aborted).toBe(true);
    expect(logLines()).toEqual(['[depot:copilot-api] aborted']);
  });

  it('keeps a shared call running while another request still waits for it', async () => {
    const { runtime, provider } = runtimeWith(async (r, signal) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (signal?.aborted) throw new CopilotFailure('aborted');
      return r.scriptedDraft;
    });
    const leaver = new AbortController();
    const first = answerCopilot(runtime, prepared(), call({ signal: leaver.signal }));
    const second = answerCopilot(runtime, prepared(), call({ identity: 'other' }));
    leaver.abort();
    await first;
    expect((await second).provider).toBe('claude');
    expect(provider.draft).toHaveBeenCalledTimes(1);
  });

  it('does not open the breaker after repeated aborts', async () => {
    const { runtime, provider } = runtimeWith(hangUntilAborted);
    for (let i = 0; i < 6; i += 1) {
      // A different identity each time, so the per-identity allowance is not what stops it.
      const terms = call({ deadlineAt: Date.now() + 10, identity: `id-${i}` });
      await answerCopilot(runtime, prepared(i), terms);
    }
    expect(provider.draft).toHaveBeenCalledTimes(6);
    expect(logLines().filter((l) => l.includes('claude-cli fell back'))).toEqual([]);
  });

  it('answers scripted with the notice once an identity has used its Claude allowance', async () => {
    const { runtime, provider } = runtimeWith(async (r) => r.scriptedDraft);
    for (let i = 0; i < IDENTITY_CLAUDE_CALLS_PER_HOUR; i += 1) {
      expect((await answerCopilot(runtime, prepared(i), call())).provider).toBe('claude');
    }
    const over = await answerCopilot(runtime, prepared(10), call());
    expect(over).toMatchObject({ provider: 'scripted', notice: 'claude_unavailable' });
    expect(provider.draft).toHaveBeenCalledTimes(IDENTITY_CLAUDE_CALLS_PER_HOUR);
    // A cache hit is still free, and another identity still has its own allowance.
    expect((await answerCopilot(runtime, prepared(0), call())).cached).toBe(true);
    expect((await answerCopilot(runtime, prepared(10), call({ identity: 'b' }))).provider).toBe(
      'claude',
    );
  });

  it('starts no Claude call when too little of the deadline is left', async () => {
    const { runtime, provider } = runtimeWith(async (r) => r.scriptedDraft, 1_000);
    const response = await answerCopilot(
      runtime,
      prepared(),
      call({ deadlineAt: Date.now() + 500 }),
    );
    expect(response).toMatchObject({ provider: 'scripted', notice: 'claude_unavailable' });
    expect(provider.draft).not.toHaveBeenCalled();
  });
});
