'use client';

import { useId, useState } from 'react';
import type { ShiftReportDraft } from '@/models/copilot';

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const now = new Date();
const eightHoursAgo = new Date(now.getTime() - 8 * 60 * 60 * 1000);

/**
 * Shift-report copilot: draft -> review -> explicit Save/Send (ticket AC
 * "Shift-report drafts labelled AI-drafted, require human send/save, never
 * auto-publish"). The draft returned by POST .../shift-reports is always
 * status='draft' and rendered with a visible "AI-drafted" label; Save/Send
 * are two separate buttons that each call POST .../finalize with a
 * different `action` — nothing in this component can submit a draft
 * without that explicit second click, and the draft is not modified
 * client-side before either action fires (it is sent as generated).
 */
export function ShiftReportCopilotForm({ routeDirectionId }: { routeDirectionId: string | null }) {
  const [shiftLabel, setShiftLabel] = useState('');
  const [periodStart, setPeriodStart] = useState(toLocalInputValue(eightHoursAgo));
  const [periodEnd, setPeriodEnd] = useState(toLocalInputValue(now));
  const [status, setStatus] = useState<'idle' | 'drafting' | 'error' | 'ready'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ShiftReportDraft | null>(null);
  const [finalizing, setFinalizing] = useState<'save' | 'send' | null>(null);

  const errorId = useId();

  async function handleDraft(event: React.FormEvent) {
    event.preventDefault();
    setStatus('drafting');
    setError(null);
    setDraft(null);

    try {
      const response = await fetch('/api/ops/control-room/copilot/shift-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shiftLabel,
          periodStart: new Date(periodStart).toISOString(),
          periodEnd: new Date(periodEnd).toISOString(),
          ...(routeDirectionId ? { routeDirectionId } : {}),
        }),
      });
      const data = (await response.json().catch(() => null)) as
        ShiftReportDraft | { error: { message: string } } | null;

      if (!response.ok || !data || 'error' in data) {
        setError(
          (data && 'error' in data && data.error.message) || 'Could not draft a shift report.',
        );
        setStatus('error');
        return;
      }

      setDraft(data);
      setStatus('ready');
    } catch {
      setError('Something went wrong. Please try again.');
      setStatus('error');
    }
  }

  async function handleFinalize(action: 'save' | 'send') {
    if (!draft) return;
    setFinalizing(action);
    setError(null);

    try {
      const response = await fetch(
        `/api/ops/control-room/copilot/shift-reports/${draft.id}/finalize`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        },
      );
      const data = (await response.json().catch(() => null)) as
        ShiftReportDraft | { error: { message: string } } | null;

      if (!response.ok || !data || 'error' in data) {
        setError(
          (data && 'error' in data && data.error.message) || `Could not ${action} the report.`,
        );
        setFinalizing(null);
        return;
      }

      setDraft(data);
      setFinalizing(null);
    } catch {
      setError('Something went wrong. Please try again.');
      setFinalizing(null);
    }
  }

  return (
    <div className="space-y-4 rounded-md border border-border p-4">
      <h2 className="ops-label">Shift-report copilot</h2>

      <form onSubmit={handleDraft} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="shiftLabel" className="mb-1 block text-xs text-muted-foreground">
              Shift label
            </label>
            <input
              id="shiftLabel"
              required
              value={shiftLabel}
              onChange={(e) => setShiftLabel(e.target.value)}
              placeholder="e.g. Night shift 06 Aug"
              className="ops-input"
            />
          </div>
          <div>
            <label htmlFor="periodStart" className="mb-1 block text-xs text-muted-foreground">
              Period start
            </label>
            <input
              id="periodStart"
              type="datetime-local"
              required
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="ops-input"
            />
          </div>
          <div>
            <label htmlFor="periodEnd" className="mb-1 block text-xs text-muted-foreground">
              Period end
            </label>
            <input
              id="periodEnd"
              type="datetime-local"
              required
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="ops-input"
            />
          </div>
        </div>

        {error && (
          <p id={errorId} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={status === 'drafting' || shiftLabel.trim().length === 0}
          className="ops-button-primary px-5 py-2"
        >
          {status === 'drafting' ? 'Drafting…' : 'Generate draft'}
        </button>
      </form>

      {draft && (
        <div className="rounded-md border border-warning/40 bg-warning/5 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="rounded border border-warning/50 bg-warning/15 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-warning">
              AI-drafted — review before sending
            </span>
            <span className="ops-eyebrow">status: {draft.status}</span>
          </div>

          <p className="whitespace-pre-wrap text-sm text-foreground">{draft.content}</p>

          {draft.citations.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {draft.citations.map((citation) => (
                <span
                  key={`${citation.recordType}-${citation.recordId}`}
                  title={citation.summary}
                  className="rounded border border-input px-1.5 py-0.5 font-mono text-[9px] text-subtle"
                >
                  {citation.recordType}:{citation.recordId.slice(0, 8)}
                </span>
              ))}
            </div>
          )}

          {draft.status === 'draft' ? (
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => handleFinalize('save')}
                disabled={finalizing !== null}
                data-testid="copilot-shift-report-save"
                className="ops-button px-4 py-2"
              >
                {finalizing === 'save' ? 'Saving…' : 'Save to shift log'}
              </button>
              <button
                type="button"
                onClick={() => handleFinalize('send')}
                disabled={finalizing !== null}
                data-testid="copilot-shift-report-send"
                className="ops-button-primary px-4 py-2"
              >
                {finalizing === 'send' ? 'Sending…' : 'Send to incoming shift'}
              </button>
            </div>
          ) : (
            <p role="status" className="mt-4 text-sm text-success">
              {draft.status === 'saved' ? 'Saved to the shift log.' : 'Sent to the incoming shift.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
