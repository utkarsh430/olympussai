// @vitest-environment jsdom
//
// The words this console uses for the values it receives.
//
// ─── WHY THIS FILE EXISTS ────────────────────────────────────────────────
//
// Two classes of defect, both of which every other gate passes straight
// through.
//
// The first is an enum reaching a screen raw: `endogenous`, `mitigable`,
// `rollout_stage_violation`, `dwelling_at_stop`. Typecheck is perfectly happy
// with `{incident.causeClass}` in JSX, and so is every render test that only
// asserts the element exists. The readers are UPSRTC operations staff for whom
// English is often a second language, and transit-research vocabulary is not
// English to anybody.
//
// The second is the opposite failure: a rename that is friendlier and WRONG.
// "Regularity %" for CV names a different statistic. "Total wait" for excess
// wait names a different number. "Stop all instructions" for a control that
// only stops NEW ones is a stronger claim than the system can keep. So the
// assertions below run in both directions — the jargon is gone, AND the
// meaning that made the jargon load-bearing is still there.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  ACK_OUTCOME_LABEL,
  CAUSE_CLASS_LABEL,
  COMMAND_STATUS_LABEL,
  COMPLIANCE_LABEL,
  CONTROLLABILITY_LABEL,
  INCIDENT_ROLE_LABEL,
  INCIDENT_SEVERITY_LABEL,
  INCIDENT_STATUS_LABEL,
  METRIC,
  SAFETY_BLOCK_LABEL,
  STOP_INSTRUCTIONS,
  STOP_STATE_LABEL,
  ackOutcomeLabel,
  causeClassLabel,
  commandAuditEventLabel,
  controllabilityLabel,
  corridorName,
  directionLabel,
  humaniseEnum,
  safetyBlockTypeLabel,
  stopStateLabel,
} from '@/lib/ops/vocabulary';
import { ActiveIncidentsPanel } from '@/components/ops/control-room/ActiveIncidentsPanel';
import type { BunchingIncident } from '@/models/control';

/** Every value the product can print, so a raw enum cannot slip past by being rare. */
const EVERY_LABEL_MAP = {
  'cause class': CAUSE_CLASS_LABEL,
  controllability: CONTROLLABILITY_LABEL,
  'incident status': INCIDENT_STATUS_LABEL,
  'incident severity': INCIDENT_SEVERITY_LABEL,
  'incident role': INCIDENT_ROLE_LABEL,
  'stop state': STOP_STATE_LABEL,
  'instruction status': COMMAND_STATUS_LABEL,
  'driver answer': ACK_OUTCOME_LABEL,
  compliance: COMPLIANCE_LABEL,
} as const;

describe('vocabulary — no enum reaches a screen wearing its own name', () => {
  /**
   * Enum values that are ALREADY an ordinary English word, where the label
   * differing from the value would be change for its own sake.
   *
   * Kept as an explicit list rather than as a looser rule: it is the line
   * between "this value needed translating and got it" and "this value needed
   * translating and was waved through".
   */
  const ALREADY_PLAIN = new Set([
    'open',
    'closed',
    'recovering',
    'escalated',
    'bunched',
    'severe',
    'cancelled',
  ]);

  it('never returns a value that still looks like an enum', () => {
    for (const [what, map] of Object.entries(EVERY_LABEL_MAP)) {
      for (const [value, label] of Object.entries(map)) {
        expect(label, `${what}.${value}`).not.toContain('_');
        expect(label.trim().length, `${what}.${value}`).toBeGreaterThan(0);
        if (!ALREADY_PLAIN.has(value)) {
          expect(label.toLowerCase(), `${what}.${value}`).not.toBe(value.toLowerCase());
        }
      }
    }
  });

  it('covers every value the model can produce, so nothing falls to the last-resort humaniser', () => {
    // The fallback exists so an unseen value degrades readably rather than
    // crashing. It is not a translation, and a value this product actually
    // emits must never rely on it.
    expect(Object.keys(CAUSE_CLASS_LABEL).sort()).toEqual([
      'endogenous',
      'exogenous',
      'structural',
      'unknown',
    ]);
    expect(Object.keys(CONTROLLABILITY_LABEL).sort()).toEqual([
      'controllable',
      'mitigable',
      'none',
      'structural',
    ]);
    expect(Object.keys(STOP_STATE_LABEL).sort()).toEqual([
      'approaching_stop',
      'departed_stop',
      'dwelling_at_stop',
      'held_by_controller',
      'off_route',
      'stopped_in_traffic',
    ]);
  });
});

