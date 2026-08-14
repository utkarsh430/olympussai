// Fixture for src/tests/unit/clientBoundary.test.ts.
//
// A server module doing the two things that are FINE across the boundary:
// rendering a client component (that is what a client reference is for) and
// importing a type (erased before anything runs). Neither may be reported.
import { ClientOnlyPanel, type PanelTone } from './clientModule';

export function ServerWrapper({ tone }: { tone: PanelTone }) {
  return <ClientOnlyPanel tone={tone} />;
}
