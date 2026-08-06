/**
 * Pure prompt-building + citation derivation for the copilot module. No I/O,
 * no `server-only` — deliberately usable from a plain vitest environment
 * (src/tests/unit/copilotPrompts.test.ts) so the grounding/citation contract
 * is exercised without mocking Postgres or the Anthropic API.
 *
 * Design choice that makes "NL query answers cite source records" a
 * guarantee rather than a hope: the `citations` array returned to the
 * client is never parsed out of the model's free-text answer. It is built
 * directly, in this file, from the same evidence records handed to the
 * model — the model can only ever be shown a fixed, enumerated set of
 * facts (each tagged with a stable record id), and whatever the model
 * writes, the citation list attached to the response is exactly that
 * evidence set. See buildIncidentExplanationPrompt/buildNlQueryPrompt/
 * buildShiftReportPrompt below.
 */
import type { BunchingIncident } from '@/models/control';
import type { CopilotSourceCitation } from '@/models/copilot';
import type { AuditEventForGrounding, BreakdownReportForGrounding } from './grounding';

const BASE_SYSTEM_PROMPT = `You are the Olympuss control-room copilot. You explain bus-fleet bunching incidents, draft shift-report handoffs, and answer operator questions.

Rules, non-negotiable:
1. Use ONLY the evidence listed under "Evidence" below. Never invent a vehicle id, timestamp, incident id, or event that is not listed there.
2. Every factual claim must be traceable to one of the evidence records by its bracketed id, e.g. "[incident:abc-123]" or "[audit:def-456]".
3. If the evidence does not support an answer to the question asked, say so plainly instead of guessing.
4. You never recommend, approve, or imply the execution of an operational command (holding a vehicle, short-turning, etc.) — that is a separate, human-authorized workflow you have no part in. You only explain, summarize, and answer questions about what has already happened.
5. Be concise and factual. This text may be read by a dispatcher during a live shift.`;

function incidentEvidenceLine(incident: BunchingIncident): string {
  const members = incident.members.length > 0
    ? incident.members.map((m) => `${m.vehicleId} (${m.role})`).join(', ')
    : 'none recorded';
  const evidenceJson = JSON.stringify(incident.evidence ?? {});
  return `[incident:${incident.id}] route-direction=${incident.routeDirectionId} severity=${incident.severity} status=${incident.status} cause=${incident.causeClass} controllability=${incident.controllability} started=${incident.startedAt} ended=${incident.endedAt ?? 'still open'} members=${members} evidence=${evidenceJson}`;
}

function incidentCitation(incident: BunchingIncident): CopilotSourceCitation {
  return {
    recordType: 'incident',
    recordId: incident.id,
    summary: `${incident.severity} bunching incident on ${incident.routeDirectionId}, opened ${incident.startedAt}`,
  };
}

function auditEvidenceLine(event: AuditEventForGrounding): string {
  return `[audit:${event.id}] action=${event.action} role=${event.actorRole} resource=${event.resourceType ?? 'n/a'}:${event.resourceId ?? 'n/a'} at=${event.createdAt} metadata=${JSON.stringify(event.metadata)}`;
}

function auditCitation(event: AuditEventForGrounding): CopilotSourceCitation {
  return {
    recordType: 'audit_event',
    recordId: event.id,
    summary: `${event.action} by ${event.actorRole} at ${event.createdAt}`,
  };
}

function breakdownEvidenceLine(report: BreakdownReportForGrounding): string {
  return `[breakdown:${report.id}] vehicle=${report.vehicleReg} category=${report.category} at=${report.createdAt} description=${JSON.stringify(report.description)}`;
}

function breakdownCitation(report: BreakdownReportForGrounding): CopilotSourceCitation {
  return {
    recordType: 'breakdown_report',
    recordId: report.id,
    summary: `${report.category} report for ${report.vehicleReg} at ${report.createdAt}`,
  };
}