describe('humaniseEnum — the last-resort pass, and the g-flag bug it closes', () => {
  it('replaces EVERY underscore, not only the first', () => {
    // `.replace('_', ' ')` without the g flag is the live defect this
    // function exists to make impossible: it rendered `od_timetable` as
    // "od timetable" on the simulator, which reads as deliberate wording
    // rather than as a bug. See §4.4 of the language audit.
    expect(humaniseEnum('rollout_stage_violation')).toBe('Rollout stage violation');
    expect(humaniseEnum('od_timetable')).toBe('Od timetable');
    expect(humaniseEnum('a_b_c_d')).toBe('A b c d');
  });

  it('returns the input rather than an empty string for a value it cannot improve', () => {
    expect(humaniseEnum('')).toBe('');
    expect(humaniseEnum('_')).toBe('_');
  });

  it('is what an unknown upstream value falls back to, in the two free-text columns', () => {
    // `breach_type` and audit `event_type` are free-text in control-service,
    // so their maps are best-effort and the fallback is the contract.
    expect(safetyBlockTypeLabel('something_new_upstream')).toBe('Something new upstream');
    expect(commandAuditEventLabel('command_recalled_by_ops')).toBe('Command recalled by ops');
    // But the one value actually written today is named properly.
    expect(safetyBlockTypeLabel('rollout_stage_violation')).toMatch(/not allowed to send/i);
  });
});

