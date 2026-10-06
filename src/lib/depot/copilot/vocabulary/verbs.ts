import { words } from '@/lib/depot/copilot/vocabulary/function';

/**
 * Common verbs as base forms; the regular endings in index.ts supply
 * "-s", "-ed", "-ing". Irregular and consonant-doubling forms are listed.
 */
export const BASE_VERBS: readonly string[] = words(`
accept account achieve act add address adjust advise affect agree aim allow amount answer
appear apply approach arise arrive ask assess assign assume attend avoid await
balance base bear become begin behave belong bring build call carry catch change
check choose clear climb close collect come compare complete concern confirm connect
consider consist contain continue contribute control cover create cross cut
deal decide decline deliver depart depend deploy describe deserve detect determine differ
direct drop drive ease emerge enable end ensure enter establish estimate exceed exclude
exist expect explain extend face fall feed fill find finish fit fix flag follow form
gain gather get give go grow handle happen head help hide hold home identify improve include
increase indicate inform involve join keep know lack lag lead lean learn leave lend let lie
lift limit link list locate log look lose lower make manage mark match matter mean measure
meet miss model monitor move narrow note notice observe occur offer open operate order outpace
owe park pass pay perform pick place plan position prepare present prevent proceed
produce propose prove provide pull push put raise range rank rate reach read receive recommend
record recover reduce refer reflect regard relate release rely remain remove repair repeat
replace report represent require resolve respond rest restore result resume retain return
reveal review rise run say schedule see seek seem send serve set settle share shift show sit
slip slow sort speak stand start state stay stem stop suggest supply support surface
take tell tend test think track trail transfer travel treat trend try turn use vary visit
wait want warrant watch weaken widen work worsen write brief home answer phrase
infer instruct weigh expose update name suit wish hire last absorb accumulate acknowledge
adapt adopt advance align alter anticipate appoint arrange attach attribute bring broaden
calculate clarify combine commit communicate compensate concentrate conclude conduct confine
constrain consult convert correct count delay demonstrate deny derive design develop
diminish discuss display distribute divert draw drift earn eliminate emphasise encounter
encourage engage enhance evaluate examine exhibit expand experience explore express favour
feature focus forecast free fulfil function generate govern guide halt highlight ignore
illustrate impose inspect intend interpret interrupt introduce investigate isolate judge
justify label launch maintain mention minimise mitigate note obtain offset omit outline
outweigh overcome overlap overlook persist prefer preserve press prioritise process prompt
protect question quote realise recognise reconcile redirect refine reinforce reject relieve
relocate remind renew reorganise request reserve resist restrict revise rotate satisfy scale
secure select separate shape shorten signal simplify smooth specify spread stabilise strain
strengthen stress stretch struggle submit substitute succeed suffer summarise suspend sustain
switch target tighten tolerate trace trigger underline undermine undertake unfold uphold
validate verify view warn welcome withdraw wonder configure
`);

/**
 * Inflected and irregular forms, and the few non-verbs kept with them. Kept apart
 * from the base forms because a sentence may open with "Flagged" or "Left", but
 * one that opens with a base form is an instruction (sentenceRules.ts).
 */
export const VERB_FORMS: readonly string[] = words(`
inferred hardest harder worth yet nearer preferable preferably healthy
arose arisen became began begun bore borne brought built came caught chose chosen dealt drew
drawn drove driven fell fallen fed felt found gave given went gone grew grown held kept knew
known laid lain led left lent lost made meant met paid ran rose risen said saw seen sent
shown spoke spoken stood taken took told thought understood understand withdrawn wrote
written beginning cutting dropped dropping fitted fitting flagged flagging getting letting
planned planning putting referred referring running setting sitting slipped slipping stopped
stopping occurred occurring controlled controlling transferred transferring travelled
travelling lagged lagging lying tied tying
`);

export const VERBS: readonly string[] = [...BASE_VERBS, ...VERB_FORMS];