export interface GroundedPrompt {
  system: string;
  prompt: string;
  /** The authoritative citation set — every evidence record shown to the model, regardless of whether its final answer happened to reference each one. */
  citations: CopilotSourceCitation[];
}

export function buildIncidentExplanationPrompt(
  incident: BunchingIncident | null,
  relatedAuditEvents: AuditEventForGrounding[],
): GroundedPrompt {
  if (!incident) {
    return {
      system: BASE_SYSTEM_PROMPT,
      prompt: `Evidence:\n(none — the requested incident is not currently open, or does not exist)\n\nTask: Explain that no matching open incident was found, without inventing one.`,
      citations: [],
    };
  }

  const lines = [incidentEvidenceLine(incident), ...relatedAuditEvents.map(auditEvidenceLine)];
  const citations = [incidentCitation(incident), ...relatedAuditEvents.map(auditCitation)];

  const prompt = `Evidence:\n${lines.join('\n')}\n\nTask: Write a short (3-6 sentence) narrative explanation of this bunching incident for a control-room dispatcher: what happened, which vehicles were involved, its severity/cause/controllability, and its current status. Cite the evidence ids inline as you go.`;

  return { system: BASE_SYSTEM_PROMPT, prompt, citations };
}

export function buildNlQueryPrompt(
  question: string,
  incidents: BunchingIncident[],
  auditEvents: AuditEventForGrounding[],
  breakdownReports: BreakdownReportForGrounding[],
): GroundedPrompt {
  const lines = [
    ...incidents.map(incidentEvidenceLine),
    ...auditEvents.map(auditEvidenceLine),
    ...breakdownReports.map(breakdownEvidenceLine),
  ];
  const citations = [
    ...incidents.map(incidentCitation),
    ...auditEvents.map(auditCitation),
    ...breakdownReports.map(breakdownCitation),
  ];

  const evidenceBlock = lines.length > 0 ? lines.join('\n') : '(no matching evidence records)';
  const prompt = `Evidence:\n${evidenceBlock}\n\nQuestion: ${question}\n\nTask: Answer the question using only the evidence above, citing record ids inline. If the evidence does not cover the question, say so explicitly.`;

  return { system: BASE_SYSTEM_PROMPT, prompt, citations };
}

export interface ShiftReportPeriod {
  shiftLabel: string;
  periodStart: string;
  periodEnd: string;
  routeDirectionId?: string;
}

export function buildShiftReportPrompt(
  period: ShiftReportPeriod,
  openIncidents: BunchingIncident[],
  auditEvents: AuditEventForGrounding[],
  breakdownReports: BreakdownReportForGrounding[],
): GroundedPrompt {
  const lines = [
    ...openIncidents.map(incidentEvidenceLine),
    ...auditEvents.map(auditEvidenceLine),
    ...breakdownReports.map(breakdownEvidenceLine),
  ];
  const citations = [
    ...openIncidents.map(incidentCitation),
    ...auditEvents.map(auditCitation),
    ...breakdownReports.map(breakdownCitation),
  ];

  const evidenceBlock = lines.length > 0 ? lines.join('\n') : '(no incident or audit records for this period)';
  const scope = period.routeDirectionId ? ` on route-direction ${period.routeDirectionId}` : ' across the fleet';
  const prompt = `Evidence (shift "${period.shiftLabel}", ${period.periodStart} to ${period.periodEnd}${scope}):\n${evidenceBlock}\n\nTask: Draft a shift handoff report for the incoming shift. Structure it as:\n- Summary (1-2 sentences)\n- Incidents (currently-open bunching incidents, cite each)\n- Notable events (audit/breakdown activity in this period, cite each)\n- Open items for the incoming shift to watch\nThis draft is AI-generated and will be reviewed by a human dispatcher before it is saved or sent — write it as a draft for review, not a final communication. Cite evidence ids inline.`;

  return { system: BASE_SYSTEM_PROMPT, prompt, citations };
}
