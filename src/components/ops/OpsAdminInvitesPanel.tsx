'use client';

import { useEffect, useId, useState } from 'react';
import { OPERATIONAL_ROLES, type OpsRole } from '@/lib/auth/rbac/roles';

interface OpsUserSummary {
  id: string;
  email: string;
  name: string;
  role: OpsRole;
  status: 'active' | 'disabled';
  vehicleId: string | null;
  depotId: string | null;
  createdAt: string;
}

interface OpsDepotSummary {
  id: string;
  code: string;
  name: string;
}

/** Roles a vehicle assignment is meaningful for (db/migrations/20260806180000__ops_users_vehicle_assignment.sql). */
const VEHICLE_ASSIGNABLE_ROLES: OpsRole[] = ['driver', 'pilot_driver'];

/** Roles a depot assignment is meaningful for (db/migrations/20260812150000__ops_depot_ownership.sql). */
const DEPOT_ASSIGNABLE_ROLES: OpsRole[] = ['depot'];

type OpsInviteStatus = 'pending' | 'expired' | 'accepted' | 'revoked';

interface OpsInviteSummary {
  id: string;
  email: string;
  role: OpsRole;
  status: OpsInviteStatus;
  expiresAt: string;
  createdAt: string;
}

const INVITABLE_ROLES: OpsRole[] = [...OPERATIONAL_ROLES, 'admin'];

const INVITE_STATUS_LABEL: Record<OpsInviteStatus, string> = {
  pending: 'Pending',
  expired: 'Expired',
  accepted: 'Accepted',
  revoked: 'Revoked',
};

// Literal hexes, applied through `style` — see STAGE_COLOR in
// OpsAdminRolloutStagesPanel.tsx for why, and keep both in step with the
// `ops`/`holo` tokens in tailwind.config.ts.
const INVITE_STATUS_COLOR: Record<OpsInviteStatus, string> = {
  pending: '#3ff0ff',
  expired: '#f5c977',
  accepted: '#8ee7b4',
  revoked: '#ff9aa4',
};

function formatExpiry(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}

/**
 * Inline assign/reassign-vehicle form for a single driver/pilot_driver row,
 * mirroring DispatcherActionForm's self-contained submit/error/success
 * pattern. POSTs to /api/ops/admin/users/:id/vehicle, which is the only
 * write path to ops_users.vehicle_id outside invite-time assignment — an
 * empty input clears the assignment, since the endpoint treats '' the same
 * as null.
 */
