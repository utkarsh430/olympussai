'use client';

import { useId, useState } from 'react';
import type { WarRoomClassification, WarRoomIncident } from '@/models/control';

const CLASSIFICATIONS: WarRoomClassification[] = ['eligible', 'exogenous', 'structural'];

/**
 * War-room review form for one bunching incident (ticket AC3: classify as
 * eligible/exogenous/structural, record action taken and outcome). POSTs
 * to /api/ops/control-room/pilot/war-room/:incidentId, which is the only
 * write path to war_room_incident_reviews — this component trusts nothing
 * it doesn't get back from that response, same self-contained
 * submit/error/success pattern as OpsAdminInvitesPanel's
 * VehicleAssignmentCell.
 */
export function IncidentReviewForm({ incident, viewerEmail }: { incident: WarRoomIncident; viewerEmail: string }) {
  const [classification, setClassification] = useState<WarRoomClassification>(incident.classification ?? 'eligible');
  const [actionTaken, setActionTaken] = useState(incident.actionTaken ?? '');
  const [outcome, setOutcome] = useState(incident.reviewOutcome ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [reviewedBy, setReviewedBy] = useState(incident.reviewedBy);
  const [reviewedAt, setReviewedAt] = useState(incident.reviewedAt);
  const errorId = useId();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(`/api/ops/control-room/pilot/war-room/${incident.incidentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classification,
          actionTaken: actionTaken.trim() === '' ? null : actionTaken,
          outcome: outcome.trim() === '' ? null : outcome,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { incident: WarRoomIncident }
        | { error?: { message?: string } }
        | null;
      if (!response.ok || !data || !('incident' in data)) {
        setError((data && 'error' in data && data.error?.message) || 'Could not save the review.');
        return;
      }
      setReviewedBy(data.incident.reviewedBy);
      setReviewedAt(data.incident.reviewedAt);
      setSaved(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-2 sm:grid-cols-[auto,1fr,1fr,auto] sm:items-start">
      <label className="flex flex-col gap-1 text-xs text-ops-muted">
        Classification
        <select
          value={classification}
          onChange={(e) => {
            setClassification(e.target.value as WarRoomClassification);
            setSaved(false);
          }}
          className="ops-input w-auto px-2 py-1 text-xs"
        >
          {CLASSIFICATIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-ops-muted">
        Action taken
        <input
          value={actionTaken}
          onChange={(e) => {
            setActionTaken(e.target.value);
            setSaved(false);
          }}
          placeholder="e.g. two-way hold on trailing bus"
          className="ops-input w-auto px-2 py-1 text-xs"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ops-muted">
        Outcome
        <input
          value={outcome}
          onChange={(e) => {
            setOutcome(e.target.value);
            setSaved(false);
          }}
          placeholder="e.g. gap closed within 6 min"
          aria-describedby={error ? errorId : undefined}
          className="ops-input w-auto px-2 py-1 text-xs"
        />
      </label>
      <div className="flex flex-col items-start gap-1 sm:items-end">
        <button
          type="submit"
          disabled={busy}
          className="rounded border border-ops-line-strong px-2 py-1 text-xs text-ops-muted hover:border-holo-glow/60 hover:text-holo-glow disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save review'}
        </button>
        {saved && !error && (
          <span role="status" className="text-xs text-ops-good">
            Saved
          </span>
        )}
      </div>
      {error && (
        <span id={errorId} role="alert" className="sm:col-span-4 text-xs text-alert-crimson">
          {error}
        </span>
      )}
      {reviewedBy && (
        <p className="sm:col-span-4 text-[11px] text-ops-faint">
          Last reviewed by {reviewedBy}
          {reviewedAt ? ` at ${new Date(reviewedAt).toLocaleString()}` : ''}
          {reviewedBy === viewerEmail ? ' (you)' : ''}.
        </p>
      )}
    </form>
  );
}
