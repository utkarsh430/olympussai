'use client';

// Fixture for src/tests/unit/clientBoundary.test.ts: the two crossings that
// are LEGITIMATE, so the scanner can be proven not to flag them.

export type PanelTone = 'default' | 'warn';

export function ClientOnlyPanel({ tone }: { tone: PanelTone }) {
  return <div data-tone={tone} />;
}
