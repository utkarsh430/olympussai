/**
 * Every word the driver console says, in both languages, in one place.
 *
 * ─── WHY THIS IS A MODULE AND NOT JUST STRINGS IN COMPONENTS ─────────────
 *
 * The language audit found that the two screens a real UPSRTC driver actually
 * uses — /ops/driver and /ops/pilot-driver — contained no Hindi at all, while
 * the only Devanagari in the product sat in the `/project/*` prototype whose
 * own header says "No driver receives anything". The bilingual work existed;
 * it was attached to the demo.
 *
 * Moving it onto the real screen is not a matter of sprinkling `<span lang>`
 * through JSX. A driver-facing string has to satisfy four things at once, and
 * a component is the wrong place to check any of them:
 *
 *   1. BOTH LANGUAGES OR NEITHER. A pair where the Hindi was forgotten renders
 *      as a confident English-only button on a screen that has taught the
 *      driver to expect their own language — worse than never having offered
 *      it. `DriverPhrase` requires both fields, and driverCopy.test.ts walks
 *      every entry and asserts the Hindi is real Devanagari rather than a
 *      copy of the English.
 *
 *   2. NO BLAME. "Cannot do it" and "Not safe" are first-class answers, not
 *      confessions. The audit's rule is that neither may carry a word that
 *      implies fault, penalty or judgement, in either language. That is a
 *      property of the whole vocabulary, so it is asserted over the whole
 *      table (BLAME_WORDS below) rather than trusted to whoever writes the
 *      next button.
 *
 *   3. GENDER-NEUTRAL HINDI. UPSRTC has female drivers. Hindi verbs agree with
 *      the subject's gender, so the natural first-person forms ("कर रहा हूँ")
 *      are masculine and quietly address only half the workforce. Every phrase
 *      here is written to avoid first-person verb agreement entirely — "हाँ,
 *      ठीक है" rather than "हाँ, कर रहा हूँ", "सुरक्षित नहीं है" rather than
 *      "मैं सुरक्षित नहीं हूँ". That constraint is why some phrasings are
 *      slightly less colloquial than they could be; it is deliberate.
 *
 *   4. SHORT, AND READABLE AT A GLANCE. This is read one-handed, in a moving
 *      cab, possibly in sunlight. The register is the formal `आप` + imperative
 *      the audit identified as correct and worth preserving from the prototype
 *      — but NOT that prototype's vocabulary, which it found to be
 *      government-circular Hindi carrying untranslated jargon
 *      ("सेवा अंतराल" for headway, "अस्थायी कॉरिडोर पुनर्संतुलन") and, in the
 *      breakdown string, a calque ambiguous enough to be a safety hazard. None
 *      of those four strings are reused here. Everything below is written from
 *      scratch in everyday words.
 *
 * ─── STILL OWED: A NATIVE REVIEW ─────────────────────────────────────────
 *
 * The audit's judgement was that Hindi on a driver screen needs a native UP
 * Hindi speaker's sign-off before it reaches a real driver, and this module
 * does not discharge that. What it changes is the shape of the remaining work:
 * the review is now one pass over one table of short phrases, rather than an
 * archaeology exercise across components. Nothing here is safety-critical
 * instruction text — the control room's own reason for a command is passed
 * through verbatim and is NOT translated (see `commandReason`), because
 * machine-translating a dispatcher's free text in a cab is exactly the failure
 * this product exists not to commit.
 */

/** An English string and its Hindi counterpart. Both required, always. */
export interface DriverPhrase {
  en: string;
  hi: string;
}

function phrase(en: string, hi: string): DriverPhrase {
  return { en, hi };
}

/**
 * The three answers, in the order they are shown.
 *
 * ORDER IS FIXED AND THE THREE ARE PEERS. `accept` is first because it is the
 * most common answer, not because it is the preferred one. The two refusals
 * follow, and the console renders all three at identical size and weight —
 * the previous design gave them a green/amber/crimson ramp, which reads as
 * good/warning/alarm and made "this is not safe" look like a driver
 * confessing to something. Refusing is a correct use of this screen.
 */
export const RESPONSE_CHOICES = [
  {
    outcome: 'accept' as const,
    label: phrase('Yes, doing it', 'हाँ, ठीक है'),
    /** What the driver is confirming, in case the button alone is ambiguous. */
    hint: phrase('You are carrying out this instruction', 'आप यह निर्देश पूरा कर रहे हैं'),
  },
  {
    outcome: 'unable' as const,
    label: phrase('Cannot do it', 'नहीं कर सकते'),
    hint: phrase('Something is stopping you doing this', 'कोई वजह है जिससे यह नहीं हो सकता'),
  },
  {
    outcome: 'unsafe' as const,
    label: phrase('Not safe', 'सुरक्षित नहीं है'),
    hint: phrase('Doing this now would not be safe', 'अभी ऐसा करना सुरक्षित नहीं होगा'),
  },
] as const;

