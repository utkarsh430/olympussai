/**
 * The words this product puts in front of UPSRTC operations staff and drivers.
 *
 * ─── WHY WORDS GET A TEST FILE ───────────────────────────────────────────
 *
 * Three separate places in this codebase turned an enum into a phrase, and a
 * dozen more rendered the wire value with its underscores taken out. The
 * result was one bus described two ways on two screens, and an academic
 * transit taxonomy printed to a depot supervisor with no gloss anywhere.
 *
 * These readers are UPSRTC operations staff and drivers, largely reading
 * English as a second language. A word they cannot decode is not a rough edge;
 * it is the screen failing at the only job it has.
 *
 * What these tests hold is not spelling. It is the two properties that make
 * the vocabulary trustworthy:
 *
 *   1. NO WIRE VALUE REACHES A READER. Not `dwelling_at_stop`, not
 *      `limited_auto`, not `endogenous`.
 *   2. NO DISTINCTION IS LOST TO SIMPLIFICATION. Every enum value keeps its
 *      own phrase, and `unknown` stays honestly unknown rather than being
 *      folded into one of the real answers.
 */
import { describe, it, expect } from 'vitest';
import { STOP_STATE_LABEL, stopStateLabel } from '@/lib/ops/vehicleActivity';
import {
  CAUSE_LABEL,
  CONTROLLABILITY_LABEL,
  describeCause,
  describeControllability,
} from '@/lib/ops/incidentCause';
import {
  ROLLOUT_STAGE_LABEL,
  ROLLOUT_STAGE_MEANING,
  ROLLOUT_STAGE_ORDER,
  permitsCommands,
  rolloutStageLabel,
  stageChangeActionLabel,
} from '@/lib/ops/rolloutPosture';

/** Every wire value that must never reach a reader, across all three enums. */
const WIRE_VALUES = [
  'approaching_stop',
  'dwelling_at_stop',
  'held_by_controller',
  'stopped_in_traffic',
  'departed_stop',
  'off_route',
  'endogenous',
  'exogenous',
  'limited_auto',
  'observation',
  'shadow',
  'advisory',
  'expanded',
  'mitigable',
  'controllable',
];

function containsNoWireValue(phrase: string) {
  for (const wire of WIRE_VALUES) {
    expect(phrase.toLowerCase(), `"${phrase}" leaks the wire value "${wire}"`).not.toContain(wire);
  }
}

