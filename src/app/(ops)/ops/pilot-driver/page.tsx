import { requireOpsRolePage } from '@/lib/auth/rbac/pageGuard';
import { OpsShell } from '@/components/ops/OpsShell';
import { CommandConsole } from '@/components/ops/pilot-driver/CommandConsole';
import { JourneySection } from '@/components/ops/pilot-driver/JourneySection';
import { PwaRegister } from '@/components/ops/pilot-driver/PwaRegister';

export default async function PilotDriverPage() {
  // The session comes from the guard itself, not from a second, independent
  // resolution of it. Both are database reads now, a layout and its page body
  // render concurrently, and asserting non-null here turned any disagreement
  // between them - an admin disabling or re-roling this operator mid-render -
  // into an unhandled TypeError and an HTTP 500. This costs no extra read
  // (resolveOpsSession is memoised per request) and refuses by redirecting.
  // See src/lib/auth/rbac/pageGuard.ts.
  const session = await requireOpsRolePage('pilot_driver', '/ops/pilot-driver');

  return (
    <OpsShell title="Pilot Driver" email={session.email} role="pilot_driver">
      <PwaRegister />
      {/* ORDER IS LOAD-BEARING. The command console stays first, above the
          fold, on every screen size. It is the only place a driver sees an
          instruction from the control room, and a driver who has scrolled down
          to read their route must not be able to scroll an arriving command
          out of sight - so the route goes below it, never beside or before it.

          JourneySection is an error boundary around the route (see its own
          note): the console is deliberately OUTSIDE that boundary, because a
          boundary containing both would let a map failure blank the console it
          exists to protect. */}
      <div className="space-y-6">
        <CommandConsole />
        <JourneySection />
      </div>
    </OpsShell>
  );
}
