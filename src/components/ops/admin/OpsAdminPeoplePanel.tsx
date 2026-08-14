'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { OPS_ROLES, OPERATIONAL_ROLES, type OpsRole } from '@/lib/auth/rbac/roles';
import {
  OpsAlert,
  OpsButton,
  OpsField,
  OpsInput,
  OpsPanel,
  OpsSelect,
  OpsStack,
  OpsTableFrame,
  opsTableClass,
  opsTdClass,
  opsTdMutedClass,
  opsTheadRowClass,
  opsThClass,
  opsTrClass,
} from '@/components/ops/ui';

/**
 * The people console: who holds operational access, what role they hold, what
 * they are assigned to, and who has been invited but has not arrived yet.
 *
 * ─── WHAT THIS REPLACED ──────────────────────────────────────────────────
 *
 * A screen called "Invites" that had grown a roster, a vehicle box and a depot
 * picker into it, built out of bare `<table>`s and hand-copied colour classes
 * from before the ops design system existed. Two things were missing outright,
 * and both were the interesting half of what the API already supported:
 *
 *   ROLE ASSIGNMENT   POST /api/ops/admin/users/:id/role has existed since the
 *                     auth collapse and had no control anywhere. An admin who
 *                     needed to move somebody between roles had to disable the
 *                     account and re-invite them — which, as it happens, the
 *                     invite endpoint refuses, because the address already has
 *                     an account.
 *   REVOCATION        An invite sent to the wrong address or with the wrong
 *                     role could not be cancelled, and one-live-invite-per-email
 *                     then refused the corrected one for seven days.
 *
 * ─── THE POSTURE THIS SCREEN HAS TO MAKE LEGIBLE ─────────────────────────
 *
 * Three of its controls are deliberately fail-closed, and every one of them
 * looks like a bug to somebody who does not know why:
 *
 *   • A depot operator with no depot sees NOTHING, rather than the statewide
 *     fleet. Only an admin can set it.
 *   • A driver with no vehicle receives NOTHING. Only an admin can set it —
 *     if drivers could, one could redirect another vehicle's commands.
 *   • A role change writes two stores or neither, and the operator's existing
 *     sign-in stops working until they sign in again.
 *
 * So each is stated where it is used, in the consequence's own words. This
 * component enforces none of it; every action goes through the guarded
 * /api/ops/admin/* routes, which are the actual enforcement point, and it
 * trusts nothing it did not get back from one of their responses.
 */

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

/**
 * Invite status as an ops ink token rather than a literal hex.
 *
 * The old panel applied hard-coded hexes through `style` because the value was
 * data-driven and Tailwind cannot see a class name it never literally
 * contains. A lookup table of literal class strings solves the same problem
 * without a second copy of the palette to keep in step — every one of these is
 * in the source (tailwind.config.ts) and therefore compiled.
 */
const INVITE_STATUS_CLASS: Record<OpsInviteStatus, string> = {
  pending: 'text-holo-glow',
  expired: 'text-ops-warn',
  accepted: 'text-ops-good',
  revoked: 'text-ops-danger',
};

function roleLabel(role: OpsRole): string {
  return role.replace('_', ' ');
}

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   ROW CONTROLS
   ───────────────────────────────────────────────────────────────────────── */

/**
 * Change one operator's role.
 *
 * ─── WHY IT ASKS TWICE ───────────────────────────────────────────────────
 *
 * A role change is not a field edit. It writes `ops_users.role` and the
 * Supabase `app_metadata` claim as one transaction — both, or neither, because
 * a session whose claim disagrees with the database is refused in both
 * directions and a half-applied change is a silent lockout. And it always
 * costs the operator their current sign-in: their existing tokens still carry
 * the old role, so they are refused until they sign in again. That is a
 * consequence for somebody who may be mid-shift, and it belongs in front of
 * the admin BEFORE the click, not in a toast after it.
 *
 * The confirm step is also what makes the same-role case honest. Re-assigning
 * the role somebody already holds is not a no-op — it re-pushes the claim, and
 * it is the documented repair for anything the sign-in role check reports —
 * so the confirmation names that outcome instead of pretending nothing will
 * happen.
 */
