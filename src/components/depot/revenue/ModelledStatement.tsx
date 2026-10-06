import Link from 'next/link';
import { ProvenanceBadge } from '@/components/depot/shell/ProvenanceBadge';
import { modelledStatement } from '@/lib/depot/revenue/revenuePageModel';
import type { RevenueResponse } from '@/lib/depot/revenue/api';

const SOURCES_PATH = '/project/depots/sources';

/** What is modelled, what a trip means here, and what real feeds replace it. */
export function ModelledStatement({
  params,
  notes,
  preface = [],
  closing = [],
}: {
  readonly params: RevenueResponse['model']['params'];
  readonly notes: RevenueResponse['notes'];
  /** Paragraphs a page adds before the revenue statement (the economics page's). */
  readonly preface?: readonly string[];
  /** Paragraphs a page adds after it. */
  readonly closing?: readonly string[];
}) {
  return (
    <section aria-labelledby="revenue-statement-title" className="depot-panel min-w-0 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="revenue-statement-title" className="depot-label">
          What is modelled
        </h2>
        <ProvenanceBadge provenance="modelled" />
      </div>
      <div className="mt-2 flex max-w-3xl flex-col gap-2">
        {[...preface, ...modelledStatement(params), ...closing].map((paragraph) => (
          <p key={paragraph} className="depot-prose">
            {paragraph}
          </p>
        ))}
        {notes.map((note) => (
          <p key={note} className="depot-prose">
            {note}
          </p>
        ))}
        <p className="depot-prose">
          The fields each feed must provide are listed on the{' '}
          <Link href={SOURCES_PATH} className="text-holo-glow underline-offset-2 hover:underline">
            Data sources page
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
