/** Splits a block of whitespace-separated lowercase words into a list. */
export const words = (block: string): readonly string[] => block.trim().split(/\s+/);

/**
 * Function words: articles, pronouns, prepositions, conjunctions, auxiliaries,
 * vague quantifiers that state no figure, and common adverbs and connectives.
 * Contains no number, magnitude, unit or currency word (see excluded.ts).
 */
export const FUNCTION_WORDS: readonly string[] = words(`
a an the this that these those it its itself they them their theirs themselves we us our ours
he she his her him you your who whom whose which what whatever whichever
of to in on at by for from with without within into onto upon over under above below between
among amid across along around about against after before behind beside besides beyond during
through throughout toward towards until till since via per than as like unlike despite except
near off out outside inside up down away back ahead apart aside together forward onward
and or but nor so yet if then else though although while whereas because unless whether
is are was were be been being am has have had having do does did done doing
will would shall should can could may might must ought need cannot
not no never ever always often usually sometimes seldom rarely already still just
only also too very quite rather fairly nearly almost roughly broadly largely mostly mainly
partly fully wholly entirely highly slightly somewhat closely clearly notably sharply steadily
again further furthermore moreover however therefore thus hence meanwhile otherwise instead
indeed overall elsewhere here there where when whenever wherever why how afterwards
all any each every some several many much more most few fewer less least enough plenty
another other others either such same own lot lots rest majority minority bulk
now today currently recently lately presently soon later earlier
early late latest daily weekly monthly night
day week month year date time season period moment present past future
yes perhaps maybe likely unlikely possibly probably certainly simply merely
well better best worse worst far farther nearer closer close nearby
isn't aren't wasn't weren't doesn't don't didn't hasn't haven't can't couldn't won't wouldn't
shouldn't it's that's there's
`);
