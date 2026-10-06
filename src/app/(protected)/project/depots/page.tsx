import { requireProjectSession } from '@/lib/auth/server';
import { DEPOTS_ROOT } from '@/lib/depot/nav';
import { PageHeader } from '@/components/depot/shell/PageHeader';

/** Network overview. The pending panel is replaced once the live depot feed lands (P1). */
export default async function DepotsOverviewPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(DEPOTS_ROOT);

  return (
    <>
      <PageHeader
        title="Network overview"
        description="Fleet strength, status and efficiency across every UPSRTC depot."
      />
      <section className="depot-panel p-6" data-testid="depot-overview-pending">
        <p className="depot-prose">
          Depot figures appear here once the live depot feed is connected.
        </p>
      </section>
    </>
  );
}
