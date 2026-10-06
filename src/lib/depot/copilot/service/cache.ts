import { createHash } from 'node:crypto';
import type { CopilotRequest, CopilotText } from '@/lib/depot/copilot/types';

export interface ResponseCache {
  get(key: string): CopilotText | null;
  set(key: string, text: CopilotText): void;
}

/**
 * The cache key: a hash of everything the server built for the request (task,
 * scope label, guidance, facts and scripted draft). Facts carry the snapshot's
 * figures, so a new snapshot is a new key; nothing the user typed is in it.
 */
export function cacheKey(request: CopilotRequest): string {
  const material = JSON.stringify([
    request.task,
    request.scopeLabel,
    request.guidance,
    request.facts,
    request.scriptedDraft,
  ]);
  return createHash('sha256').update(material).digest('hex');
}

/** Bounded in size and age; past `maxEntries` the oldest entry goes first. */
export function createResponseCache(options: {
  readonly now: () => number;
  readonly ttlMs: number;
  readonly maxEntries: number;
}): ResponseCache {
  const entries = new Map<string, { readonly text: CopilotText; readonly storedAt: number }>();
  return {
    get(key: string): CopilotText | null {
      const entry = entries.get(key);
      if (!entry) return null;
      if (options.now() - entry.storedAt >= options.ttlMs) {
        entries.delete(key);
        return null;
      }
      return entry.text;
    },
    set(key: string, text: CopilotText): void {
      entries.delete(key);
      if (entries.size >= options.maxEntries) {
        const oldest = entries.keys().next();
        if (!oldest.done) entries.delete(oldest.value);
      }
      entries.set(key, { text, storedAt: options.now() });
    },
  };
}
