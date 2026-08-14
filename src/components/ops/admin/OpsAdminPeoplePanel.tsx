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
  pending: 'Waiting to be used',
  expired: 'Ran out of time',
  accepted: 'Used',
  revoked: 'Cancelled',
};

/**
 * Invite status as a semantic token rather than a literal hex.
 *
 * The old panel applied hard-coded hexes through `style` because the value was
 * data-driven and Tailwind cannot see a class name it never literally
 * contains. A lookup table of literal class strings solves the same problem
 * without a second copy of the palette to keep in step — and on semantic
 * tokens each one is legible in both themes rather than only the dark one.
 */
const INVITE_STATUS_CLASS: Record<OpsInviteStatus, string> = {
  pending: 'text-primary',
  expired: 'text-warning',
  accepted: 'text-success',
  revoked: 'text-muted-foreground',
};

/**
 * A role, as it is spoken.
 *
 * `pilot_driver` was reaching the screen as "pilot driver" and `control_room`
 * as "control room", which is the wire value with its underscore taken out.
 * Two of the seven needed more than that to be a phrase anybody would say.
 */
const ROLE_LABEL: Record<OpsRole, string> = {
  control_room: 'Control room',
  dispatcher: 'Dispatcher',
  depot: 'Depot',
  planner: 'Planner',
  driver: 'Driver',
  pilot_driver: 'Driver (trial)',
  admin: 'Administrator',
};