describe('vocabulary — the meaning that made the jargon load-bearing survives', () => {
  it('keeps CV as CV, because "regularity %" would name a different statistic', () => {
    expect(METRIC.cv.label).toContain('CV');
    // And gives the two anchors an operator needs to read the number at all.
    expect(METRIC.cv.hint).toContain('0.00');
    expect(METRIC.cv.hint).toContain('0.50');
  });

  it('keeps the word "extra" in excess wait, because dropping it changes the number', () => {
    expect(METRIC.excessWait.label.toLowerCase()).toContain('extra');
    expect(METRIC.excessWait.hint).toMatch(/beyond the planned gap/i);
    expect(METRIC.excessWait.label.toLowerCase()).not.toMatch(/^total/);
  });

  it('never promises that stopping instructions stops the ones already sent', () => {
    // This is the reason "kill switch" had to go, and it is a safety claim
    // rather than a style preference: an operator who believes they have
    // halted everything in flight has been misled by the control's name.
    expect(STOP_INSTRUCTIONS.title.toLowerCase()).toContain('new');
    expect(STOP_INSTRUCTIONS.gloss).toMatch(/already sent still stand/i);
    for (const value of Object.values(STOP_INSTRUCTIONS)) {
      expect(value.toLowerCase()).not.toContain('kill');
    }
  });

  it('says what a safety block IS — a refusal, not damage that got through', () => {
    expect(SAFETY_BLOCK_LABEL.toLowerCase()).toContain('blocked');
    expect(SAFETY_BLOCK_LABEL.toLowerCase()).not.toContain('breach');
  });

  it('does not soften the driver’s two refusals into failures', () => {
    // The driver console promises in as many words that "cannot do it" and
    // "not safe" carry no penalty. The control room's vocabulary has to agree
    // with the promise made at the wheel.
    expect(ackOutcomeLabel('unable').toLowerCase()).not.toMatch(/fail|refus|reject/);
    expect(ackOutcomeLabel('unsafe').toLowerCase()).not.toMatch(/fail|refus|reject/);
    expect(COMPLIANCE_LABEL.unable.toLowerCase()).not.toMatch(/fail|violat/);
  });

  it('names a corridor the same way everywhere, and never invents a direction', () => {
    // Direction codes measured against the live control database: OUT (666),
    // SINGLE (85), UP (17), IN (8).
    expect(corridorName({ routeId: '1002', directionCode: 'OUT' })).toBe('1002 outbound');
    expect(corridorName({ routeId: '77', directionCode: 'IN', isLoop: true })).toBe(
      '77 inbound (loop)',
    );
    expect(corridorName({ routeId: '5', directionCode: 'SINGLE' })).toBe('5 single direction');
    // A code this product has never seen comes back VERBATIM. Showing an
    // operator a code we cannot expand is honest; guessing a direction is not.
    expect(directionLabel('ZZ9')).toBe('ZZ9');
  });

  it('names the buses in an incident by where they are, not by their roles', () => {
    // "leader" and "follower" are correct and are also the two words most
    // easily read backwards at speed, on a screen whose whole subject is
    // which of two buses closed up on the other.
    expect(INCIDENT_ROLE_LABEL.leader).toBe('in front');
    expect(INCIDENT_ROLE_LABEL.follower).toBe('behind');
  });

  it('glosses the cause taxonomy into a claim rather than a category', () => {
    expect(causeClassLabel('endogenous')).toMatch(/service itself/i);
    expect(causeClassLabel('exogenous')).toMatch(/outside the service/i);
    // And "mitigable" says what the control room can actually do.
    expect(controllabilityLabel('mitigable')).toMatch(/reduce it, not fix it/i);
    expect(controllabilityLabel('none')).toMatch(/control room/i);
  });

  it('calls a bus waiting at a stop what it is', () => {
    expect(stopStateLabel('dwelling_at_stop')).toBe('Waiting at stop');
    expect(stopStateLabel('held_by_controller')).toMatch(/instruction/i);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   THE EMPTY STATE THAT WAS AN ALL-CLEAR IT HAD NOT EARNED
   ───────────────────────────────────────────────────────────────────────── */

function incident(patch: Partial<BunchingIncident> = {}): BunchingIncident {
  return {
    id: 'inc-1',
    routeDirectionId: 'rd-1',
    members: [
      { vehicleId: 'UP25FT9001', role: 'leader' },
      { vehicleId: 'UP25FT4823', role: 'follower' },
    ],
    severity: 'bunched',
    causeClass: 'endogenous',
    controllability: 'mitigable',
    status: 'open',
    startedAt: new Date().toISOString(),
    endedAt: null,
    evidence: {},
    ...patch,
  };
}

describe('buses closing up — an empty list is not automatically an all-clear', () => {
  it('reports a real all-clear only when the corridor can actually check', () => {
    render(<ActiveIncidentsPanel incidents={[]} canDetect />);
    expect(
      screen.getByText(/no buses are closing up on this corridor right now/i),
    ).toBeInTheDocument();
  });

  it('refuses to call an unwatched corridor clear', () => {
    // THE DEFECT: this panel said "No active bunching incidents on this
    // route-direction" whether or not the check could run. On the live
    // network 561 of 759 surveyed corridors have no planned gap, so the
    // detector never runs on them — and the sentence was reassurance drawn
    // from an absence of evidence, on a product whose premise is not doing
    // that.
    render(<ActiveIncidentsPanel incidents={[]} canDetect={false} />);
    expect(screen.getByText(/cannot be checked here/i)).toBeInTheDocument();
    expect(screen.getByText(/this is not an all-clear/i)).toBeInTheDocument();
    expect(screen.queryByText(/no buses are closing up/i)).not.toBeInTheDocument();
  });

  it('says so when it does not know whether the corridor can check', () => {
    // The control service may predate the flag. Unknown is neither of the
    // other two, and the panel must not pick the friendlier one.
    render(<ActiveIncidentsPanel incidents={[]} />);
    expect(screen.getByText(/not confirmed as an all-clear/i)).toBeInTheDocument();
  });

  it('never prints the raw taxonomy at an operator', () => {
    render(<ActiveIncidentsPanel incidents={[incident()]} canDetect />);
    expect(screen.queryByText(/endogenous/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/mitigable/i)).not.toBeInTheDocument();
    expect(screen.getByText(CAUSE_CLASS_LABEL.endogenous)).toBeInTheDocument();
    expect(screen.getByText(CONTROLLABILITY_LABEL.mitigable)).toBeInTheDocument();
  });

  it('names the bus in front and the bus behind, not the leader and the follower', () => {
    render(<ActiveIncidentsPanel incidents={[incident()]} canDetect />);
    expect(screen.getByText(/\(in front\)/)).toBeInTheDocument();
    expect(screen.getByText(/\(behind\)/)).toBeInTheDocument();
    expect(screen.queryByText(/\(leader\)/)).not.toBeInTheDocument();
  });

  it('says the buses were not recorded rather than showing an empty line', () => {
    render(<ActiveIncidentsPanel incidents={[incident({ members: [] })]} canDetect />);
    expect(screen.getByText(/were not recorded/i)).toBeInTheDocument();
  });

  it('names the severity in plain words', () => {
    render(<ActiveIncidentsPanel incidents={[incident({ severity: 'warning' })]} canDetect />);
    expect(screen.getByText(INCIDENT_SEVERITY_LABEL.warning)).toBeInTheDocument();
  });
});
