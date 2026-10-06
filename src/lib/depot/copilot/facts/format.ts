import { formatCount, formatShare } from '@/lib/depot/format';
import { sanitizeQuestion } from '@/lib/depot/copilot/router/sanitize';
import type {
  CopilotDraft,
  CopilotFact,
  CopilotRequest,
  CopilotTask,
} from '@/lib/depot/copilot/types';
import type { DepotExceptionKind } from '@/lib/depot/exceptions/types';
import type { Provenance, StateMix } from '@/lib/depot/types';

/**
 * Helpers shared by the facts builders. Two rules shape everything here:
 *  - a figure or a name lives in a fact's `text`, never in a draft's prose, so
 *    the renderer's "no digits outside placeholders" check holds by construction;
 *  - fact text is one short value (the core caps it), formatted once, here.
 */

/** Fact text longer than this is cut; the core caps it again on insertion. */
const MAX_NAME_CHARS = 80;
const DASH = '—';

export const ph = (id: string): string => `{{fact:${id}}}`;

export function makeFact(
  id: string,
  label: string,
  text: string,
  provenance: Provenance,
): CopilotFact {
  return { id, label, text, provenance };
}

/** A depot name as data: verbatim apart from control characters and whitespace. */
export const cleanName = (name: string): string =>
  sanitizeQuestion(name).slice(0, MAX_NAME_CHARS) || DASH;

export const count = (n: number): string => formatCount(n);
export const busCount = (n: number): string => `${formatCount(n)} ${n === 1 ? 'bus' : 'buses'}`;
export const depotCount = (n: number): string =>
  `${formatCount(n)} ${n === 1 ? 'depot' : 'depots'}`;
export const share = (n: number, of: number): string => formatShare(n, of);
export const index1 = (n: number): string => n.toFixed(1);
export const km1 = (n: number): string => `${n.toFixed(1)} km`;

/** Buses moving: scheduled in service, or on the road with no schedule in the feed. */
export const onRoadCount = (states: StateMix): number => states.inService + states.onRoad;

/** "{{a}}, {{b}} and {{c}}" from fact ids; empty input gives an empty string. */
export function listPlaceholders(ids: readonly string[]): string {
  const marks = ids.map(ph);
  if (marks.length <= 1) return marks.join('');
  return `${marks.slice(0, -1).join(', ')} and ${marks[marks.length - 1]}`;
}

/** Fixed phrases for depot-level exception kinds; they never carry a figure. */
export const DEPOT_EXCEPTION_PHRASE: Readonly<Record<DepotExceptionKind, string>> = {
  dark_share_high: 'a high share of buses that have gone dark',
  off_road_high: 'a high share of buses off the road',
  on_road_low: 'a low share of buses on the road',
  power_cut_cluster: 'a cluster of buses with the main power cut',
};

/** Facts keep their first occurrence, so an id is never duplicated in a request. */
function uniqueFacts(facts: readonly CopilotFact[]): CopilotFact[] {
  const seen = new Set<string>();
  return facts.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
}

export function buildRequest(parts: {
  readonly task: CopilotTask;
  readonly scopeLabel: string;
  readonly facts: readonly CopilotFact[];
  readonly guidance: string;
  readonly scriptedDraft: CopilotDraft;
}): CopilotRequest {
  return { ...parts, facts: uniqueFacts(parts.facts) };
}
