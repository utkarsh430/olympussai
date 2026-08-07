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
          <label htmlFor="command-lookup-id" className="mb-1 block text-xs text-[#9aa0ad]">
            Control-service command id
          </label>
          <input
            id="command-lookup-id"
            value={commandId}
            onChange={(e) => setCommandId(e.target.value)}
            placeholder="uuid"
            className="w-full rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-3 py-2 text-sm text-[#e6e9ef] placeholder:text-[#707580] focus:border-[#4f8cff]/70 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={state.status === 'loading' || commandId.trim().length === 0}
          className="rounded-md border border-[#4f8cff]/60 bg-[#4f8cff]/12 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#8fb4ff] hover:bg-[#4f8cff]/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state.status === 'loading' ? 'Looking up…' : 'Look up'}
        </button>
      </form>

      {state.status === 'error' && (
        <p role="alert" className="text-sm text-[#f0857d]">
          {state.message}
        </p>
      )}

      {state.status === 'ready' && (
        <div className="space-y-3">
          <div className="rounded-md border border-[rgba(255,255,255,0.08)] px-4 py-3 text-sm">
            <p>
              Status: <span className="font-mono text-[#e6e9ef]">{state.command.status}</span>
              {state.command.ackOutcome ? (
                <>
                  {' '}
                  · Driver ack: <span className="font-mono text-[#e6e9ef]">{state.command.ackOutcome}</span>
                </>
              ) : null}
            </p>
            <p className="mt-1 text-[#9aa0ad]">
              Delivered: {state.command.deliveredAt ? new Date(state.command.deliveredAt).toLocaleString() : 'not yet'}
            </p>
            <p className="mt-1 text-[#9aa0ad]">
              Acknowledged: {state.command.acknowledgedAt ? new Date(state.command.acknowledgedAt).toLocaleString() : 'not yet'}
              {state.command.acknowledgementReason ? ` — ${state.command.acknowledgementReason}` : ''}
            </p>
          </div>

          <div className="overflow-x-auto rounded-md border border-[rgba(255,255,255,0.08)]">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[rgba(255,255,255,0.08)] text-[10px] uppercase tracking-[0.12em] text-[#6f7684]">
                  <th className="px-3 py-2">Event</th>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2">When</th>
                </tr>
              </thead>
              <tbody>
                {state.auditLog.map((entry) => (
                  <tr key={entry.id} className="border-b border-[rgba(255,255,255,0.05)] last:border-0">
                    <td className="px-3 py-2 font-mono text-xs text-[#e6e9ef]">{entry.eventType}</td>
                    <td className="px-3 py-2 text-xs text-[#9aa0ad]">
                      {entry.actorType}
                      {entry.actorId ? ` (${entry.actorId})` : ''}
                    </td>
                    <td className="px-3 py-2 text-xs text-[#9aa0ad]">{entry.reason ?? '—'}</td>
                    <td className="px-3 py-2 text-xs text-[#9aa0ad]">{new Date(entry.occurredAt).toLocaleString()}</td>
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
