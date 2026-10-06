import { requireProjectSession } from '@/lib/auth/server';
import { AskPanel } from '@/components/depot/copilot/AskPanel';
import { PageHeader } from '@/components/depot/shell/PageHeader';

const ASK_PATH = '/project/depots/ask';

/** Plain-language questions about the network or one depot, answered from the live figures. */
export default async function DepotAskPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(ASK_PATH);

  return (
    <>
      <PageHeader
        title="Ask"
        description="Ask about the network or a depot in plain words. Answers are advisory, and every figure in them comes from the latest data."
      />
      <AskPanel />
    </>
  );
}
