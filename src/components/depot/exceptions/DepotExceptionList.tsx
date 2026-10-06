'use client';

import Link from 'next/link';
import { useState } from 'react';
import { EmptyState } from '@/components/depot/shell/DataStates';
import { depotHref } from '@/lib/depot/depotNav';
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
import type { ExceptionSeverity } from '@/lib/depot/exceptions/types';
import { formatCount } from '@/lib/depot/format';
import { UNASSIGNED_DEPOT_ID } from '@/lib/depot/types';

const SEVERITY_CLASS: Readonly<Record<ExceptionSeverity, string>> = {
  critical: 'depot-sev-critical',
  warning: 'depot-sev-warning',
  info: 'depot-sev-info',
};

function GroupRow({ group }: { readonly group: DepotExceptionGroup }) {
  return (
    <li className="px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`depot-tag ${SEVERITY_CLASS[group.severity]}`}>
          {SEVERITY_LABEL[group.severity]}
        </span>
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
          <li key={e.id} className="depot-prose">
            {group.exceptions.length > 1 ? `${SEVERITY_LABEL[e.severity]}: ` : ''}
            {describeDepotException(e)}
          </li>
        ))}
      </ul>
    </li>
  );
}

function Section({ section }: { readonly section: SeveritySection }) {
  const [showAll, setShowAll] = useState(false);
  const { shown, hidden } = capGroups(section.groups, showAll);
  return (
    <details open={section.open} className="group">
      <summary className="flex cursor-pointer list-none items-baseline gap-2 py-1 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="inline-block w-3 text-depot-faint group-open:rotate-90">
          ›
        </span>
        <h3 className="depot-label">{section.heading}</h3>
      </summary>
      <ul className="depot-panel mt-2 divide-y divide-depot-line">
        {shown.map((g) => (
          <GroupRow key={g.depotId} group={g} />
        ))}
      </ul>
      {hidden > 0 ? (
        <button
          type="button"
          className="mt-2 font-mono text-xs text-holo-glow underline-offset-2 hover:underline"
          onClick={() => setShowAll(true)}
        >
          {`Show all ${formatCount(section.groups.length)}`}
        </button>
      ) : null}
    </details>
  );
}

/** One row per depot, its kinds listed and worst severity first; critical open, lesser sections folded. */
export function DepotExceptionList({
  sections,
  filterLabel,
}: {
  readonly sections: readonly SeveritySection[];
  /** The kind filter in force, for the empty sentence. */
  readonly filterLabel: string | null;
}) {
  if (sections.length === 0) {
    return (
      <EmptyState>
        {filterLabel === null
          ? 'No depot is flagged on this snapshot: none has a dark, off-road or on-road rate far enough from its peers, and no depot has a cluster of buses with main power off.'
          : `No depot is flagged for ${filterLabel.toLowerCase()} on this snapshot.`}
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-4" data-testid="depot-exception-list">
      {sections.map((section) => (
        <Section key={section.severity} section={section} />
      ))}
    </div>
  );
}