function RoleAssignmentCell({
  user,
  onAssigned,
}: {
  user: OpsUserSummary;
  onAssigned: (id: string, role: OpsRole) => void;
}) {
  const [value, setValue] = useState<OpsRole>(user.role);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const selectId = useId();

  const repair = value === user.role;

  async function apply() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const response = await fetch(`/api/ops/admin/users/${user.id}/role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: value }),
      });
      const data = (await response.json().catch(() => null)) as
        | { ok: true; role: OpsRole; claimWritten: boolean; requiresReauth: boolean }
        | { error?: { message?: string } }
        | null;
      if (!response.ok || !data || !('ok' in data)) {
        setError((data && 'error' in data && data.error?.message) || 'The role was not changed.');
        return;
      }
      setConfirming(false);
      onAssigned(user.id, data.role);
      setOutcome(
        data.requiresReauth
          ? 'Role changed. They stay signed out of the console until they sign in again.'
          : data.claimWritten
            ? 'Role re-applied to their sign-in.'
            : 'Role saved. This account has no linked sign-in, so there was no second store to write.',
      );
    } catch {
      setError('Something went wrong. The role was not changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={selectId} className="sr-only">
        Change role for {user.email}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <OpsSelect
          id={selectId}
          value={value}
          disabled={busy || user.status === 'disabled'}
          onChange={(event) => {
            setValue(event.target.value as OpsRole);
            setConfirming(false);
            setOutcome(null);
            setError(null);
          }}
          className="w-36 px-2 py-1 text-xs"
        >
          {OPS_ROLES.map((role) => (
            <option key={role} value={role}>
              {roleLabel(role)}
            </option>
          ))}
        </OpsSelect>
        {user.status === 'active' && !confirming && (
          <OpsButton
            variant="quiet"
            className="px-2 py-1 text-xs"
            onClick={() => {
              setConfirming(true);
              setOutcome(null);
              setError(null);
            }}
          >
            {repair ? 'Re-apply' : 'Change'}
          </OpsButton>
        )}
      </div>

      {confirming && (
        <div className="rounded border border-alert-amber/40 bg-alert-amber/5 p-2 text-[11px] leading-snug text-ops-muted">
          <p className="text-ops-ink">
            {repair
              ? `Re-apply ${roleLabel(user.role)} to ${user.email}?`
              : `Move ${user.email} from ${roleLabel(user.role)} to ${roleLabel(value)}?`}
          </p>
          <p className="mt-1">
            {repair
              ? 'This re-writes the role onto their sign-in. It is the repair for a sign-in whose role disagrees with this system.'
              : 'This writes both this system and their sign-in, or neither. Their current session stops working immediately and they must sign in again to get back in.'}
          </p>
          <div className="mt-2 flex gap-2">
            <OpsButton
              variant="primary"
              className="px-2 py-1 text-xs normal-case tracking-normal"
              disabled={busy}
              onClick={() => void apply()}
            >
              {busy ? 'Applying…' : repair ? 'Re-apply role' : 'Change role'}
            </OpsButton>
            <OpsButton
              variant="quiet"
              className="px-2 py-1 text-xs"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setValue(user.role);
              }}
            >
              Cancel
            </OpsButton>
          </div>
        </div>
      )}

      {outcome && !error && (
        <p role="status" className="text-[11px] leading-snug text-ops-good">
          {outcome}
        </p>
      )}
      {error && (
        <p role="alert" className="text-[11px] leading-snug text-ops-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Inline assign/reassign-vehicle form for a single driver/pilot_driver row.
 * POSTs to /api/ops/admin/users/:id/vehicle, which is the only write path to
 * ops_users.vehicle_id outside invite-time assignment — an empty input clears
 * the assignment, since the endpoint treats '' the same as null.
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
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
      <label htmlFor={`vehicle-${userId}`} className="sr-only">
        Assign vehicle
      </label>
      <OpsInput
        id={`vehicle-${userId}`}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setSaved(false);
        }}
        placeholder="Unassigned"
        aria-describedby={error ? errorId : undefined}
        className="w-32 px-2 py-1 text-xs"
      />
      <OpsButton type="submit" variant="quiet" className="px-2 py-1 text-xs" disabled={busy}>
        {busy ? 'Saving…' : 'Assign'}
      </OpsButton>
      {saved && !error && (
        <span role="status" className="text-xs text-ops-good">
          Saved
        </span>
      )}
      {error && (
        <span id={errorId} role="alert" className="w-full text-xs text-ops-danger">
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
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={`depot-${userId}`} className="sr-only">
        Assign depot
      </label>
      <OpsSelect
        id={`depot-${userId}`}
        value={value}
        disabled={busy}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          setValue(event.target.value);
          void submit(event.target.value);
        }}
        className="w-44 px-2 py-1 text-xs"
      >
        <option value="">Unassigned</option>
        {depots.map((depot) => (
          <option key={depot.id} value={depot.id}>
            {depot.name === depot.code ? depot.name : `${depot.name} (${depot.code})`}
          </option>
        ))}
      </OpsSelect>
      {busy && <span className="text-xs text-ops-muted">Saving…</span>}
      {saved && !busy && !error && (
        <span role="status" className="text-xs text-ops-good">
          Saved
        </span>
      )}
      {error && (
        <span id={errorId} role="alert" className="w-full text-xs text-ops-danger">
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * Disable an operator, with the residual window stated rather than implied.
 *
 * Disabling does three things at once (see the route's own doc comment): it
 * revokes this product on the very next request, clears the role from their
 * sign-in, and bans the sign-in identity so no further token can be minted.
 * What no admin action can do is invalidate a token that has ALREADY been
 * issued — its signature stays valid until it expires. Inside this product
 * that grants nothing, because every guarded request re-reads the account and
 * refuses. Against the Supabase project itself it is a real, bounded residual,
 * and an incident review will ask about it.
 *
 * So the confirmation says so. "Access revoked immediately" would be a
 * simpler sentence and a slightly false one.
 */
function DisableCell({
  user,
  onDisabled,
}: {
  user: OpsUserSummary;
  onDisabled: (id: string, warning: string | null) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disable() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/ops/admin/users/${user.id}/disable`, { method: 'POST' });
      const data = (await response.json().catch(() => null)) as
        | { ok: true; identityRevoked: boolean | null; warning?: string }
        | { error?: { message?: string } }
        | null;
      if (!response.ok || !data || !('ok' in data)) {
        setError((data && 'error' in data && data.error?.message) || 'Could not disable.');
        return;
      }
      setConfirming(false);
      // A failed identity revocation is reported UP, not here. The successful
      // half of this action rewrites the row to "disabled", which unmounts this
      // cell — so a warning rendered in it would appear and vanish in the same
      // tick. It is the one message on this screen an admin genuinely has to
      // act on (the operator's Supabase sign-in is still live), and it belongs
      // somewhere that survives the row it came from.
      onDisabled(user.id, data.warning ?? null);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (user.status === 'disabled') {
    return <span className="text-xs text-ops-faint">disabled</span>;
  }

  return (
    <div className="min-w-0 space-y-1.5">
      {!confirming ? (
        <OpsButton
          variant="quiet"
          className="px-2 py-1 text-xs hover:border-alert-crimson/60 hover:text-alert-crimson"
          onClick={() => setConfirming(true)}
        >
          Disable
        </OpsButton>
      ) : (
        <div className="rounded border border-alert-crimson/40 bg-alert-crimson/5 p-2 text-[11px] leading-snug text-ops-muted">
          <p className="text-ops-ink">Disable {user.email}?</p>
          <p className="mt-1">
            Every request from this account is refused from the next one onwards, on both the
            operations console and the project surface, and their sign-in is banned so no new
            token can be issued.
          </p>
          <p className="mt-1">
            A token they are already holding keeps a valid signature until it expires — up to an
            hour. Inside this product that grants nothing, because access is re-checked on every
            request; against the Supabase project directly it is a real, bounded window.
          </p>
          <div className="mt-2 flex gap-2">
            <OpsButton
              variant="danger"
              className="px-2 py-1 text-xs normal-case tracking-normal"
              disabled={busy}
              onClick={() => void disable()}
            >
              {busy ? 'Disabling…' : 'Disable account'}
            </OpsButton>
            <OpsButton
              variant="quiet"
              className="px-2 py-1 text-xs"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </OpsButton>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-[11px] leading-snug text-ops-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   THE PANEL
   ───────────────────────────────────────────────────────────────────────── */

export function OpsAdminPeoplePanel() {
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
  const [inviteActionId, setInviteActionId] = useState<string | null>(null);
  /**
   * A disable that revoked this product but could NOT revoke the Supabase
   * sign-in. Held at panel level and never auto-dismissed: the row that
   * produced it is rewritten to "disabled" in the same update, so anywhere
   * inside that row is somewhere this message would flash and disappear.
   */
  const [disableWarning, setDisableWarning] = useState<string | null>(null);
  const emailId = useId();
  const roleId = useId();

  const loadUsers = useCallback(async () => {
    const response = await fetch('/api/ops/admin/users', { cache: 'no-store' });
    if (response.ok) {
      const data = (await response.json()) as { users: OpsUserSummary[] };
      setUsers(data.users);
    }
  }, []);

  const loadDepots = useCallback(async () => {
    const response = await fetch('/api/ops/admin/depots', { cache: 'no-store' });
    if (response.ok) {
      const data = (await response.json()) as { depots: OpsDepotSummary[] };
      setDepots(data.depots);
    }
  }, []);

  const loadInvites = useCallback(async () => {
    const response = await fetch('/api/ops/admin/invites', { cache: 'no-store' });
    if (response.ok) {
      const data = (await response.json()) as { invites: OpsInviteSummary[] };
      setInvites(data.invites);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
    void loadInvites();
    void loadDepots();
  }, [loadUsers, loadInvites, loadDepots]);

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
        // Includes the refusal for an address that already has an account,
        // which carries its own remedy in the message rather than a code.
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

  function handleRoleAssigned(id: string, nextRole: OpsRole) {
    setUsers((prev) => (prev ? prev.map((u) => (u.id === id ? { ...u, role: nextRole } : u)) : prev));
  }

  function handleDisabled(id: string, warning: string | null) {
    setUsers((prev) =>
      prev ? prev.map((u) => (u.id === id ? { ...u, status: 'disabled' as const } : u)) : prev,
    );
    if (warning) setDisableWarning(warning);
  }

  async function inviteAction(id: string, action: 'resend' | 'revoke') {
    setInviteActionId(id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/ops/admin/invites/${id}/${action}`, { method: 'POST' });
      const data = (await response.json().catch(() => null)) as {
        delivered?: boolean;
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        setError(data?.error?.message ?? `Could not ${action} invite.`);
        return;
      }
      if (action === 'resend') {
        if (data?.delivered === false) {
          setError(
            data.error?.message ??
              'The invite link was refreshed, but the email could not be sent.',
          );
        } else {
          setNotice('Invite email resent. The previous link no longer works.');
        }
      } else {
        setNotice('Invite cancelled. That link no longer works, and the address is free again.');
      }
      await loadInvites();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setInviteActionId(null);
    }
  }

  return (
    <OpsStack>
      <OpsPanel
        title="Invite a person"
        description="An invite creates a new account. Somebody who already has one is changed here instead — moved to another role, or disabled."
      >
        <form onSubmit={handleInvite} className="space-y-4">
          {/* Capped rather than `flex-1`: on the `wide` shell this row is ~1600px
              across, and an email box stretched over all of it reads as a
              search bar and puts the Send control a screen away from the field
              it submits. */}
          <div className="flex max-w-3xl flex-wrap items-end gap-3">
            <OpsField label="Email" htmlFor={emailId} required className="min-w-[220px] flex-1">
              <OpsInput
                id={emailId}
                type="email"
                required
                placeholder="email@olympuss.us"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full"
              />
            </OpsField>
            <OpsField label="Role" htmlFor={roleId}>
              <OpsSelect
                id={roleId}
                value={role}
                onChange={(event) => setRole(event.target.value as OpsRole)}
              >
                {INVITABLE_ROLES.map((option) => (
                  <option key={option} value={option}>
                    {roleLabel(option)}
                  </option>
                ))}
              </OpsSelect>
            </OpsField>
            <OpsButton
              type="submit"
              variant="primary"
              disabled={busy}
              className="px-4 py-2 text-sm normal-case tracking-normal"
            >
              Send invite
            </OpsButton>
          </div>

          <label className="flex items-center gap-2 text-xs text-ops-muted">
            <input
              type="checkbox"
              checked={revealAcceptUrl}
              onChange={(event) => setRevealAcceptUrl(event.target.checked)}
              className="rounded border-ops-line-strong"
            />
            Also show me the accept link (in addition to emailing it)
          </label>

          <p className="text-[11px] leading-relaxed text-ops-faint">
            The link is single-use, expires in seven days, and only its hash is ever stored — so
            nobody, including this console, can retrieve it later. Resending mints a new link and
            breaks the old one.
          </p>

          {error && <OpsAlert tone="error">{error}</OpsAlert>}
          {notice && !error && <OpsAlert tone="success">{notice}</OpsAlert>}
          {acceptUrl && (
            <p className="break-all text-sm text-ops-muted">
              Accept link (shown because you opted in above — the invitee was also emailed this
              link): <span className="text-holo-glow">{acceptUrl}</span>
            </p>
          )}
        </form>
      </OpsPanel>

      <OpsPanel
        title="Outstanding invites"
        description="Issued, not yet accepted. Cancelling one stops the link working and frees the address for a corrected invite."
        padded={false}
      >
        {!invites ? (
          <p className="p-4 text-sm text-ops-muted">Loading…</p>
        ) : invites.length === 0 ? (
          <p className="p-4 text-sm text-ops-muted">
            No outstanding invites. Everybody who has been invited has either accepted or been
            cancelled.
          </p>
        ) : (
          <OpsTableFrame className="rounded-none border-0">
            <table className={opsTableClass}>
              <thead>
                <tr className={opsTheadRowClass}>
                  <th className={opsThClass}>Email</th>
                  <th className={opsThClass}>Role</th>
                  <th className={opsThClass}>Status</th>
                  <th className={opsThClass}>Link expires</th>
                  <th className={opsThClass} />
                </tr>
              </thead>
              <tbody>
                {invites.map((invite) => (
                  <tr key={invite.id} className={opsTrClass}>
                    <td className={opsTdClass}>{invite.email}</td>
                    <td className={opsTdMutedClass}>{roleLabel(invite.role)}</td>
                    <td className={opsTdClass}>
                      <span className={INVITE_STATUS_CLASS[invite.status]}>
                        {INVITE_STATUS_LABEL[invite.status]}
                      </span>
                    </td>
                    <td className={opsTdMutedClass}>{formatWhen(invite.expiresAt)}</td>
                    <td className={opsTdClass}>
                      {(invite.status === 'pending' || invite.status === 'expired') && (
                        <div className="flex flex-wrap justify-end gap-2">
                          <OpsButton
                            variant="quiet"
                            className="px-2 py-1 text-xs"
                            disabled={inviteActionId === invite.id}
                            onClick={() => void inviteAction(invite.id, 'resend')}
                          >
                            {inviteActionId === invite.id ? 'Working…' : 'Resend'}
                          </OpsButton>
                          <OpsButton
                            variant="quiet"
                            className="px-2 py-1 text-xs hover:border-alert-crimson/60 hover:text-alert-crimson"
                            disabled={inviteActionId === invite.id}
                            onClick={() => void inviteAction(invite.id, 'revoke')}
                          >
                            Cancel
                          </OpsButton>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </OpsTableFrame>
        )}
      </OpsPanel>

      {disableWarning && (
        <OpsAlert tone="warning" title="That account is revoked here, but its sign-in is not">
          <p>{disableWarning}</p>
          <OpsButton
            variant="quiet"
            className="mt-2 px-2 py-1 text-xs"
            onClick={() => setDisableWarning(null)}
          >
            Dismiss
          </OpsButton>
        </OpsAlert>
      )}

      <OpsPanel
        title="People"
        description="Role, assignments and access. A depot operator with no depot is refused fleet data outright rather than shown the whole state; a driver with no vehicle receives no instructions. Both are admin-set only, on purpose."
        padded={false}
      >
        {!users ? (
          <p className="p-4 text-sm text-ops-muted">Loading…</p>
        ) : users.length === 0 ? (
          <p className="p-4 text-sm text-ops-muted">
            No accounts yet. The first admin is seeded out of band; everybody else arrives by
            invite.
          </p>
        ) : (
          <OpsTableFrame className="rounded-none border-0">
            <table className={opsTableClass}>
              <thead>
                <tr className={opsTheadRowClass}>
                  <th className={opsThClass}>Name</th>
                  <th className={opsThClass}>Email</th>
                  <th className={opsThClass}>Role</th>
                  <th className={opsThClass}>Status</th>
                  <th className={opsThClass}>Vehicle</th>
                  <th className={opsThClass}>Depot</th>
                  <th className={opsThClass} />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className={opsTrClass}>
                    <td className={opsTdClass}>{user.name}</td>
                    <td className={opsTdMutedClass}>{user.email}</td>
                    <td className={opsTdClass}>
                      <RoleAssignmentCell user={user} onAssigned={handleRoleAssigned} />
                    </td>
                    <td className={opsTdMutedClass}>{user.status}</td>
                    <td className={opsTdClass}>
                      {VEHICLE_ASSIGNABLE_ROLES.includes(user.role) ? (
                        <VehicleAssignmentCell
                          userId={user.id}
                          vehicleId={user.vehicleId}
                          onAssigned={handleVehicleAssigned}
                        />
                      ) : (
                        <span className="text-ops-faint">—</span>
                      )}
                    </td>
                    <td className={opsTdClass}>
                      {DEPOT_ASSIGNABLE_ROLES.includes(user.role) ? (
                        <DepotAssignmentCell
                          userId={user.id}
                          depotId={user.depotId}
                          depots={depots}
                          onAssigned={handleDepotAssigned}
                        />
                      ) : (
                        <span className="text-ops-faint">—</span>
                      )}
                    </td>
                    <td className={opsTdClass}>
                      <DisableCell user={user} onDisabled={handleDisabled} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </OpsTableFrame>
        )}
      </OpsPanel>
    </OpsStack>
  );
}
