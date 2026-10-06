import { words } from '@/lib/depot/copilot/vocabulary/function';

/**
 * Nouns of bus operations, depots, maintenance, schedules and reporting, and
 * the hyphenated forms the grammar accepts whole. Plurals come from the
 * regular endings in index.ts; irregular plurals are listed.
 */
export const DOMAIN_WORDS: readonly string[] = words(`
absence access action activity addition advice allocation analysis analyst
area arrival aspect assessment asset assignment assistant attention availability
backlog balance band base basis battery bay benchmark body breakdown briefing bus buses
capacity caution centre change check city cluster comparison component concern condition
confidence connection consequence context corporation corridor cost count coverage
data deficit delay demand departure depot detail difference direction dispatch distance
distribution district division duty effect efficiency effort end engine entry
estimate evidence example exception explanation extent factor feed figure finding
fleet focus fuel gap garage giver group growth health history home idea impact improvement
index indices indicator information inspection instance issue item journey kind lead level
limit line list location loss maintenance management margin measure movement need
network note notice number occupancy operation option order outcome outlook output
overview part passenger pattern peer performance picture place plan planner portion position
power practice pressure priority problem process profile progress proportion proposal
punctuality purpose quality query question range rank ranking rate rating ratio reading
receiver recommendation record recovery region relief reliability repair report requirement
reserve resource response result review road roster route run sample scale schedule scope
section sense sequence service shape share shed shift shortage shortfall side sign signal site
situation size snapshot source space spread stage standing state station status step
stock stop strength summary supply support surplus system target task team terminal thing
timetable topic town track traffic transfer trend trip turnout type unit update usage use
utilisation value variation vehicle view visitor volume watch way weakness window work
workshop yard zone
page fact language length maximum minimum middle name something nothing anything everything
instruction boundary floor ceiling worth wish suit outshed outshedding electric diesel hire
problem recommendation attention planner comparison concern caveat estimate assumption
arrangement adjustment agreement alternative approach approval audit authority awareness
behaviour benefit block board book breach budget category challenge chance channel chart
choice circle claim class code column combination comment commitment communication community
complaint conclusion constraint contact content contract contrast contribution correction
course culture customer cycle damage dashboard deadline decision decline defect definition
delivery description design destination development device discussion document doubt draft
duration emphasis environment equipment error event exercise expectation experience
exposure feature feedback field file flow forecast format frequency function gain goal
guidance habit handling headline help highlight increase insight interest interval
interruption inventory judgement knowledge label lane layout learning lesson load look map
matter meaning mention message method mismatch mode moment monitoring nature objective
observation occasion opportunity origin overlap owner ownership parking participation path
pause peak phase policy possibility potential preference presence principle procedure product
programme project prospect provision reach readiness reality reduction reference reform
relation relationship remark reminder removal replacement representation request reserve
restriction return revision role room rotation routine rule saving scenario
selection setting shortcoming slot solution speed standard start statement strain strategy
structure subject success suggestion surge survey symptom technique tendency term test theme
threshold tool tracking transition transport treatment trouble turnaround understanding
uptake variance variety version warning wear weight workload
depot-level network-level network-wide fleet-wide highest-ranked lowest-ranked vehicle-level fleet-level on-road off-road on-time no-signal
mid-sized in-service out-of-service in-yard peer-group short-term long-term near-term
real-time up-to-date follow-up knock-on well-placed under-used hand-over like-for-like
`);
