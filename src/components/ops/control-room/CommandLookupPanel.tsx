'use client';

import { useState } from 'react';
import type { Command, CommandAuditLogEntry } from '@/models/control';

type LookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; command: Command; auditLog: CommandAuditLogEntry[] };

/**
 * Incident timeline's "ack" and "outcome" stages (this ticket's AC3).
 * There is no stored link yet from an ops_dispatcher_actions decision to a
 * control-service commandId — no REST client that actually dispatches a
 * command to control-service exists in this app (see this file's route
 * handler doc comment) — so this is an explicit lookup rather than an
 * automatic join: an operator who has a commandId (e.g. from a test
 * dispatch against control-service, or once that client ships) pastes it
 * in to see the driver's ack (accept/unable/unsafe) and the command's
 * final status, sourced from control-service's append-only
 * command_audit_log (GET /v1/commands/:id/audit — "sole source of truth
 * for lifecycle reconstruction").
 */
export function CommandLookupPanel() {
  const [commandId, setCommandId] = useState('');
  const [state, setState] = useState<LookupState>({ status: 'idle' });

  async function lookup(event: React.FormEvent) {
    event.preventDefault();
    if (state.status === 'loading') return;
    setState({ status: 'loading' });
    try {
      const response = await fetch(`/api/ops/control-room/commands/${commandId}`, { cache: 'no-store' });
      const data = (await response.json().catch(() => null)) as
        | { command: Command; auditLog: CommandAuditLogEntry[] }
        | { error: { message: string } }
        | null;
      if (!response.ok || !data || 'error' in data) {
        setState({ status: 'error', message: (data && 'error' in data && data.error.message) || 'Command not found.' });
        return;
      }
      setState({ status: 'ready', command: data.command, auditLog: data.auditLog });
    } catch {
      setState({ status: 'error', message: 'Something went wrong. Please try again.' });
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={lookup} className="flex flex-wrap items-end gap-2">
        <div className="min-w-[280px] flex-1">
          <label htmlFor="command-lookup-id" className="mb-1 block text-xs text-ops-muted">
            Control-service command id
          </label>
          <input
            id="command-lookup-id"
            value={commandId}
            onChange={(e) => setCommandId(e.target.value)}
            placeholder="uuid"
            className="ops-input"
          />
        </div>
        <button
          type="submit"
          disabled={state.status === 'loading' || commandId.trim().length === 0}
          className="ops-button-primary px-4 py-2"
        >
          {state.status === 'loading' ? 'Looking up…' : 'Look up'}
        </button>
      </form>

      {state.status === 'error' && (
        <p role="alert" className="text-sm text-alert-crimson">
          {state.message}
        </p>
      )}

      {state.status === 'ready' && (
        <div className="space-y-3">
          <div className="rounded-md border border-ops-line px-4 py-3 text-sm">
            <p>
              Status: <span className="font-mono text-ops-ink">{state.command.status}</span>
              {state.command.ackOutcome ? (
                <>
                  {' '}
                  · Driver ack: <span className="font-mono text-ops-ink">{state.command.ackOutcome}</span>
                </>
              ) : null}
            </p>
            <p className="mt-1 text-ops-muted">
              Delivered: {state.command.deliveredAt ? new Date(state.command.deliveredAt).toLocaleString() : 'not yet'}
            </p>
            <p className="mt-1 text-ops-muted">
              Acknowledged: {state.command.acknowledgedAt ? new Date(state.command.acknowledgedAt).toLocaleString() : 'not yet'}
              {state.command.acknowledgementReason ? ` — ${state.command.acknowledgementReason}` : ''}
            </p>
          </div>

          <div className="overflow-x-auto rounded-md border border-ops-line">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ops-line text-[10px] uppercase tracking-[0.12em] text-ops-muted">
                  <th className="px-3 py-2">Event</th>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2">When</th>
                </tr>
              </thead>
              <tbody>
                {state.auditLog.map((entry) => (
                  <tr key={entry.id} className="border-b border-ops-line/60 last:border-0">
                    <td className="px-3 py-2 font-mono text-xs text-ops-ink">{entry.eventType}</td>
                    <td className="px-3 py-2 text-xs text-ops-muted">
                      {entry.actorType}
                      {entry.actorId ? ` (${entry.actorId})` : ''}
                    </td>
                    <td className="px-3 py-2 text-xs text-ops-muted">{entry.reason ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-ops-muted">{new Date(entry.occurredAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
