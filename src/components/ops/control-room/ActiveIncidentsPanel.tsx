import type { BunchingIncident } from '@/models/control';
import { IncidentSeverityBadge } from './IncidentSeverityBadge';

/**
 * Active (non-closed) bunching incidents, rendered as a visually distinct
 * panel from the live positions table (AC: "shows ... active incidents
 * distinctly") — left-accent-bordered cards rather than table rows, so an
 * incident reads as an event needing attention, not just another status
 * value in the fleet table.
 */
export function ActiveIncidentsPanel({ incidents }: { incidents: BunchingIncident[] }) {
  if (incidents.length === 0) {
    return (
      <p className="rounded-md border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-4 py-3 text-sm text-[#9aa0ad]">
        No active bunching incidents on this route-direction.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {incidents.map((incident) => (
        <li
          key={incident.id}
          className="rounded-md border border-[rgba(255,255,255,0.08)] border-l-4 border-l-[#f0857d] bg-[rgba(240,133,125,0.06)] px-4 py-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <IncidentSeverityBadge severity={incident.severity} />
              <span className="font-mono text-xs text-[#9aa0ad]">{incident.status}</span>
            </div>
            <span className="text-xs text-[#6f7684]">
              Started {new Date(incident.startedAt).toLocaleTimeString()}
            </span>
          </div>
          <p className="mt-2 text-sm text-[#e6e9ef]">
            {incident.members.length === 0
              ? 'No member vehicles recorded.'
              : incident.members.map((m) => `${m.vehicleId} (${m.role})`).join(', ')}
          </p>
          <p className="mt-1 font-mono text-xs text-[#6f7684]">
            Cause: {incident.causeClass} · Controllability: {incident.controllability}
          </p>
        </li>
      ))}
    </ul>
  );
}
