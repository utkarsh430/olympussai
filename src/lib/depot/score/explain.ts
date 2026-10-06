import { DEI_COMPONENTS } from './config';
import type { DeiComponent, DepotScore } from './types';

export interface StrongestAndWeakest {
  readonly strongest: DeiComponent | null;
  readonly weakest: DeiComponent | null;
}

/**
 * The components that helped and hurt a depot most, for a one-line "why".
 * Ties resolve by DEI_COMPONENTS order, independent of the array order passed
 * in. When every contribution is equal there is nothing to single out.
 */
export function strongestAndWeakest(score: DepotScore): StrongestAndWeakest {
  if (!score.ranked) return { strongest: null, weakest: null };

  const ordered = DEI_COMPONENTS.flatMap((config) => {
    const found = score.components.find((c) => c.key === config.key);
    return found === undefined ? [] : [found];
  });
  const [first, ...rest] = ordered;
  if (first === undefined) return { strongest: null, weakest: null };

  let strongest = first;
  let weakest = first;
  for (const c of rest) {
    if (c.contribution > strongest.contribution) strongest = c;
    if (c.contribution < weakest.contribution) weakest = c;
  }
  if (strongest.contribution === weakest.contribution) return { strongest: null, weakest: null };
  return { strongest, weakest };
}
