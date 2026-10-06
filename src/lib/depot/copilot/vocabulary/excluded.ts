import { words } from '@/lib/depot/copilot/vocabulary/function';

/**
 * Words the vocabulary must never contain, in any form the endings rule could
 * build: a test asserts it, and `isVocabularyWord` refuses them even when an
 * ending on a listed word would otherwise produce one ("time" + "s").
 * In order: cardinals and ordinals, multiplicative and collective words,
 * magnitudes, units and currency, arithmetic words that would join or scale
 * two figures, zero words, and link words.
 */
export const EXCLUDED_QUANTITY_WORDS: readonly string[] = words(`
zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen
sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety
ones twos tens teens umpteen umpteenth nth
first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth thirteenth
fourteenth fifteenth sixteenth seventeenth eighteenth nineteenth twentieth thirtieth fortieth
fiftieth sixtieth seventieth eightieth ninetieth hundredth thousandth millionth firstly
secondly thirdly primary secondary tertiary seconds thirds
once twice thrice single singles singly double doubles doubled doubling doubly triple triples
tripled tripling treble trebled quadruple quadrupled quintuple quintupled dual duo duet trio
quartet quintet twin twins twain pair pairs paired pairing couple couples coupled dozen dozens
score scores scored both half halves halve halved halving halfway quarter quarters quarterly
fold folds twofold threefold tenfold manifold multifold multiplied multiply divided handful
solo sole lone brace triad gross
hundred hundreds thousand thousands million millions billion billions trillion trillions
lakh lakhs lac lacs crore crores cr mn bn arab kharab grand mil thou kilo mega giga
percent percentage percentages percentile pct pc bps pp cent cents decile quartile quintile
km kms kilometre kilometres kilometer kilometers mile miles mileage metre metres meter meters
hour hours hourly hr hrs minute minutes min mins sec secs days weeks months years
fortnight fortnights fortnightly decade decades century centuries
kg kph mph kmph litre litres liter liters tonne tonnes ton tons degree degrees
rupee rupees rs inr paise paisa dollar dollars usd pound pounds euro euros
times plus minus negative point points dot decimal decimals nought naught aught
nil none null
triply trebly dayly
`);

/** Link words: excluded as they stand, but an ending may still build "comes" or "coming". */
const EXCLUDED_LINK_WORDS: readonly string[] = words(
  'www http https mailto javascript com org net',
);

export const EXCLUDED_WORDS: readonly string[] = [
  ...EXCLUDED_QUANTITY_WORDS,
  ...EXCLUDED_LINK_WORDS,
];

/** A strict Roman numeral in lowercase: what "mix", "vi" or "xl" would read as in capitals. */
const ROMAN = /^m{0,3}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/;

export function isRomanNumeral(lower: string): boolean {
  return lower.length > 0 && ROMAN.test(lower);
}