function roleLabel(role: OpsRole): string {
  return ROLE_LABEL[role] ?? role.replace(/_/g, ' ');
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
          ? 'Role changed. They cannot get back in until they sign in again.'
          : data.claimWritten
            ? 'Role written to their sign-in again.'
            : 'Role saved. This account has no sign-in linked to it, so there was nothing else to write.',
      );
    } catch {
      setError('Something went wrong. The role was not changed. Try again.');
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
            {repair ? 'Set again' : 'Change'}
          </OpsButton>
        )}
      </div>

      {confirming && (
        <div className="rounded border border-instrument-warning/50 bg-instrument-warning/10 p-2 text-[11px] leading-snug text-muted-foreground">
          <p className="font-medium text-foreground">
            {repair
              ? `Set ${user.email} to ${roleLabel(user.role)} again?`
              : `Move ${user.email} from ${roleLabel(user.role)} to ${roleLabel(value)}?`}
          </p>
          <p className="mt-1">
            {repair
              ? 'This writes the role onto their sign-in again. It is the fix for somebody whose sign-in disagrees with this system about their role.'
              : 'This writes both this system and their sign-in, or neither — never one without the other. They are signed out straight away and must sign in again to get back in, even if they are part way through a shift.'}
          </p>
          <div className="mt-2 flex gap-2">
            <OpsButton
              variant="primary"
              className="px-2 py-1 text-xs normal-case tracking-normal"
              disabled={busy}
              onClick={() => void apply()}
            >
              {busy ? 'Applying…' : repair ? 'Set role again' : 'Change role'}
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
        <p role="status" className="text-[11px] leading-snug text-success">
          {outcome}
        </p>
      )}
      {error && (
        <p role="alert" className="text-[11px] leading-snug text-destructive">
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
        { ok: true; vehicleId: string | null } | { error?: { message?: string } } | null;
      if (!response.ok || !data || !('ok' in data)) {
        setError(
          (data && 'error' in data && data.error?.message) || 'The bus was not set. Try again.',
        );
        return;
      }
      setValue(data.vehicleId ?? '');
      setSaved(true);
      onAssigned(userId, data.vehicleId ?? null);
    } catch {
      setError('Something went wrong. The bus was not set. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
      <label htmlFor={`vehicle-${userId}`} className="sr-only">
        Bus for this driver, by number plate. Leave empty for none.
      </label>
      <OpsInput
        id={`vehicle-${userId}`}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setSaved(false);
        }}
        placeholder="No bus set"
        aria-describedby={error ? errorId : undefined}
        className="w-32 px-2 py-1 font-mono text-xs"
      />
      <OpsButton type="submit" variant="quiet" className="px-2 py-1 text-xs" disabled={busy}>
        {busy ? 'Saving…' : 'Set'}
      </OpsButton>
      {saved && !error && (
        <span role="status" className="text-xs text-success">
          Saved
        </span>
      )}
      {error && (
        <span id={errorId} role="alert" className="w-full text-xs text-destructive">
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
        { ok: true; depotId: string | null } | { error?: { message?: string } } | null;
      if (!response.ok || !data || !('ok' in data)) {
        setError(
          (data && 'error' in data && data.error?.message) || 'The depot was not set. Try again.',
        );
        return;
      }
      setValue(data.depotId ?? '');
      setSaved(true);
      onAssigned(userId, data.depotId ?? null);
    } catch {
      setError('Something went wrong. The depot was not set. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (depots === null) {
    return <span className="text-subtle">…</span>;
  }

  if (depots.length === 0) {
    // An empty depot list is a real, actionable state, not a blank dropdown:
    // nobody can be given a depot until the list is loaded from the feed.
    //
    // It used to say "run `pnpm seed-ops-depots`". A shell command has no place
    // on an administrator's screen — the person reading this has no terminal
    // and no repository — so it names who can do it instead.
    return (
      <span className="text-xs text-warning">
        No depots loaded yet. Ask whoever runs this system to load the depot list.
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={`depot-${userId}`} className="sr-only">
        Depot for this person. Choosing one saves immediately.
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
        <option value="">No depot set</option>
        {depots.map((depot) => (
          <option key={depot.id} value={depot.id}>
            {depot.name === depot.code ? depot.name : `${depot.name} (${depot.code})`}
          </option>
        ))}
      </OpsSelect>
      {busy && <span className="text-xs text-muted-foreground">Saving…</span>}
      {saved && !busy && !error && (
        <span role="status" className="text-xs text-success">
          Saved
        </span>
      )}
      {error && (
        <span id={errorId} role="alert" className="w-full text-xs text-destructive">
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
        setError(
          (data && 'error' in data && data.error?.message) ||
            'The account was not disabled. Try again.',
        );
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
      setError('Something went wrong. The account was not disabled. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (user.status === 'disabled') {
    return <span className="text-xs text-subtle">Disabled</span>;
  }

  return (
    <div className="min-w-0 space-y-1.5">
      {!confirming ? (
        <OpsButton
          variant="quiet"
          className="px-2 py-1 text-xs hover:border-instrument-danger/60 hover:text-destructive"
          onClick={() => setConfirming(true)}
        >
          Disable
        </OpsButton>
      ) : (
        <div className="rounded border border-instrument-danger/50 bg-instrument-danger/10 p-2 text-[11px] leading-snug text-muted-foreground">
          <p className="font-medium text-foreground">Disable {user.email}?</p>
          <p className="mt-1">
            From their very next request onwards, everything this account asks for is refused — on
            this console and on the public site — and their sign-in is blocked so no new pass can be
            issued to them.
          </p>
          {/* This paragraph is the reason this dialog exists rather than a
              plain confirm. "Access revoked immediately" is a simpler sentence
              and a slightly false one: no admin action can invalidate a pass
              ALREADY in somebody's hands, and an incident review will ask
              about exactly that window. Stated before the click, in the
              consequence's own terms, rather than discovered afterwards. */}
          <p className="mt-1">
            A pass they are already holding stays technically valid until it runs out — up to an
            hour. Inside this product that gets them nothing, because every request checks the
            account again and refuses. Against the sign-in provider directly it is a real window,
            and it closes on its own.
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
        <p role="alert" className="text-[11px] leading-snug text-destructive">
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
        setError(data?.error?.message ?? 'The invite was not created. Try again.');
        return;
      }
      if (data?.delivered === false) {
        setError(
          data.error?.message ??
            'The invite was created, but the email could not be sent. Use the link below, or send it again.',
        );
      } else {
        setNotice('Invite sent. They will get an email with a link to set up their account.');
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
    setUsers((prev) =>
      prev ? prev.map((u) => (u.id === id ? { ...u, role: nextRole } : u)) : prev,
    );
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
        setError(
          data?.error?.message ??
            (action === 'resend'
              ? 'The invite was not sent again. Try again.'
              : 'The invite was not cancelled. Try again.'),
        );
        return;
      }
      if (action === 'resend') {
        if (data?.delivered === false) {
          setError(
            data.error?.message ??
              'A new link was created, but the email could not be sent. The old link has stopped working.',
          );
        } else {
          setNotice('Invite sent again with a new link. The old link no longer works.');
        }
      } else {
        setNotice(
          'Invite cancelled. That link no longer works, and the email address can be invited again.',
        );
      }
      await loadInvites();
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setInviteActionId(null);
    }
  }

  return (
    <OpsStack>
      <OpsPanel
        title="Invite somebody"
        description="An invite creates a new account. Somebody who already has one is changed further down this page instead — moved to another role, or disabled."
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

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={revealAcceptUrl}
              onChange={(event) => setRevealAcceptUrl(event.target.checked)}
              className="rounded border-input"
            />
            Show me the link as well as emailing it
          </label>

          <p className="text-[11px] leading-relaxed text-subtle">
            The link works once, stops working after seven days, and is never stored in a form
            anybody can read back — not even this screen. Sending the invite again makes a new link
            and breaks the old one.
          </p>

          {error && <OpsAlert tone="error">{error}</OpsAlert>}
          {notice && !error && <OpsAlert tone="success">{notice}</OpsAlert>}
          {acceptUrl && (
            <p className="break-all text-sm text-muted-foreground">
              Their link, shown because you asked above. They were emailed it as well:{' '}
              <span className="font-mono text-primary">{acceptUrl}</span>
            </p>
          )}
        </form>
      </OpsPanel>

      <OpsPanel
        title="Invites still waiting"
        description="Sent, but not used yet. Cancelling one stops the link working and frees the email address so you can invite it again."
        padded={false}
      >
        {!invites ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : invites.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No invites are waiting. Everybody invited has either set up their account or been
            cancelled.
          </p>
        ) : (
          <OpsTableFrame className="rounded-none border-0">
            <table className={opsTableClass}>
              <thead>
                <tr className={opsTheadRowClass}>
                  <th className={opsThClass}>Email</th>
                  <th className={opsThClass}>Role</th>
                  <th className={opsThClass}>State</th>
                  <th className={opsThClass}>Link stops working</th>
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
                            {inviteActionId === invite.id ? 'Working…' : 'Send again'}
                          </OpsButton>
                          <OpsButton
                            variant="quiet"
                            className="px-2 py-1 text-xs hover:border-instrument-danger/60 hover:text-destructive"
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
        <OpsAlert tone="warning" title="That account is shut out here, but its sign-in is not">
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
        title="Everybody with an account"
        description="Somebody with a depot role and no depot set is shown no buses at all, rather than the whole state's; a driver with no bus set receives no instructions. Only an administrator can set either, on purpose."
        padded={false}
      >
        {!users ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : users.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No accounts yet. The first administrator is set up when the system is installed;
            everybody else arrives by invite.
          </p>
        ) : (
          <OpsTableFrame className="rounded-none border-0">
            <table className={opsTableClass}>
              <thead>
                <tr className={opsTheadRowClass}>
                  <th className={opsThClass}>Name</th>
                  <th className={opsThClass}>Email</th>
                  <th className={opsThClass}>Role</th>
                  <th className={opsThClass}>Can sign in</th>
                  <th className={opsThClass}>Bus</th>
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
                    <td className={opsTdMutedClass}>
                      {user.status === 'active' ? 'Yes' : 'No — disabled'}
                    </td>
                    <td className={opsTdClass}>
                      {VEHICLE_ASSIGNABLE_ROLES.includes(user.role) ? (
                        <VehicleAssignmentCell
                          userId={user.id}
                          vehicleId={user.vehicleId}
                          onAssigned={handleVehicleAssigned}
                        />
                      ) : (
                        // Not "nothing to report" and not "unknown": a bus is
                        // meaningless for this role, so the cell says so
                        // rather than borrowing the honest-data vocabulary for
                        // a question that was never asked.
                        <span className="text-subtle" title="not used for this role">
                          <span aria-hidden>—</span>
                          <span className="sr-only">not used for this role</span>
                        </span>
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
                        <span className="text-subtle" title="not used for this role">
                          <span aria-hidden>—</span>
                          <span className="sr-only">not used for this role</span>
                        </span>
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
