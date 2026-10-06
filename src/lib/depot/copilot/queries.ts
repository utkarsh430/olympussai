import { z } from 'zod';
import { isValidDepotId } from '@/lib/depot/ids';

/**
 * The fixed catalogue of questions the copilot can answer. A question is mapped
 * to exactly one of these and the server runs it; the model never gets tools.
 * Everything is about depots and the network: nothing here can name or select
 * an individual.
 */
const depotId = z.string().refine(isValidDepotId, 'Not a valid depot id');

const RANK_METRICS = ['index', 'onRoad', 'offRoad', 'dark', 'scheduled'] as const;

export const copilotQuerySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('networkSummary') }).strict(),
  z.object({ kind: z.literal('depotSummary'), depotId }).strict(),
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
  z.object({ kind: z.literal('unsupported') }).strict(),
]);

export type CopilotQuery = z.infer<typeof copilotQuerySchema>;
export type RankMetric = (typeof RANK_METRICS)[number];
export const UNSUPPORTED_QUERY: CopilotQuery = { kind: 'unsupported' };
