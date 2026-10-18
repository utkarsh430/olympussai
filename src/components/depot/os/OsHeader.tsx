import type { ReactNode } from 'react';
import type { DataStatus } from '@/lib/depot/os/dataStatus';
import { DepotEyebrow } from '@/components/depot/shell/DepotEyebrow';
import { StatusTag } from './ui';

/**
 * The opening of an OS view: the scope's eyebrow, the title (the page's only h1), one
 * sentence, the kinds of figure the view shows as small tags, and its actions on the
 * right. No provenance paragraph: the tags' tooltips and Integration Health carry it.
 */
export function OsHeader({
  title,
  description,
  statuses = [],
  actions,
  eyebrow,
}: {
  readonly title: string;
  readonly description: string;
  readonly statuses?: readonly DataStatus[];
  readonly actions?: ReactNode;
  readonly eyebrow?: string;
}) {
  return (
    <header className="mb-5" data-testid="depot-page-header">
      {eyebrow ? <div className="depot-eyebrow">{eyebrow}</div> : <DepotEyebrow />}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-3xl">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="depot-title">{title}</h1>
            {statuses.length > 0 ? (
              <span className="flex flex-wrap items-center gap-1.5">
                {statuses.map((status) => (
                  <StatusTag key={status} status={status} />
                ))}
              </span>
            ) : null}
          </div>
          <p className="depot-prose mt-1">{description}</p>
        </div>
        {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
