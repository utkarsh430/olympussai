// Fixture for src/tests/unit/clientBoundary.test.ts: the crossing itself.
//
// No 'use client' here, and it pulls a lowercase-initial VALUE out of a
// module that has one. In a real Server Component this is the import that
// returns a client-reference proxy and throws on the first call.
import { isConsoleTab } from './clientModule';

export function resolveTab(raw: string | undefined): string {
  return isConsoleTab(raw) ? raw : 'decisions';
}
