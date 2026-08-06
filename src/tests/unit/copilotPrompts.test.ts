import { describe, it, expect } from 'vitest';
import {
  buildIncidentExplanationPrompt,
  buildNlQueryPrompt,
  buildShiftReportPrompt,
} from '@/lib/copilot/prompts';
import type { BunchingIncident } from '@/models/control';
import type { AuditEventForGrounding, BreakdownReportForGrounding } from '@/lib/copilot/grounding';

const incident: BunchingIncident = {
  id: 'incident-1',
  routeDirectionId: 'dir-1',
  members: [{ vehicleId: 'V1', role: 'leader' }, { vehicleId: 'V2', role: 'follower' }],
  severity: 'bunched',
  causeClass: 'endogenous',
  controllability: 'controllable',
  status: 'open',
  startedAt: '2026-08-06T10:00:00.000Z',
  endedAt: null,
  evidence: { hFwdSeconds: 45 },
};

const auditEvent: AuditEventForGrounding = {
  id: 'audit-1',
  actorRole: 'control_room',
  action: 'control_room.command.create',
  resourceType: 'command',
  resourceId: 'incident-1',
  metadata: { summary: 'held V2' },
  createdAt: '2026-08-06T10:05:00.000Z',
};

const breakdownReport: BreakdownReportForGrounding = {
  id: 'breakdown-1',
  vehicleReg: 'UP32AB1234',
  category: 'Mechanical',
  description: 'Brake issue',
  createdAt: '2026-08-06T09:00:00.000Z',
};

describe('buildIncidentExplanationPrompt', () => {
  it('grounds the prompt in the incident and its citations exactly match what was shown to the model', () => {
    const { system, prompt, citations } = buildIncidentExplanationPrompt(incident, [auditEvent]);

    expect(system).toContain('Use ONLY the evidence');
    expect(prompt).toContain('[incident:incident-1]');
    expect(prompt).toContain('[audit:audit-1]');
    expect(citations).toEqual([
      { recordType: 'incident', recordId: 'incident-1', summary: expect.any(String) },
      { recordType: 'audit_event', recordId: 'audit-1', summary: expect.any(String) },
    ]);
  });

  it('never fabricates an incident: a null incident produces an explicit "not found" instruction and zero citations', () => {
    const { prompt, citations } = buildIncidentExplanationPrompt(null, []);

    expect(prompt).toContain('none — the requested incident is not currently open');
    expect(citations).toEqual([]);
  });
});

describe('buildNlQueryPrompt', () => {
  it('includes the question and every grounding record as a citation', () => {
    const { prompt, citations } = buildNlQueryPrompt('Why is dir-1 bunched?', [incident], [auditEvent], [breakdownReport]);

    expect(prompt).toContain('Why is dir-1 bunched?');
    expect(prompt).toContain('[incident:incident-1]');
    expect(prompt).toContain('[breakdown:breakdown-1]');
    expect(citations).toHaveLength(3);
    expect(citations.map((c) => c.recordType).sort()).toEqual(['audit_event', 'breakdown_report', 'incident']);
  });

  it('tells the model to say so explicitly when there is no matching evidence', () => {
    const { prompt, citations } = buildNlQueryPrompt('Unrelated question', [], [], []);

    expect(prompt).toContain('no matching evidence records');
    expect(citations).toEqual([]);
  });
});

describe('buildShiftReportPrompt', () => {
  it('labels the draft as AI-generated and scopes evidence to the given period/route-direction', () => {
    const { prompt, citations } = buildShiftReportPrompt(
      { shiftLabel: 'Night shift', periodStart: '2026-08-06T00:00:00.000Z', periodEnd: '2026-08-06T08:00:00.000Z', routeDirectionId: 'dir-1' },
      [incident],
      [auditEvent],
      [breakdownReport],
    );

    expect(prompt).toContain('AI-generated');
    expect(prompt).toContain('reviewed by a human dispatcher before it is saved or sent');
    expect(prompt).toContain('route-direction dir-1');
    expect(citations).toHaveLength(3);
  });
});
