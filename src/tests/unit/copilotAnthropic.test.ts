// @vitest-environment node
//
// generateCopilotText is server-only (fetch to the Anthropic API), same
// per-file node environment rationale as controlServiceClient.test.ts.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

describe('generateCopilotText', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_MODEL;
  });

  it('fails closed with a clear error when ANTHROPIC_API_KEY is not configured', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { generateCopilotText } = await import('@/lib/copilot/anthropic');

    const result = await generateCopilotText({ system: 'sys', prompt: 'hello' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('never sends the api key or prompt text anywhere but the Anthropic request itself', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-secret';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'Grounded answer [incident:abc-1].' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { generateCopilotText } = await import('@/lib/copilot/anthropic');
    const result = await generateCopilotText({ system: 'sys', prompt: 'What happened?' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('Grounded answer [incident:abc-1].');
      expect(result.model).toBeTruthy();
    }

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-test-secret');
    const body = JSON.parse(init.body as string) as { system: string; messages: Array<{ content: string }> };
    expect(body.system).toBe('sys');
    expect(body.messages[0]?.content).toBe('What happened?');
  });

  it('reports ok:false without throwing on a non-2xx response, and never leaks the api key in the error', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-secret';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' }),
    );

    const { generateCopilotText } = await import('@/lib/copilot/anthropic');
    const result = await generateCopilotText({ system: 'sys', prompt: 'hi' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain('sk-test-secret');
      expect(result.error).toMatch(/401/);
    }
  });

  it('reports ok:false when the response has no text content, instead of returning an empty narrative', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-secret';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: [] }) }));

    const { generateCopilotText } = await import('@/lib/copilot/anthropic');
    const result = await generateCopilotText({ system: 'sys', prompt: 'hi' });

    expect(result.ok).toBe(false);
  });
});
