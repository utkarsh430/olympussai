import { z } from 'zod';
import { isValidDepotId } from '@/lib/depot/ids';
import { DEI_COMPONENTS } from '@/lib/depot/score/config';

/**
 * The fixed catalogue of questions the copilot can answer. A question is mapped
 * to exactly one of these and the server runs it; the model never gets tools.
 * Everything is about depots and the network: nothing here can name or select
 * an individual.
 */
const depotId = z.string().refine(isValidDepotId, 'Not a valid depot id');

export const UNSUPPORTED_REASONS = ['out_of_scope', 'people', 'ambiguous_depot'] as const;
const RANK_METRICS = ['index', 'onRoad', 'offRoad', 'dark', 'scheduled'] as const;
/** Round 8: the single figures a question may ask for at one depot. */
export const DEPOT_MEASURES = [
  'dark',
  'offRoad',
  'powerCut',
  'inYard',
  'onRoad',
  'standing',
  'fleet',
  'index',
  'rank',
  'visitors',
] as const;

export const copilotQuerySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('networkSummary') }).strict(),
  z.object({ kind: z.literal('depotSummary'), depotId }).strict(),
  z
    .object({ kind: z.literal('depotMeasure'), depotId, measure: z.enum(DEPOT_MEASURES) })
    .strict(),
  z
    .object({
      kind: z.literal('rankDepots'),
      metric: z.enum(RANK_METRICS),
      /** By value: `top` is the highest figure for the metric, `bottom` the lowest. */
      order: z.enum(['top', 'bottom']),
      limit: z.number().int().min(1).max(10),
    })
    .strict(),
  z.object({ kind: z.literal('depotsInDeficit') }).strict(),
  z.object({ kind: z.literal('depotsInSurplus') }).strict(),
  z.object({ kind: z.literal('transfersFor'), depotId }).strict(),
  z.object({ kind: z.literal('exceptionsFor'), depotId }).strict(),
  z.object({ kind: z.literal('compareDepots'), depotA: depotId, depotB: depotId }).strict(),
  z.object({ kind: z.literal('outshedStatus'), depotId }).strict(),
  z
    .object({
      kind: z.literal('unsupported'),
      /** Why the router declined; absent means the generic wording. */
      reason: z.enum(UNSUPPORTED_REASONS).optional(),
    })
    .strict(),
]);

export type CopilotQuery = z.infer<typeof copilotQuerySchema>;
export type RankMetric = (typeof RANK_METRICS)[number];
export type DepotMeasure = (typeof DEPOT_MEASURES)[number];
export const OUT_OF_SCOPE_QUERY: CopilotQuery = { kind: 'unsupported', reason: 'out_of_scope' };
export const PEOPLE_QUERY: CopilotQuery = { kind: 'unsupported', reason: 'people' };
export const AMBIGUOUS_DEPOT_QUERY: CopilotQuery = {
  kind: 'unsupported',
  reason: 'ambiguous_depot',
};

/**
 * Whether a higher figure is better for a ranking metric. Derived from the
 * index configuration so a ranking can never be silently inverted; the index
 * itself is higher-is-better.
 */
export function metricHigherIsBetter(metric: RankMetric): boolean {
  if (metric === 'index') return true;
  return DEI_COMPONENTS.find((c) => c.key === metric)?.higherIsBetter ?? true;
}
