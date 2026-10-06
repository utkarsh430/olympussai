import { requireProjectSession } from '@/lib/auth/server';
import { AskPanel } from '@/components/depot/copilot/AskPanel';
import { HowProduced } from '@/components/depot/shell/HowProduced';
import { PageHeader } from '@/components/depot/shell/PageHeader';

const ASK_PATH = '/project/depots/ask';

/**
 * Rankings, depot summaries and exceptions are computed from the live feed;
 * shortfalls, spare buses and transfers rest on modelled requirement figures, so the page
 * declares MIXED and a generated evidence column carries its own MODELLED tag.
 */
const ASK_PROVENANCE = {
  default: 'mixed',
  derived: 'Rankings, depot summaries and exceptions',
  modelled: 'shortfalls, spare buses and transfers',
} as const;

const HOW_PRODUCED: readonly string[] = [
  "You can ask about rankings, a depot's summary or one of its figures, depots short of buses or with spare buses, transfers and exceptions. Choose a depot under About for questions about one depot; a question that names a depot is answered about that depot, and the chip beside the question says which.",
  'Answers are advisory. Rankings, depot summaries and exceptions are computed from the latest feed; shortfalls, spare buses and transfers rest on modelled requirement figures, not on the feed. When an answer lists depots short of buses or with spare buses, the column of those figures carries the modelled tag; an answer about transfers has no table. The footer under each answer names who wrote it, a scripted template or the Claude model, and how many figures it used.',
  'The last five answers stay on this page and nothing is stored.',
];

/** Plain-language questions about the network or one depot, answered from the live figures. */
export default async function DepotAskPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(ASK_PATH);

  return (
    <>
      <PageHeader
        title="Ask"
        description="Ask about the network or one depot; answers are advisory, and questions about staff are not answered."
        provenanceLine={ASK_PROVENANCE}
      />
      <AskPanel />
      <HowProduced testId="depot-produced" className="mt-10" paragraphs={HOW_PRODUCED} />
    </>
  );
}
