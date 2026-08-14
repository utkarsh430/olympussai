'use client';

// Fixture for src/tests/unit/clientBoundary.test.ts. Nothing imports this at
// runtime; it exists so the scanner can be proven to still detect a crossing.
// It reproduces the exact shape of the /ops/control-room defect: a client
// module exporting a component, a plain predicate and a type together.

export type ConsoleTabId = 'decisions' | 'approvals';

export function isConsoleTab(value: string | undefined): value is ConsoleTabId {
  return value === 'decisions' || value === 'approvals';
}

export function ClientPanel({ tab }: { tab: ConsoleTabId }) {
  return <div>{tab}</div>;
}