describe('what a bus is doing', () => {
  it('never shows a reader the wire value with its underscores removed', () => {
    for (const label of Object.values(STOP_STATE_LABEL)) {
      expect(label).not.toMatch(/_/);
      containsNoWireValue(label);
    }
  });

  it('drops "dwelling", which is planning vocabulary and not an operator word', () => {
    expect(STOP_STATE_LABEL.dwelling_at_stop).toBe('Waiting at a stop');
  });

  it('separates a bus HELD ON PURPOSE from one merely stopped', () => {
    // Both are "stopped" to somebody glancing at a column, and only one of
    // them is something the control room did deliberately. Collapsing them
    // would hide the single most operationally relevant state in the list.
    expect(STOP_STATE_LABEL.held_by_controller).toContain('Held');
    expect(STOP_STATE_LABEL.held_by_controller).not.toBe(STOP_STATE_LABEL.stopped_in_traffic);
  });

  it('gives every state its own distinct phrase', () => {
    const labels = Object.values(STOP_STATE_LABEL);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('falls back to the raw value, not to a dash, for a state it has no word for', () => {
    // A seventh state must not make this column say "nothing to report" about
    // a bus that is plainly doing something. Ugly and honest beats tidy and
    // false.
    expect(stopStateLabel('some_new_state' as never)).toBe('some new state');
  });
});

describe('why buses are closing up, and who can act', () => {
  it('translates every cause, keeping each one distinct', () => {
    const phrases = Object.values(CAUSE_LABEL);
    expect(new Set(phrases).size).toBe(phrases.length);
    for (const phrase of phrases) containsNoWireValue(phrase);
  });

  it('translates every controllability, keeping each one distinct', () => {
    const phrases = Object.values(CONTROLLABILITY_LABEL);
    expect(new Set(phrases).size).toBe(phrases.length);
    for (const phrase of phrases) containsNoWireValue(phrase);
  });

  it('keeps "can fix" and "can only reduce" apart', () => {
    // This is the distinction the taxonomy exists for, and the one a plainer
    // rewrite would be most tempted to flatten. An operator told the control
    // room "can fix this" behaves differently from one told it can only take
    // the edge off.
    expect(describeControllability('controllable')).toMatch(/can fix this/i);
    expect(describeControllability('mitigable')).toMatch(/can reduce this, not fix it/i);
  });

  it('says an unknown cause is unknown rather than picking one of the real answers', () => {
    expect(describeCause('unknown')).toMatch(/not been established/i);
  });

  it('reads "structural" differently in the two enums, because it means two things', () => {
    // A cause built into the timetable, versus a situation nobody in the
    // control room can fix. One shared lookup would have merged them.
    expect(describeCause('structural')).not.toBe(describeControllability('structural'));
    expect(describeCause('structural')).toMatch(/timetable or the road/i);
    expect(describeControllability('structural')).toMatch(/cannot be fixed from the control room/i);
  });
});

describe('command permissions', () => {
  it('names every permission after what it allows, not after a programme rung', () => {
    for (const stage of ROLLOUT_STAGE_ORDER) {
      const label = ROLLOUT_STAGE_LABEL[stage];
      expect(label).not.toMatch(/_/);
      containsNoWireValue(label);
    }
  });

  it('makes the two closed permissions say "watch" and the open ones say "instructions"', () => {
    // The single fact an administrator needs from this label is whether an
    // instruction can reach a driver. It is in every one of the five.
    for (const stage of ROLLOUT_STAGE_ORDER) {
      const label = ROLLOUT_STAGE_LABEL[stage].toLowerCase();
      if (permitsCommands(stage)) expect(label, stage).toContain('instructions');
      else expect(label, stage).toContain('watch');
    }
  });

  it('describes a refusal as recorded, never as something that got through', () => {
    // "Guardrail breach" reads as damage done. These are refusals the system
    // logged — nothing reached a driver — and the difference matters to
    // whoever reads the count during a review.
    for (const stage of ROLLOUT_STAGE_ORDER.filter((s) => !permitsCommands(s))) {
      expect(ROLLOUT_STAGE_MEANING[stage], stage).toMatch(/blocked by a safety rule/i);
      expect(ROLLOUT_STAGE_MEANING[stage], stage).not.toMatch(/breach/i);
    }
  });

  it('names the button that stops instructions after exactly that', () => {
    // The one transition on this screen with an audience who is not in the
    // room. It must not share a verb with every other narrowing.
    expect(stageChangeActionLabel('advisory', 'observation')).toBe(
      'Stop instructions on this corridor',
    );
    expect(stageChangeActionLabel('expanded', 'shadow')).toBe('Stop instructions on this corridor');
  });

  it('does not use that alarming label for a narrowing that stops nothing', () => {
    // expanded -> advisory is narrower and nothing stops working. Warning an
    // admin about a consequence that will not happen is how warnings stop
    // being read at all.
    expect(stageChangeActionLabel('expanded', 'advisory')).not.toMatch(/stop instructions/i);
    expect(stageChangeActionLabel('expanded', 'advisory')).toMatch(/^narrow to:/i);
  });

  it('names an opening move after the permission it grants', () => {
    expect(stageChangeActionLabel('observation', 'advisory')).toMatch(/^allow instructions:/i);
    // Already open, going wider: not a grant, so not worded as one.
    expect(stageChangeActionLabel('advisory', 'expanded')).toMatch(/^widen to:/i);
  });

  it('treats setting the same permission again as a real act, not a no-op', () => {
    // Re-setting is how an admin re-stamps a reason, and the endpoint accepts
    // it. A label saying "no change" would misdescribe what it does.
    expect(stageChangeActionLabel('advisory', 'advisory')).toBe('Record this setting again');
  });

  describe('reading a stored history row', () => {
    it('translates a value that is still in the enum', () => {
      expect(rolloutStageLabel('limited_auto')).toBe(ROLLOUT_STAGE_LABEL.limited_auto);
    });

    it('keeps a retired value legible as itself rather than blanking it', () => {
      // Audit rows are typed as plain strings on purpose: they record what the
      // setting was called at the time. Somebody reading this row is usually
      // working out why an instruction did or did not go out, and a blank is
      // the worst possible answer for them.
      expect(rolloutStageLabel('some_retired_stage')).toBe('some retired stage');
    });
  });
});
