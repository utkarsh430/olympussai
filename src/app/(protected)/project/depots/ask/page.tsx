import { requireProjectSession } from '@/lib/auth/server';
import { AskPanel } from '@/components/depot/copilot/AskPanel';
import { HowProduced } from '@/components/depot/shell/HowProduced';
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
        description="Ask about the network or one depot; questions about staff are not answered."
        provenanceLine={{ default: 'derived' }}
      />
      <AskPanel />
      <HowProduced testId="depot-produced" className="mt-8">
        <p>
          You can ask about rankings, a depot&apos;s summary, depots short of buses or with spare
          buses, transfers and exceptions. Choose a depot under About for questions about one depot.
        </p>
        <p>
          Answers are advisory, and every figure in them comes from the latest data. The footer
          under each answer names who wrote it, a scripted template or the Claude model, and how
          many figures it used.
        </p>
        <p>The last five answers stay on this page and nothing is stored.</p>
      </HowProduced>
    </>
  );
}