function VehicleAssignmentCell({
  userId,
  vehicleId,
  onAssigned,
}: {
  userId: string;
  vehicleId: string | null;
  onAssigned: (id: string, vehicleId: string | null) => void;
}) {
  const [value, setValue] = useState(vehicleId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const errorId = useId();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const trimmed = value.trim();
      const response = await fetch(`/api/ops/admin/users/${userId}/vehicle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleId: trimmed === '' ? null : trimmed }),
      });
      const data = (await response.json().catch(() => null)) as
        | { ok: true; vehicleId: string | null }
        | { error?: { message?: string } }
        | null;
      if (!response.ok || !data || !('ok' in data)) {
        setError((data && 'error' in data && data.error?.message) || 'Could not assign vehicle.');
        return;
      }
      setValue(data.vehicleId ?? '');
      setSaved(true);
      onAssigned(userId, data.vehicleId ?? null);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center justify-end gap-2">
      <label htmlFor={`vehicle-${userId}`} className="sr-only">
        Assign vehicle
      </label>
      <input
        id={`vehicle-${userId}`}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        placeholder="Unassigned"
        aria-describedby={error ? errorId : undefined}
        className="ops-input w-32 px-2 py-1 text-xs"
      />
      <button
        type="submit"
        disabled={busy}
        className="rounded border border-ops-line-strong px-2 py-1 text-xs text-ops-muted hover:border-holo-glow/60 hover:text-holo-glow disabled:opacity-60"
      >
        {busy ? 'Saving…' : 'Assign'}
      </button>
      {saved && !error && (
        <span role="status" className="text-xs text-ops-good">
          Saved
        </span>
      )}
      {error && (
        <span id={errorId} role="alert" className="w-full text-right text-xs text-alert-crimson">
          {error}
        </span>
      )}
    </form>
  );
}

/**
 * Depot assignment for one `depot`-role operator, the sibling of
 * VehicleAssignmentCell. POSTs to /api/ops/admin/users/:id/depot, the only
 * write path to ops_users.depot_id outside invite-time assignment.
 *
 * A SELECT over the registry rather than a free-text box, unlike the vehicle
 * cell. The depot is an authorization boundary and the endpoint takes a uuid:
 * a typed name that matched nothing would look like a successful assignment
 * while silently leaving the operator with an empty roster. Choosing from the
 * registry makes an unassignable depot impossible to express. The option
 * labels carry the canonical code alongside the name because that is what the
 * boundary matches on, which matters when two depots read alike (SAHARANPUR
 * versus SAHARANPUR(A)).
 */
function DepotAssignmentCell({
  userId,
  depotId,
  depots,
  onAssigned,
}: {
  userId: string;
  depotId: string | null;
  depots: OpsDepotSummary[] | null;
  onAssigned: (id: string, depotId: string | null) => void;
}) {
  const [value, setValue] = useState(depotId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const errorId = useId();

  async function submit(nextValue: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(`/api/ops/admin/users/${userId}/depot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depotId: nextValue === '' ? null : nextValue }),
      });
      const data = (await response.json().catch(() => null)) as
        | { ok: true; depotId: string | null }
        | { error?: { message?: string } }
        | null;
      if (!response.ok || !data || !('ok' in data)) {
        setError((data && 'error' in data && data.error?.message) || 'Could not assign depot.');
        return;
      }
      setValue(data.depotId ?? '');
      setSaved(true);
      onAssigned(userId, data.depotId ?? null);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (depots === null) {
    return <span className="text-ops-faint">…</span>;
  }

  if (depots.length === 0) {
    // An empty registry is a real, actionable state, not a blank dropdown:
    // nobody can be assigned until the registry is seeded from the feed.
    return (
      <span className="text-xs text-ops-warn">
        No depots in registry — run <code>pnpm seed-ops-depots</code>
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <label htmlFor={`depot-${userId}`} className="sr-only">
        Assign depot
      </label>
      <select
        id={`depot-${userId}`}
        value={value}
        disabled={busy}
        aria-describedby={error ? errorId : undefined}
        onChange={(e) => {
          setValue(e.target.value);
          void submit(e.target.value);
        }}
        className="ops-input w-44 px-2 py-1 text-xs"
      >
        <option value="">Unassigned</option>
        {depots.map((depot) => (
          <option key={depot.id} value={depot.id}>
            {depot.name === depot.code ? depot.name : `${depot.name} (${depot.code})`}
          </option>
        ))}
      </select>
      {busy && <span className="text-xs text-ops-muted">Saving…</span>}
      {saved && !busy && !error && (
        <span role="status" className="text-xs text-ops-good">
          Saved
        </span>
      )}
      {error && (
        <span id={errorId} role="alert" className="w-full text-right text-xs text-alert-crimson">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * Admin invite/user-management panel. Client-side only; every action goes
 * through the guarded /api/ops/admin/* routes, which are the actual
 * enforcement point — this component trusts nothing it doesn't get back from
 * those responses.
 */
export function OpsAdminInvitesPanel() {
  const [users, setUsers] = useState<OpsUserSummary[] | null>(null);
  const [depots, setDepots] = useState<OpsDepotSummary[] | null>(null);
  const [invites, setInvites] = useState<OpsInviteSummary[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OpsRole>('driver');
  const [revealAcceptUrl, setRevealAcceptUrl] = useState(false);
  const [acceptUrl, setAcceptUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);

  async function loadUsers() {
    const response = await fetch('/api/ops/admin/users', { cache: 'no-store' });
    if (response.ok) {
      const data = (await response.json()) as { users: OpsUserSummary[] };
      setUsers(data.users);
    }
  }

  async function loadDepots() {
    const response = await fetch('/api/ops/admin/depots', { cache: 'no-store' });
    if (response.ok) {
      const data = (await response.json()) as { depots: OpsDepotSummary[] };
      setDepots(data.depots);
    }
  }

  async function loadInvites() {
    const response = await fetch('/api/ops/admin/invites', { cache: 'no-store' });
    if (response.ok) {
      const data = (await response.json()) as { invites: OpsInviteSummary[] };
      setInvites(data.invites);
    }
  }

  useEffect(() => {
    void loadUsers();
    void loadInvites();
    void loadDepots();
  }, []);

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    setAcceptUrl(null);
    try {
      const response = await fetch('/api/ops/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role, revealAcceptUrl }),
      });
      const data = (await response.json().catch(() => null)) as {
        delivered?: boolean;
        acceptUrl?: string;
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        setError(data?.error?.message ?? 'Could not create invite.');
        return;
      }
      if (data?.delivered === false) {
        setError(data.error?.message ?? 'Invite created, but the email could not be sent.');
      } else {
        setNotice('Invite sent — the invitee will receive an email with their accept link.');
      }
      setAcceptUrl(data?.acceptUrl ?? null);
      setEmail('');
      await Promise.all([loadUsers(), loadInvites()]);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function handleVehicleAssigned(id: string, vehicleId: string | null) {
    setUsers((prev) => (prev ? prev.map((u) => (u.id === id ? { ...u, vehicleId } : u)) : prev));
  }

  function handleDepotAssigned(id: string, depotId: string | null) {
    setUsers((prev) => (prev ? prev.map((u) => (u.id === id ? { ...u, depotId } : u)) : prev));
  }

  async function handleDisable(id: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/ops/admin/users/${id}/disable`, { method: 'POST' });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(data?.error?.message ?? 'Could not disable user.');
        return;
      }
      await loadUsers();
    } finally {
      setBusy(false);
    }
  }

  async function handleResend(id: string) {
    setResendingId(id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/ops/admin/invites/${id}/resend`, { method: 'POST' });
      const data = (await response.json().catch(() => null)) as {
        delivered?: boolean;
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        setError(data?.error?.message ?? 'Could not resend invite.');
        return;
      }
      if (data?.delivered === false) {
        setError(
          data.error?.message ?? 'The invite link was refreshed, but the email could not be sent.',
        );
      } else {
        setNotice('Invite email resent.');
      }
      await loadInvites();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setResendingId(null);
    }
  }

  return (
    <div className="space-y-10">
      <form
        onSubmit={handleInvite}
        className="space-y-4 rounded-lg border border-ops-line p-5"
      >
        <h2 className="ops-label">
          Invite a person
        </h2>
        <div className="flex flex-wrap gap-3">
          <input
            type="email"
            required
            placeholder="email@olympuss.us"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="ops-input min-w-[220px] flex-1"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as OpsRole)}
            className="ops-input"
          >
            {INVITABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {r.replace('_', ' ')}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy}
            className="ops-button-primary px-4 py-2 text-sm normal-case tracking-normal"
          >
            Send invite
          </button>
        </div>
        <label className="flex items-center gap-2 text-xs text-ops-muted">
          <input
            type="checkbox"
            checked={revealAcceptUrl}
            onChange={(e) => setRevealAcceptUrl(e.target.checked)}
            className="rounded border-ops-line-strong"
          />
          Also show me the accept link (in addition to emailing it)
        </label>
        {error && (
          <p role="alert" className="text-sm text-alert-crimson">
            {error}
          </p>
        )}
        {notice && !error && <p className="text-sm text-ops-good">{notice}</p>}
        {acceptUrl && (
          <p className="break-all text-sm text-ops-muted">
            Accept link (shown because you opted in above — the invitee was also emailed this link):{' '}
            <span className="text-holo-glow">{acceptUrl}</span>
          </p>
        )}
      </form>

      <div className="space-y-3">
        <h2 className="ops-label">
          Outstanding invites
        </h2>
        {!invites ? (
          <p className="text-sm text-ops-muted">Loading…</p>
        ) : invites.length === 0 ? (
          <p className="text-sm text-ops-muted">No outstanding invites.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-ops-faint">
              <tr>
                <th className="pb-2">Email</th>
                <th className="pb-2">Role</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Expires</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr key={invite.id} className="border-t border-ops-line/70">
                  <td className="py-2">{invite.email}</td>
                  <td className="py-2">{invite.role.replace('_', ' ')}</td>
                  <td className="py-2">
                    <span style={{ color: INVITE_STATUS_COLOR[invite.status] }}>
                      {INVITE_STATUS_LABEL[invite.status]}
                    </span>
                  </td>
                  <td className="py-2 text-ops-muted">{formatExpiry(invite.expiresAt)}</td>
                  <td className="py-2 text-right">
                    {(invite.status === 'pending' || invite.status === 'expired') && (
                      <button
                        type="button"
                        disabled={resendingId === invite.id}
                        onClick={() => handleResend(invite.id)}
                        className="rounded border border-ops-line-strong px-2 py-1 text-xs text-ops-muted hover:border-holo-glow/60 hover:text-holo-glow disabled:opacity-60"
                      >
                        {resendingId === invite.id ? 'Resending…' : 'Resend'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="ops-label">People</h2>
        {!users ? (
          <p className="text-sm text-ops-muted">Loading…</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-ops-muted">No accounts yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-ops-faint">
              <tr>
                <th className="pb-2">Name</th>
                <th className="pb-2">Email</th>
                <th className="pb-2">Role</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Vehicle</th>
                <th className="pb-2">Depot</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-ops-line/70">
                  <td className="py-2">{u.name}</td>
                  <td className="py-2">{u.email}</td>
                  <td className="py-2">{u.role.replace('_', ' ')}</td>
                  <td className="py-2">{u.status}</td>
                  <td className="py-2 text-right">
                    {VEHICLE_ASSIGNABLE_ROLES.includes(u.role) ? (
                      <VehicleAssignmentCell
                        userId={u.id}
                        vehicleId={u.vehicleId}
                        onAssigned={handleVehicleAssigned}
                      />
                    ) : (
                      <span className="text-ops-faint">—</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {DEPOT_ASSIGNABLE_ROLES.includes(u.role) ? (
                      <DepotAssignmentCell
                        userId={u.id}
                        depotId={u.depotId}
                        depots={depots}
                        onAssigned={handleDepotAssigned}
                      />
                    ) : (
                      <span className="text-ops-faint">—</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {u.status === 'active' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleDisable(u.id)}
                        className="rounded border border-ops-line-strong px-2 py-1 text-xs text-ops-muted hover:border-alert-crimson/60 hover:text-alert-crimson"
                      >
                        Disable
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
