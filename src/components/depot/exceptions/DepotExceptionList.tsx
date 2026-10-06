'use client';

import Link from 'next/link';
import { useState } from 'react';
import { DisclosureChevron } from '@/components/depot/shell/DisclosureChevron';
import { ShowAllButton } from '@/components/depot/shell/LongLists';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { depotHref } from '@/lib/depot/depotNav';
import { depotBasisLabel } from '@/lib/depot/exceptions/basisWords';
import {
  EXCEPTION_KIND_LABEL,
  SEVERITY_LABEL,
  describeDepotException,
} from '@/lib/depot/exceptions/describe';
import {
  capGroups,
  type DepotExceptionGroup,
  type SeveritySection,
} from '@/lib/depot/exceptions/pageModel';
import type { WindowWordsInput } from '@/lib/depot/score/windowWords';
import { UNASSIGNED_DEPOT_ID } from '@/lib/depot/types';

interface WindowProps {
  /** The response's score window and feed time: each exception words its own basis. */
  readonly window: WindowWordsInput | undefined;
  readonly feedNow: string | null;
}

/**
 * One depot: its name and kinds on one line, then one sentence per exception with the
 * moment its figure describes. The severity is the section's label, not repeated per row;
 * only a depot holding two levels prefixes each sentence with its own level.
 */
function GroupRow({ group, window, feedNow }: WindowProps & { readonly group: DepotExceptionGroup }) {
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {group.depotId === UNASSIGNED_DEPOT_ID ? (
          <span className="min-w-0 font-mono text-[13px] text-depot-ink">{group.depotName}</span>
        ) : (
          <Link
            href={depotHref(group.depotId)}
            className="min-w-0 font-mono text-[13px] text-holo-glow underline-offset-2 hover:underline"
          >
            {group.depotName}
          </Link>
        )}
        <span className="depot-label">
          {group.exceptions.map((e) => EXCEPTION_KIND_LABEL[e.kind]).join(' · ')}
        </span>
      </div>
      <ul className="mt-1">
        {group.exceptions.map((e) => (
          <li key={e.id} className="flex flex-wrap items-baseline gap-x-3">
            <span className="depot-prose min-w-0">
              {group.exceptions.length > 1 ? `${SEVERITY_LABEL[e.severity]}: ` : ''}
              {describeDepotException(e)}
            </span>
            <span className="depot-label normal-case" data-testid="depot-exception-basis">
              {depotBasisLabel(e, window, feedNow)}
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

function Section({ section, window, feedNow }: WindowProps & { readonly section: SeveritySection }) {
  const [showAll, setShowAll] = useState(false);
  const { shown, hidden } = capGroups(section.groups, showAll);
  const listId = `depot-exceptions-${section.severity}`;
  return (
    <details open={section.open} className="group">
      <summary className="flex cursor-pointer list-none items-baseline gap-2 py-1 [&::-webkit-details-marker]:hidden">
        <DisclosureChevron groupOpen />
        <h3 className="depot-label">{section.heading}</h3>
      </summary>
      <ul id={listId} className="mt-1 divide-y divide-depot-line border-y border-depot-line">
        {shown.map((g) => (
          <GroupRow key={g.depotId} group={g} window={window} feedNow={feedNow} />
        ))}
      </ul>
      {hidden > 0 || showAll ? (
        <ShowAllButton
          total={section.groups.length}
          expanded={showAll}
          onToggle={() => setShowAll(!showAll)}
          controls={listId}
        />
      ) : null}
    </details>
  );
}

/** One row per depot, worst severity first; critical open, lesser sections folded. */
export function DepotExceptionList({
  sections,
  filterLabel,
  window,
  feedNow,
}: WindowProps & {
  readonly sections: readonly SeveritySection[];
  /** The kind filter in force, for the nil sentence. */
  readonly filterLabel: string | null;
}) {
  if (sections.length === 0) {
    return (
      <StatePanel
        kind="empty"
        compact
        tone="ok"
        sentence={
          filterLabel === null
            ? 'No depot is flagged on this snapshot'
            : `No depot is flagged for ${filterLabel.toLowerCase()} on this snapshot`
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-4" data-testid="depot-exception-list">
      {sections.map((section) => (
        <Section key={section.severity} section={section} window={window} feedNow={feedNow} />
      ))}
    </div>
  );
}
