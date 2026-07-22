/**
 * Local demonstration audit trail (browser localStorage).
 *
 * Deliberately stores only compact demonstration events. Raw upstream GPS
 * payloads are never persisted.
 */

export type AuditEventType =
  | 'bus-selected'
  | 'schedule-fetched'
  | 'scenario-launched'
  | 'alert-displayed'
  | 'suggestion-approved'
  | 'suggestion-modified'
  | 'suggestion-rejected'
  | 'message-sent'
  | 'acknowledgement-received'
  | 'call-started'
  | 'call-ended'
  | 'scenario-completed'
  | 'demo-reset';

export interface AuditEvent {
  id: string;
  type: AuditEventType;
  at: string;
  summary: string;
  registrationNumber?: string;
  /** False only for events sourced from live UPSRTC data. Exports keep this. */
  simulated: boolean;
  detail?: string;
}

export const AUDIT_STORAGE_KEY = 'upsrtc-copilot-audit-v1';
const MAX_EVENTS = 250;

export const AUDIT_EVENT_LABELS: Record<AuditEventType, string> = {
  'bus-selected': 'Bus selected',
  'schedule-fetched': 'Schedule fetched',
  'scenario-launched': 'Scenario launched',
  'alert-displayed': 'Alert displayed',
  'suggestion-approved': 'Suggestion approved',
  'suggestion-modified': 'Suggestion modified',
  'suggestion-rejected': 'Suggestion rejected',
  'message-sent': 'Message prepared and sent',
  'acknowledgement-received': 'Driver acknowledgement received',
  'call-started': 'Voice call started',
  'call-ended': 'Voice call ended',
  'scenario-completed': 'Scenario completed',
  'demo-reset': 'Session reset',
};

function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readAuditLog(): AuditEvent[] {
  const storage = safeStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(AUDIT_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is AuditEvent =>
        typeof item === 'object' && item !== null && 'id' in item && 'type' in item,
    );
  } catch {
    return [];
  }
}

export function writeAuditLog(events: AuditEvent[]): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(events.slice(0, MAX_EVENTS)));
  } catch {
    // Quota or private-mode failure: the demo continues without persistence.
  }
}

export function appendAuditEvent(
  events: AuditEvent[],
  event: Omit<AuditEvent, 'id' | 'at'> & { at?: string },
): AuditEvent[] {
  const entry: AuditEvent = {
    ...event,
    at: event.at ?? new Date().toISOString(),
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  };
  return [entry, ...events].slice(0, MAX_EVENTS);
}

export function clearAuditLog(): AuditEvent[] {
  const storage = safeStorage();
  try {
    storage?.removeItem(AUDIT_STORAGE_KEY);
  } catch {
    // ignore
  }
  return [];
}

export function exportAuditJson(events: AuditEvent[]): string {
  return JSON.stringify(
    {
      product: 'TitanX AI',
      exportedAt: new Date().toISOString(),
      notice:
        'Prototype audit trail. Vehicle identity and position are live UPSRTC data; alerts, analyses, messages and calls are model-driven and were not transmitted.',
      eventCount: events.length,
      events,
    },
    null,
    2,
  );
}

export function exportAuditSummary(events: AuditEvent[]): string {
  const counts = new Map<AuditEventType, number>();
  for (const event of events) {
    counts.set(event.type, (counts.get(event.type) ?? 0) + 1);
  }

  const lines = [
    'TITANX AI — SESSION SUMMARY',
    '='.repeat(56),
    `Generated: ${new Date().toISOString()}`,
    `Total events: ${events.length}`,
    '',
    'EVENT BREAKDOWN',
    '-'.repeat(56),
    ...[...counts.entries()].map(
      ([type, count]) => `  ${AUDIT_EVENT_LABELS[type].padEnd(34)} ${count}`,
    ),
    '',
    'CHRONOLOGY (most recent first)',
    '-'.repeat(56),
    ...events
      .slice(0, 60)
      .map(
        (event) =>
          `  ${new Date(event.at).toLocaleTimeString('en-IN')}  ${event.simulated ? '[MODEL]' : '[LIVE] '} ${event.summary}`,
      ),
    '',
    'NOTICE',
    '-'.repeat(56),
    '  Vehicle positions and schedules are live UPSRTC data.',
    '  Alerts, recommendations, traffic, demand and breakdown conditions are',
    '  model projections, not confirmed operational events.',
    '  No driver was contacted. No operational instruction was executed.',
  ];

  return lines.join('\n');
}

export function downloadTextFile(filename: string, contents: string, mime: string): void {
  if (typeof window === 'undefined') return;
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
