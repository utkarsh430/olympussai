import { describe, expect, it } from 'vitest';
import { renderDraft } from '@/lib/depot/copilot/render';
import { VOCABULARY_WORDS, isVocabularyWord } from '@/lib/depot/copilot/vocabulary';
import type { CopilotFact } from '@/lib/depot/copilot/types';

/*
 * No cause is ever stated for a fuel
 * variance, and no person is ever blamed or characterised. The words that exist
 * only to do that, or to raise a safety or urgency alarm, are not in the closed
 * vocabulary; the three the scripted writer needs stand only inside their phrase.
 */

const FACTS: readonly CopilotFact[] = [
  { id: 'name', label: 'Depot', text: 'AGRA', provenance: 'live', kind: 'name' },
  { id: 'other', label: 'Depot', text: 'KAUSHAMBI', provenance: 'live', kind: 'name' },
  { id: 'dark', label: 'Dark', text: '3 buses', provenance: 'live' },
  { id: 'crit', label: 'Rated critical', text: '2 exceptions', provenance: 'derived' },
];

const VOCABULARY_REASON = 'Draft uses a word outside the vocabulary';
const render = (headline: string, paragraph: string): ReturnType<typeof renderDraft> =>
  renderDraft({ headline, paragraphs: [paragraph] }, FACTS);

/** Drafts that state a cause, blame or alarm, then more of the same kind. */
const CAUSE_BLAME_ALARM_DRAFTS: readonly string[] = [
  'The driver at {{fact:name}} is the cause of the diesel loss.',
  'The fuel variance at {{fact:name}} is because of the staff.',
  'The depot manager at {{fact:name}} is the cause of the loss.',
  'The depot is not safe.',
  'Safety at {{fact:name}} is urgent; an incident is likely.',
  'The crew at {{fact:name}} caused the fuel variance.',
  'The conductor is responsible for the diesel loss.',
  'The fuel variance at {{fact:name}} is due to the depot.',
  'Due to the staff, the variance at {{fact:name}} is high.',
  'The staff at {{fact:name}} are to blame for the loss.',
  'The operator at {{fact:name}} is at fault.',
  'Employees at {{fact:name}} are the reason for the loss.',
  'The people at {{fact:name}} are poor at fuel.',
  'The question is who is behind the fuel variance at {{fact:name}}.',
  'The drivers at {{fact:name}} are weak.',
  'The depot is unsafe.',
  'Safety is the main concern at {{fact:name}}.',
  'There is a risk of an incident at {{fact:name}}.',
  'The fleet is in critical condition.',
  'The diesel loss at {{fact:name}} is urgent.',
  'The yard at {{fact:name}} is in an emergency.',
  'The depot failed the review.',
  'The depot is a failure on fuel.',
  'The engine fault caused the loss.',
  'He is the reason for the variance at {{fact:name}}.',
  'She is behind the diesel loss.',
  'The fuel loss happened because of the crew.',
  'The depot is safe.',
  'The loss at {{fact:name}} is critical.',
  'Critical: the depot is in trouble.',
  'The manager is behind the loss at {{fact:name}}.',
  'Questions about people at {{fact:name}} show the cause.',
  'The variance at {{fact:name}} is due to the driver.',
  'The diesel variance is a matter for the supervisor.',
  'The workers at {{fact:name}} need attention.',
  'An alert is raised for {{fact:name}}.',
  'Someone at {{fact:name}} is behind the loss.',
  'The loss at {{fact:name}} is an urgent risk.',
  'The fuel loss is the responsibility of the crew at {{fact:name}}.',
  'The loss is due to {{fact:other}}.',
];

describe('M-B: cause, blame and alarm drafts are refused', () => {
  it('holds the listed drafts and at least twenty more', () => {
    expect(CAUSE_BLAME_ALARM_DRAFTS.length).toBeGreaterThanOrEqual(25);
  });

  it.each(CAUSE_BLAME_ALARM_DRAFTS)('refuses: %s', (draft) => {
    expect(render('Depot briefing', draft)).toEqual({ ok: false, reason: VOCABULARY_REASON });
  });

  it.each(['Alert', 'Safety alert', 'Urgent', 'Critical'])('refuses the headline %s', (headline) => {
    const result = render(headline, 'The yard holds most of the fleet.');
    expect(result).toEqual({ ok: false, reason: VOCABULARY_REASON });
  });
});

/** The brief's list with plurals and verb forms; independent of the module that removes them. */
const FORBIDDEN_FORMS: readonly string[] = `
driver drivers conductor conductors crew crews crewed staff staffs staffed staffing
manager managers operator operators employee employees worker workers supervisor supervisors
officer officers man men people peoples person persons anyone someone who whom
he she him his her
cause causes caused causing because due reason reasons reasoned blame blames blamed blaming
fault faults faulty negligence negligent misuse misused misuses abuse abused abuses theft thefts
stolen steal steals stealing stole pilferage pilfer pilfered fraud frauds fraudulent tamper
tampered tampering suspect suspects suspected suspicious guilty guilt responsible
responsibility responsibilities
safe safely unsafe safety danger dangers dangerous hazard hazards hazardous incident incidents
accident accidents emergency emergencies urgent urgently urgency critical critically alarm
alarms alarming alert alerts alerted alerting risk risks risked risking risky fail fails failed
failing failure failures
`
  .trim()
  .split(/\s+/);

/** Allowed only inside the fixed phrase the scripted writer needs (vocabulary/judgement.ts). */
const BOUND_WORDS: readonly string[] = ['due', 'critical', 'people'];

describe('M-B: the vocabulary holds no cause, blame, person or alarm word', () => {
  it.each(FORBIDDEN_FORMS)('%s is neither listed nor buildable', (word) => {
    expect(VOCABULARY_WORDS).not.toContain(word);
    expect(isVocabularyWord(word)).toBe(false);
  });

  it('binds only the three words the scripted writer needs', () => {
    expect(BOUND_WORDS.every((w) => FORBIDDEN_FORMS.includes(w))).toBe(true);
  });
});

describe('M-B: a bound word renders only inside its phrase', () => {
  it.each([
    'Flagged at depot level: {{fact:dark}}. Rated critical: {{fact:crit}}.',
    'Of the buses with a known schedule, {{fact:dark}} are due to leave now.',
    'Questions about people are outside that scope.',
  ])('renders: %s', (paragraph) => {
    expect(render('Exceptions', paragraph)).toMatchObject({ ok: true });
  });

  it.each([
    'Rated: critical {{fact:crit}}.',
    'The rating is critical.',
    'Rated critically: {{fact:crit}}.',
    '{{fact:dark}} are due.',
    'Due to {{fact:name}}, {{fact:dark}} are dark.',
    'Questions, about people, are outside that scope.',
    'People are outside that scope.',
  ])('refuses: %s', (paragraph) => {
    expect(render('Exceptions', paragraph)).toEqual({ ok: false, reason: VOCABULARY_REASON });
  });
});
