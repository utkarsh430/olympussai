'use client';

import { useState } from 'react';
import type { Command, CommandAuditLogEntry } from '@/models/control';
import {
  OpsAlert,
  OpsButton,
  OpsField,
  OpsIdentifier,
  OpsInput,
  OpsPanel,
  OpsReadout,
  OpsTableFrame,
  opsTableClass,
  opsTdClass,
  opsTdMutedClass,
  opsThClass,
  opsTheadRowClass,
  opsTrClass,
} from '@/components/ops/ui';
import { ackOutcomeLabel, commandAuditEventLabel, commandStatusLabel } from '@/lib/ops/vocabulary';

type LookupState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; command: Command; auditLog: CommandAuditLogEntry[] };

/**
 * Following one instruction that has already been sent.
 *
 * An operator pastes the reference they were given when they sent it and sees
 * whether it reached the driver's screen, what the driver answered, and the
 * full step-by-step record — sourced from control-service's append-only
 * command_audit_log (GET /v1/commands/:id/audit, its own documented "sole
 * source of truth for lifecycle reconstruction").
 *
 * It is an explicit lookup rather than an automatic join because there is no
 * stored link from an approval decision to a control-service command id.
 *
 * The three enum columns — status, driver answer, and event type — used to
 * render raw: `delivery_failed`, `unsafe`, `command_delivery_retried`. They now
 * go through src/lib/ops/vocabulary.ts. The driver-answer wording is not
 * cosmetic: the driver console promises in as many words that "cannot do it"
 * and "not safe" carry no penalty, and the control room's vocabulary has to
 * agree with the promise made at the wheel.
 */
export function CommandLookupPanel() {
  const [commandId, setCommandId] = useState('');
  const [state, setState] = useState<LookupState>({ status: 'idle' });

  async function lookup(event: React.FormEvent) {
    event.preventDefault();
    if (state.status === 'loading') return;
    setState({ status: 'loading' });
    try {
      const response = await fetch(`/api/ops/control-room/commands/${commandId}`, {
        cache: 'no-store',
      });
      const data = (await response.json().catch(() => null)) as
        | { command: Command; auditLog: CommandAuditLogEntry[] }
        | { error: { message: string } }
        | null;
      if (!response.ok || !data || 'error' in data) {
        setState({
          status: 'error',
          message:
            (data && 'error' in data && data.error.message) ||
            'No instruction was found with that reference. Check it and try again.',
        });
        return;
      }
      setState({ status: 'ready', command: data.command, auditLog: data.auditLog });
    } catch {
      setState({
        status: 'error',
        message: 'The record could not be reached. Try again.',
      });
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={lookup} className="flex flex-wrap items-end gap-2">
        <OpsField
          label="Instruction reference"
          htmlFor="command-lookup-id"
          hint="Shown when the instruction was sent."
          className="min-w-[280px] flex-1"
        >
          <OpsInput
            id="command-lookup-id"
            value={commandId}
            onChange={(e) => setCommandId(e.target.value)}
          />
        </OpsField>
        <OpsButton
          type="submit"
          variant="primary"
          className="px-4 py-2"
          disabled={state.status === 'loading' || commandId.trim().length === 0}
        >
          {state.status === 'loading' ? 'Looking…' : 'Find it'}
        </OpsButton>
      </form>

      {state.status === 'error' && <OpsAlert tone="error">{state.message}</OpsAlert>}

      {state.status === 'ready' && (
        <div className="space-y-3">
          <OpsPanel title="Where it got to">
            <div className="grid gap-3 sm:grid-cols-2">
              <OpsReadout label="State now" value={commandStatusLabel(state.command.status)} />
              <OpsReadout
                label="What the driver answered"
                value={
                  state.command.ackOutcome
                    ? ackOutcomeLabel(state.command.ackOutcome)
                    : 'No answer yet'
                }
              />
              <OpsReadout
                label="Reached the driver's screen"
                value={
                  state.command.deliveredAt
                    ? new Date(state.command.deliveredAt).toLocaleString()
                    : 'Not yet'
                }
              />
              <OpsReadout
                label="Driver answered"
                value={
                  state.command.acknowledgedAt
                    ? new Date(state.command.acknowledgedAt).toLocaleString()
                    : 'Not yet'
                }
              />
            </div>
            {state.command.acknowledgementReason && (
              <p className="mt-3 text-sm text-muted-foreground">
                The driver said: {state.command.acknowledgementReason}
              </p>
            )}
          </OpsPanel>

          <OpsTableFrame>
            <table className={opsTableClass}>
              <caption className="sr-only">
                Every step recorded for this instruction, oldest first
              </caption>
              <thead>
                <tr className={opsTheadRowClass}>
                  <th scope="col" className={opsThClass}>
                    What happened
                  </th>
                  <th scope="col" className={opsThClass}>
                    Who or what
                  </th>
                  <th scope="col" className={opsThClass}>
                    Reason
                  </th>
                  <th scope="col" className={opsThClass}>
                    When
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.auditLog.map((entry) => (
                  <tr key={entry.id} className={opsTrClass}>
                    <td className={`${opsTdClass} text-xs`}>
                      {commandAuditEventLabel(entry.eventType)}
                    </td>
                    <td className={`${opsTdMutedClass} text-xs`}>
                      {entry.actorType}
                      {entry.actorId ? (
                        <>
                          {' '}
                          <OpsIdentifier>{entry.actorId}</OpsIdentifier>
                        </>
                      ) : null}
                    </td>
                    <td className={`${opsTdMutedClass} text-xs`}>{entry.reason ?? '—'}</td>
                    <td className={`${opsTdMutedClass} text-xs`}>
                      {new Date(entry.occurredAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </OpsTableFrame>
        </div>
      )}
    </div>
  );
}
