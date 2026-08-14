// The driver console's vocabulary, checked as a whole rather than string by
// string.
//
// This file exists because the e2e safety suite stopped asserting on this copy.
// tests/e2e/pilot-driver-command.spec.ts used to find the response buttons by
// their English text; the redesign made them bilingual and renamed all three,
// and re-pinning a two-database safety suite to product copy that is still
// being revised is how a green safety check turns red for a reason that has
// nothing to do with safety. So the copy moved here, where it can be asserted
// far more thoroughly and in milliseconds.
//
// Three of the properties below are structural rather than cosmetic, and each
// one is a defect this product could otherwise ship without noticing:
//
//   * A HALF-TRANSLATED PHRASE. A button with the Hindi forgotten looks
//     finished. Checking each pair individually is exactly the check somebody
//     forgets to add for the next one, so this walks the whole table.
//   * BLAME. "Cannot do it" and "Not safe" are first-class answers. If either
//     ever acquires a word implying fault, drivers answer "yes" and then do not
//     comply — leaving the control room reasoning about a bus it believes is
//     complying, which is worse than an honest refusal.
//   * GENDERED HINDI. UPSRTC has female drivers, and Hindi verbs agree with the
//     subject's gender, so the natural first-person forms quietly address half
//     the workforce.
import { describe, it, expect } from 'vitest';
import {
  allDriverPhrases,
  BLAME_WORDS,
  CONSOLE_COPY,
  NO_PENALTY,
  RESPONSE_CHOICES,
} from '@/lib/pilotDriver/driverCopy';

const DEVANAGARI = /[ऀ-ॿ]/;

describe('driver copy - both languages, always', () => {
  it('gives every phrase a non-empty English and Hindi form', () => {
    for (const { key, phrase } of allDriverPhrases()) {
      expect(phrase.en.trim(), `${key} has no English`).not.toBe('');
      expect(phrase.hi.trim(), `${key} has no Hindi`).not.toBe('');
    }
  });

  it('writes the Hindi in Devanagari rather than repeating the English', () => {
    for (const { key, phrase } of allDriverPhrases()) {
      expect(DEVANAGARI.test(phrase.hi), `${key} Hindi is not Devanagari`).toBe(true);
      expect(phrase.hi, `${key} Hindi is a copy of the English`).not.toBe(phrase.en);
    }
  });

  it('keeps every Hindi phrase free of Latin letters', () => {
    // Transliterated jargon in Devanagari ("अस्थायी कॉरिडोर पुनर्संतुलन") was the
    // language audit's finding against the prototype's strings. A stray Latin
    // run is the cruder version of the same failure and is worth catching.
    for (const { key, phrase } of allDriverPhrases()) {
      expect(/[A-Za-z]/.test(phrase.hi), `${key} Hindi contains Latin script`).toBe(false);
    }
  });
});

describe('driver copy - no answer implies blame', () => {
  it('keeps every blame word out of the whole vocabulary', () => {
    for (const { key, phrase } of allDriverPhrases()) {
      for (const word of BLAME_WORDS) {
        expect(phrase.en.toLowerCase(), `${key} English contains "${word}"`).not.toContain(word);
        expect(phrase.hi, `${key} Hindi contains "${word}"`).not.toContain(word);
      }
    }
  });

  it('says plainly, in both languages, that nothing follows from any answer', () => {
    // The single most important sentence on the screen. Pinned exactly, in
    // both languages, because weakening it is a safety regression and not a
    // copy tweak.
    expect(NO_PENALTY.en).toBe(
      'All three answers are recorded the same way. Nothing happens to you for any of them.',
    );
    expect(NO_PENALTY.hi).toBe(
      'तीनों जवाब एक जैसे दर्ज होते हैं। किसी भी जवाब पर कोई कार्रवाई नहीं होती।',
    );
  });

  it('uses कार्रवाई only to negate it', () => {
    // The Hindi for "action taken against someone" is allowed in exactly one
    // phrase - the one whose job is to say none is taken. Anywhere else it
    // would be a threat.
    const offenders = allDriverPhrases()
      .filter(({ key }) => key !== 'NO_PENALTY')
      .filter(({ phrase }) => phrase.hi.includes('कार्रवाई'))
      .map(({ key }) => key);
    expect(offenders).toEqual([]);
  });
});

describe('driver copy - the three answers are peers', () => {
  it('offers exactly accept, unable and unsafe, in that order', () => {
    expect(RESPONSE_CHOICES.map((c) => c.outcome)).toEqual(['accept', 'unable', 'unsafe']);
  });

  it('pins the exact words on all three buttons, in both languages', () => {
    expect(RESPONSE_CHOICES.map((c) => c.label.en)).toEqual([
      'Yes, doing it',
      'Cannot do it',
      'Not safe',
    ]);
    expect(RESPONSE_CHOICES.map((c) => c.label.hi)).toEqual([
      'हाँ, ठीक है',
      'नहीं कर सकते',
      'सुरक्षित नहीं है',
    ]);
  });

  it('keeps the two refusals free of first-person gendered Hindi verb forms', () => {
    // "कर रहा हूँ" is masculine, "कर रही हूँ" feminine. Any phrase that agrees
    // with the speaker's gender addresses only part of the workforce, so the
    // whole table avoids first-person verbs. These are the endings that give it
    // away.
    const GENDERED = [
      'रहा हूँ',
      'रही हूँ',
      'सकता हूँ',
      'सकती हूँ',
      'रहा हुँ',
      'चाहता हूँ',
      'चाहती हूँ',
    ];
    for (const { key, phrase } of allDriverPhrases()) {
      for (const form of GENDERED) {
        expect(phrase.hi, `${key} uses the gendered form "${form}"`).not.toContain(form);
      }
    }
  });

  it('keeps every button label short enough to read at a glance', () => {
    // A driver reads these one-handed in a moving cab. Anything that wraps to
    // three lines on a 360px phone is not a button, it is a paragraph.
    for (const choice of RESPONSE_CHOICES) {
      expect(choice.label.en.length, `${choice.outcome} English label is long`).toBeLessThanOrEqual(
        20,
      );
      expect(choice.label.hi.length, `${choice.outcome} Hindi label is long`).toBeLessThanOrEqual(
        24,
      );
    }
  });
});

describe('driver copy - state messages say what to do, not what broke', () => {
  it('distinguishes an answer that was sent from one still waiting for signal', () => {
    // These two are not interchangeable: one is a promise the control room has
    // it, the other is a promise this phone is holding it. Collapsing them
    // would tell a driver with no signal that the control room knows.
    expect(CONSOLE_COPY.answerSent.en).toBe('Answer sent.');
    expect(CONSOLE_COPY.answerQueued.en).toBe(
      'Answer saved on this phone. It will be sent as soon as you have signal.',
    );
    expect(CONSOLE_COPY.answerSent.en).not.toBe(CONSOLE_COPY.answerQueued.en);
  });

  it('tells a driver with no bus assigned who to ask, not just that they have none', () => {
    expect(CONSOLE_COPY.noBusAssigned.en).toContain('depot office');
  });

  it('never blames the driver or their bus for a system outage', () => {
    for (const message of [
      CONSOLE_COPY.offline,
      CONSOLE_COPY.unreachable,
      CONSOLE_COPY.busLookupFailed,
    ]) {
      expect(message.en.toLowerCase()).not.toContain('your fault');
      expect(message.en.toLowerCase()).not.toContain('you did');
    }
  });
});
