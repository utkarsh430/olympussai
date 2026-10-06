'use client';

import { HowProduced } from '@/components/depot/shell/HowProduced';
import { SERVICE_HOW_PRODUCED, needInputsSentence } from '@/lib/depot/service/serviceWording';
import type { NeedInputs } from '@/lib/depot/service/types';

export const SERVICE_HOW_ID = 'how-produced';

export interface ServiceMethodProps {
  readonly need: NeedInputs | null;
  readonly demandBasis: string | null;
}

/**
 * The closing disclosure: definitions, the formulas in words, the assumptions and what
 * each real feed would replace, then what this route's need and demand rest on.
 */
export function ServiceMethod({ need, demandBasis }: ServiceMethodProps) {
  return (
    <HowProduced id={SERVICE_HOW_ID} paragraphs={SERVICE_HOW_PRODUCED}>
      {need ? <p className="depot-prose">{needInputsSentence(need)}</p> : null}
      {demandBasis ? <p className="depot-prose">{`This route’s demand: ${demandBasis}`}</p> : null}
    </HowProduced>
  );
}
