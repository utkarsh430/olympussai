import type { ProvenanceDescription } from '@/lib/depot/provenanceLine';
import type { Provenance } from '@/lib/depot/types';
import { DepotEyebrow } from './DepotEyebrow';
import { HeaderProvenance } from './HeaderProvenance';
import { ProvenanceLine } from './ProvenanceLine';

export interface PageHeaderProps {
  readonly title: string;
  /** ONE sentence, at most about 80 characters. */
  readonly description: string;
  /** Mono label above the title. On a depot page the layout supplies the depot's name. */
  readonly eyebrow?: string;
  /** Controls on the right of the title row (filters, a refresh button). */
  readonly controls?: React.ReactNode;
  /** The page's default provenance, rendered as the fixed-formula provenance line. */
  readonly provenanceLine?: ProvenanceDescription;
  /** Earlier form: a tag and the per-tag note. Kept working; prefer `provenanceLine`. */
  readonly provenance?: Provenance;
  /** Earlier form of `controls`; still placed on the right. */
  readonly children?: React.ReactNode;
}

/**
 * Opening block of every depot page: optional mono label, the
 * title as the page's only `h1` (display face, 20px), one sentence, controls on the
 * right of the title row, then the provenance line. Nothing else goes between it and
 * the hero. Controls wrap beneath the title on a narrow column.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  controls,
  provenanceLine,
  provenance,
  children,
}: PageHeaderProps) {
  const right = controls ?? children;
  return (
    <header className="mb-6" data-testid="depot-page-header">
      {eyebrow ? <div className="depot-eyebrow">{eyebrow}</div> : <DepotEyebrow />}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-2xl">
          <h1 className="depot-title">{title}</h1>
          <p className="depot-prose mt-2">{description}</p>
        </div>
        {right ? <div className="flex min-w-0 flex-wrap items-center gap-2">{right}</div> : null}
      </div>
      {provenanceLine ? <ProvenanceLine description={provenanceLine} /> : null}
      {!provenanceLine && provenance ? <HeaderProvenance provenance={provenance} /> : null}
    </header>
  );
}
