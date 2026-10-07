import { formatCount, pluralWord } from '../format';
import { isValidDepotId } from '../ids';
import { SERVICE_PATH } from '../nav';
import type { NetworkHourlyBody } from './types';

/*
 * The network hours in one line, for the pages that point to "Service by the hour": the
 * overview's figure (routes short at the next peak) and the cockpit's attention line (the
 * same for one depot's routes), each linking to the page, filtered to the depot.
 */

export interface NextPeakSummary {
  /** Routes short in the band that is now or next a peak. */
  readonly short: number;
  /** Routes in the selection (the network, or one depot's). */
  readonly routes: number;
  /** The peak's label, lower case: "evening peak". */
  readonly peak: string;
}

export function nextPeakSummary(body: Pick<NetworkHourlyBody, 'bands' | 'nextPeak' | 'routes'>): NextPeakSummary {
  const band = body.bands.find((b) => b.band === body.nextPeak);
  return {
    short: band?.shortRoutes ?? 0,
    routes: body.routes.total,
    peak: band?.label.toLowerCase() ?? '',
  };
}

/** The cockpit's line, its count printed beside it: "of this depot's 14 routes short at the next peak". */
export function depotPeakWords(summary: NextPeakSummary): string {
  const routes = pluralWord(summary.routes, 'route', 'routes');
  return `of this depot’s ${formatCount(summary.routes)} ${routes} short at the next peak (${summary.peak})`;
}

/** The page's address, filtered to a depot when one is named. */
export function serviceHref(depotId: string | null): string {
  return depotId !== null && isValidDepotId(depotId)
    ? `${SERVICE_PATH}?depot=${encodeURIComponent(depotId)}`
    : SERVICE_PATH;
}
