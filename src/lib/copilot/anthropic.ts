/**
 * Anthropic Messages API adapter — the only place the copilot module talks
 * to an LLM. Plain `fetch`, no vendor SDK, matching this repo's existing
 * rule for single-endpoint HTTP integrations (see src/lib/email/resend.ts's
 * doc comment and src/lib/upsrtc/client.ts's fetch-with-timeout pattern);
 * `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` are already listed in README.md's
 * env var table (previously "present but intentionally unused") — this file
 * is what wires them up.
 *
 * Node runtime only (invoked from route handlers that are already
 * `export const runtime = 'nodejs'`). Never throws: every failure mode
 * (missing key, network error, timeout, non-2xx, empty response) is reported
 * back as `{ ok: false, error }` so callers can log it to
 * ops_copilot_interactions and surface a clean error instead of a 500.
 */
import 'server-only';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_MODEL = 'claude-sonnet-4-5';
const DEFAULT_MAX_TOKENS = 1200;

export interface CopilotLlmRequest {
  /** Grounding rules + citation contract — never user-controlled. */
  system: string;
  /** The grounded context + question, built by src/lib/copilot/prompts.ts. */
  prompt: string;
  maxTokens?: number;
}

export type CopilotLlmResult =
  | { ok: true; text: string; model: string }
  | { ok: false; error: string };

interface AnthropicMessageResponse {
  content?: Array<{ type: string; text?: string }>;
}

/**
 * Calls the Anthropic Messages API once and returns the concatenated text
 * content. Callers are responsible for logging `input.prompt` and the
 * result to ops_copilot_interactions (this function does not persist
 * anything itself — src/lib/copilot/service.ts owns that so every call site
 * logs consistently, success or failure).
 */
export async function generateCopilotText(input: CopilotLlmRequest): Promise<CopilotLlmResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, error: 'ANTHROPIC_API_KEY is not configured' };
  }
  const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: input.system,
        messages: [{ role: 'user', content: input.prompt }],
      }),
    });

    if (!response.ok) {
      // Never log the API key, and never log the (potentially incident-
      // sensitive) request/response bodies to the console — those are
      // persisted to ops_copilot_interactions by the caller instead, which
      // is access-controlled the same way as the rest of the ops audit
      // trail, unlike stdout/stderr.
      const bodyText = await response.text().catch(() => '');
      console.error('[copilot] anthropic request failed', {
        status: response.status,
        bodyPreview: bodyText.slice(0, 200),
      });
      return { ok: false, error: `Anthropic API responded with HTTP ${response.status}` };
    }

    const data = (await response.json()) as AnthropicMessageResponse;
    const text = (data.content ?? [])
      .filter((block): block is { type: string; text: string } => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
      .trim();

    if (!text) {
      return { ok: false, error: 'Anthropic response contained no text content' };
    }

    return { ok: true, text, model };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: 'Anthropic API request timed out' };
    }
    const message = error instanceof Error ? error.message : 'Unknown error calling Anthropic API';
    console.error('[copilot] anthropic request threw', { message });
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}
