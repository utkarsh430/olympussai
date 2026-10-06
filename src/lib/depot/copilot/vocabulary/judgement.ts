import { words } from '@/lib/depot/copilot/vocabulary/function';

/*
 * Closing review M-B (round 9). The copilot never states a cause for a fuel
 * variance, never blames or characterises a person, and never raises a safety
 * or urgency alarm. A sentence without a figure meets no figure rule, so these
 * words are kept out of the closed vocabulary altogether: none is listed, and
 * `isVocabularyWord` refuses every form below even if a later edit lists one.
 */

/** Person and role words, cause and blame words, alarm words: every form refused. */
export const JUDGEMENT_WORDS: readonly string[] = words(`
driver drivers conductor conductors crew crews crewed staff staffs staffed staffing
manager managers operator operators employee employees worker workers supervisor supervisors
officer officers man men people peoples person persons anyone someone who whom he she him his
her
cause causes caused causing causal because due reason reasons reasoned blame blames blamed
blaming fault faults faulty negligence negligent misuse misused misuses abuse abused abuses
theft thefts stolen steal steals stealing stole pilferage pilfer pilfered fraud frauds
fraudulent tamper tampered tampering suspect suspects suspected suspicious suspicion guilty
guilt responsible responsibility responsibilities
safe safely unsafe safety danger dangers dangerous hazard hazards hazardous incident incidents
accident accidents emergency emergencies urgent urgently urgency critical critically alarm
alarms alarming alert alerts alerted alerting risk risks risked risking risky fail fails failed
failing failure failures
`);

/**
 * The only uses the scripted writer needs, each a fixed phrase it writes word for
 * word. A judgement word renders only as part of one of these phrases, with no
 * mark inside the phrase; anywhere else it is outside the vocabulary.
 *  - "due to leave": the departures answer ("5 buses due to leave now").
 *  - "rated critical": the exceptions answer's severity word ("Rated critical: …").
 *  - "questions about people": the out-of-scope answer for a question on a person.
 */
export const BOUND_PHRASES: readonly (readonly string[])[] = [
  words('due to leave'),
  words('rated critical'),
  words('questions about people'),
];
