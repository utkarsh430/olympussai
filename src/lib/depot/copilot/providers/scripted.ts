import type { CopilotProvider } from '@/lib/depot/copilot/types';

/** Always available: returns the draft authored beside the facts. */
export function createScriptedProvider(): CopilotProvider {
  return {
    id: 'scripted',
    draft: async (request) => request.scriptedDraft,
  };
}
