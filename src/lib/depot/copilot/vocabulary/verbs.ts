import { words } from '@/lib/depot/copilot/vocabulary/function';

/**
 * Common verbs as base forms; the regular endings in index.ts supply
 * "-s", "-ed", "-ing". Irregular and consonant-doubling forms are listed.
 */
export const VERBS: readonly string[] = words(`
accept account achieve act add address adjust advise affect agree aim allow amount answer
appear apply approach arise arrive ask assess assign assume attend avoid await
balance base bear become begin behave belong bring build call carry catch cause change
check choose clear climb close collect come compare complete concern confirm connect
consider consist contain continue contribute control cover create cross cut
deal decide decline deliver depart depend deploy describe deserve detect determine differ
direct drop drive ease emerge enable end ensure enter establish estimate exceed exclude
exist expect explain extend face fail fall feed fill find finish fit fix flag follow form
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
arose arisen became began begun bore borne brought built came caught chose chosen dealt drew
drawn drove driven fell fallen fed felt found gave given went gone grew grown held kept knew
known laid lain led left lent lost made meant met paid ran rose risen said saw seen sent
shown sat spoke spoken stood taken took told thought understood understand withdrawn wrote
written beginning cutting dropped dropping fitted fitting flagged flagging getting letting
planned planning putting referred referring running setting sitting slipped slipping stopped
stopping occurred occurring controlled controlling transferred transferring travelled
travelling lagged lagging lying tied tying
`);