export type ResponseChoice = (typeof RESPONSE_CHOICES)[number];

/**
 * The reassurance, and the single most important sentence on this screen.
 *
 * A driver who believes that answering "not safe" counts against them will
 * answer "yes" and then not do it, which is strictly worse than an honest
 * refusal: the control room would be reasoning about a bus it thinks is
 * complying. The original English said it and the Hindi-speaking half of the
 * workforce never saw it. It is stated in both languages, next to the buttons,
 * not buried in a footer.
 */
export const NO_PENALTY = phrase(
  'All three answers are recorded the same way. Nothing happens to you for any of them.',
  'तीनों जवाब एक जैसे दर्ज होते हैं। किसी भी जवाब पर कोई कार्रवाई नहीं होती।',
);

/** Everything the command console says about itself. */
export const CONSOLE_COPY = {
  instructionHeading: phrase('Instruction from control room', 'नियंत्रण कक्ष से निर्देश'),
  noInstruction: phrase('No instruction right now.', 'अभी कोई निर्देश नहीं है।'),
  timeLeft: phrase('Time left to answer', 'जवाब देने का समय'),
  yourBus: phrase('Your bus', 'आपकी बस'),
  answerSent: phrase('Answer sent.', 'जवाब भेज दिया गया।'),
  answerQueued: phrase(
    'Answer saved on this phone. It will be sent as soon as you have signal.',
    'जवाब इस फ़ोन में सुरक्षित है। सिग्नल आते ही भेज दिया जाएगा।',
  ),
  answerNotSaved: phrase(
    'Your answer could not be saved on this phone. Press the button again.',
    'जवाब इस फ़ोन में सुरक्षित नहीं हो सका। बटन दोबारा दबाएँ।',
  ),
  offline: phrase(
    'No network. This is the last instruction received. Your answer will be saved and sent when you have signal.',
    'नेटवर्क नहीं है। यह आख़िरी मिला हुआ निर्देश है। आपका जवाब सुरक्षित रहेगा और सिग्नल आने पर भेज दिया जाएगा।',
  ),
  unreachable: phrase(
    'Cannot reach the control room. This is the last instruction received.',
    'नियंत्रण कक्ष से संपर्क नहीं हो पा रहा। यह आख़िरी मिला हुआ निर्देश है।',
  ),
  findingBus: phrase('Finding your bus…', 'आपकी बस खोजी जा रही है…'),
  noBusAssigned: phrase(
    'No bus is assigned to your account yet. Ask your depot office to assign one.',
    'आपके खाते से अभी कोई बस नहीं जुड़ी है। अपने डिपो कार्यालय से बस जुड़वाएँ।',
  ),
  busLookupFailed: phrase(
    'Could not find your bus. Pull down to reload.',
    'आपकी बस नहीं मिल सकी। दोबारा लोड करने के लिए नीचे खींचें।',
  ),
  waitingForBus: phrase(
    'You will see instructions here once a bus is assigned to you.',
    'जैसे ही आपसे कोई बस जुड़ेगी, निर्देश यहाँ दिखेंगे।',
  ),
} as const;

/**
 * Words that must never appear anywhere in this table, in either language.
 *
 * Asserted over the whole module by driverCopy.test.ts rather than reviewed by
 * eye. The English list is the vocabulary of fault; the Hindi list is its
 * counterpart (कार्रवाई "action taken against", दंड/जुर्माना "penalty",
 * ग़लती "mistake", दोष "blame", चेतावनी "warning").
 *
 * `कार्रवाई` is the one exception and it is deliberate: NO_PENALTY uses it to
 * say that no action IS taken. The test therefore checks for it everywhere
 * except in the phrase whose whole job is to negate it.
 */
export const BLAME_WORDS = [
  'penalty',
  'penalise',
  'penalize',
  'fault',
  'blame',
  'failure to',
  'refused to',
  'non-compliance',
  'noncompliance',
  'violation',
  'warning will',
  'against you',
  'दंड',
  'जुर्माना',
  'ग़लती',
  'गलती',
  'दोष',
] as const;

/** Every phrase in this module, for the tests that check the whole vocabulary. */
export function allDriverPhrases(): Array<{ key: string; phrase: DriverPhrase }> {
  const entries: Array<{ key: string; phrase: DriverPhrase }> = [];
  for (const choice of RESPONSE_CHOICES) {
    entries.push({ key: `${choice.outcome}.label`, phrase: choice.label });
    entries.push({ key: `${choice.outcome}.hint`, phrase: choice.hint });
  }
  entries.push({ key: 'NO_PENALTY', phrase: NO_PENALTY });
  for (const [key, value] of Object.entries(CONSOLE_COPY)) {
    entries.push({ key: `CONSOLE_COPY.${key}`, phrase: value });
  }
  return entries;
}
