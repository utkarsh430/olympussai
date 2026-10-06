/**
 * Every character that can hide text from a reader or reorder it: control (Cc),
 * format (Cf: bidi, zero-width, soft hyphen, tag block), private-use (Co),
 * unassigned (Cn) and surrogate (Cs) characters, plus invisible fillers that
 * are letters or marks to Unicode (Hangul and Braille fillers, the combining
 * grapheme joiner, Khmer inherent vowels, Mongolian vowel separator) and the
 * variation selectors, and every default-ignorable code point (Hangul
 * fillers, Mongolian and supplementary variation selectors). Written with escapes so no invisible character is
 * stored in this file.
 *
 * The one list used by both the fact sanitiser (render.ts) and the question
 * sanitiser (router/sanitize.ts), so the two cannot drift. Global: use it with
 * `replace`, not `test`, which would carry `lastIndex` between calls.
 */
export const INVISIBLE_CHARACTERS = new RegExp(
  '[\\p{Default_Ignorable_Code_Point}\\p{Cc}\\p{Cf}\\p{Co}\\p{Cn}\\p{Cs}\\u3164\\u1160\\u2800\\u034f\\u17b4\\u17b5\\u180e\\ufe00-\\ufe0f]',
  'gu',
);
