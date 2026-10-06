import { words } from '@/lib/depot/copilot/vocabulary/function';

/**
 * Nouns of bus operations, depots, maintenance, schedules and reporting, and
 * the hyphenated forms the grammar accepts whole. Plurals come from the
 * regular endings in index.ts; irregular plurals are listed.
 */
export const DOMAIN_WORDS: readonly string[] = words(`
absence access action activity addition advice alert allocation analysis analyst
area arrival aspect assessment asset assignment assistant attention availability
backlog balance band base basis battery bay benchmark body breakdown briefing bus buses
capacity cause caution centre change check city cluster comparison component concern condition
conductor confidence connection consequence context corporation corridor cost count coverage
crew data deficit delay demand departure depot detail difference direction dispatch distance
distribution district division driver duty effect efficiency effort end engine entry
estimate evidence example exception explanation extent factor failure feed figure finding
fleet focus fuel gap garage giver group growth health history home idea impact improvement
index indices indicator information inspection instance issue item journey kind lead level
limit line list location loss maintenance management manager margin measure movement need
network note notice number occupancy operation operator option order outcome outlook output
overview part passenger pattern peer performance picture place plan planner portion position
power practice pressure priority problem process profile progress proportion proposal
punctuality purpose quality query question range rank ranking rate rating ratio reading reason
receiver recommendation record recovery region relief reliability repair report requirement
reserve resource response result review risk road roster route run sample scale schedule scope
section sense sequence service shape share shed shift shortage shortfall side sign signal site
situation size snapshot source space spread staff stage standing state station status step
stock stop strength summary supply support surplus system target task team terminal thing
timetable topic town track traffic transfer trend trip turnout type unit update usage use
utilisation value variation vehicle view visitor volume watch way weakness window work
workshop yard zone
depot-level network-level vehicle-level fleet-level on-road off-road on-time no-signal
mid-sized in-service out-of-service in-yard peer-group short-term long-term near-term
real-time up-to-date follow-up knock-on well-placed under-used hand-over like-for-like
`);
