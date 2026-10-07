'use client';

import { HowProduced } from '@/components/depot/shell/HowProduced';
import { SERVICE_HOW_PRODUCED, needInputsSentence } from '@/lib/depot/service/serviceWording';
import type { NeedInputs } from '@/lib/depot/service/types';

export const SERVICE_HOW_ID = 'how-produced';

export interface ServiceMethodProps {
  readonly need: NeedInputs | null;
  readonly demandBasis: string | null;
  /** Who can be counted on the route at all: the route-name share and the standing buses. */
  readonly coverage?: readonly string[];
}

/**
 * The closing disclosure: definitions, the formulas in words, the assumptions and what
 * each real feed would replace, then what this route's need and demand rest on and who
 * can be counted on it.
 */
export function ServiceMethod({ need, demandBasis, coverage = [] }: ServiceMethodProps) {
  return (
    <HowProduced id={SERVICE_HOW_ID} paragraphs={SERVICE_HOW_PRODUCED}>
      {need ? <p className="depot-prose">{needInputsSentence(need)}</p> : null}
      {demandBasis ? <p className="depot-prose">{`This route’s demand: ${demandBasis}`}</p> : null}
      {coverage.length > 0 ? <p className="depot-prose">{coverage.join(' ')}</p> : null}
    </HowProduced>
  );
}
