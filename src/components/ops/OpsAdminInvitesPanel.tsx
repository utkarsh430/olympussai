'use client';

import { useEffect, useState } from 'react';
import { OPERATIONAL_ROLES, type OpsRole } from '@/lib/auth/rbac/roles';

interface OpsUserSummary {
  id: string;
  email: string;
  name: string;
  role: OpsRole;
  status: 'active' | 'disabled';
  createdAt: string;
}

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

const INVITE_STATUS_COLOR: Record<OpsInviteStatus, string> = {
  pending: '#8fb4ff',
  expired: '#f0b45d',
  accepted: '#7ed6a5',
  revoked: '#f0857d',
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
 * Admin invite/user-management panel. Client-side only; every action goes
 * through the guarded /api/ops/admin/* routes, which are the actual
 * enforcement point — this component trusts nothing it doesn't get back from
 * those responses.
 */
export function OpsAdminInvitesPanel() {
  const [users, setUsers] = useState<OpsUserSummary[] | null>(null);
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
        className="space-y-4 rounded-lg border border-[rgba(255,255,255,0.1)] p-5"
      >
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#a3a7b2]">
          Invite a person
        </h2>
        <div className="flex flex-wrap gap-3">
          <input
            type="email"
            required
            placeholder="email@olympuss.us"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="min-w-[220px] flex-1 rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-3 py-2 text-sm text-[#e6e9ef]"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as OpsRole)}
            className="rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(10,11,16,0.6)] px-3 py-2 text-sm text-[#e6e9ef]"
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
            className="bg-[#4f8cff]/12 rounded-md border border-[#4f8cff]/60 px-4 py-2 text-sm text-[#8fb4ff] disabled:opacity-60"
          >
            Send invite
          </button>
        </div>
        <label className="flex items-center gap-2 text-xs text-[#9aa0ad]">
          <input
            type="checkbox"
            checked={revealAcceptUrl}
            onChange={(e) => setRevealAcceptUrl(e.target.checked)}
            className="rounded border-[rgba(255,255,255,0.2)]"
          />
          Also show me the accept link (in addition to emailing it)
        </label>
        {error && (
          <p role="alert" className="text-sm text-[#f0857d]">
            {error}
          </p>
        )}
        {notice && !error && <p className="text-sm text-[#7ed6a5]">{notice}</p>}
        {acceptUrl && (
          <p className="break-all text-sm text-[#9aa0ad]">
            Accept link (shown because you opted in above — the invitee was also emailed this link):{' '}
            <span className="text-[#8fb4ff]">{acceptUrl}</span>
          </p>
        )}
      </form>

      <div className="space-y-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#a3a7b2]">
          Outstanding invites
        </h2>
        {!invites ? (
          <p className="text-sm text-[#9aa0ad]">Loading…</p>
        ) : invites.length === 0 ? (
          <p className="text-sm text-[#9aa0ad]">No outstanding invites.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-[#6f7684]">
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
                <tr key={invite.id} className="border-t border-[rgba(255,255,255,0.06)]">
                  <td className="py-2">{invite.email}</td>
                  <td className="py-2">{invite.role.replace('_', ' ')}</td>
                  <td className="py-2">
                    <span style={{ color: INVITE_STATUS_COLOR[invite.status] }}>
                      {INVITE_STATUS_LABEL[invite.status]}
                    </span>
                  </td>
                  <td className="py-2 text-[#9aa0ad]">{formatExpiry(invite.expiresAt)}</td>
                  <td className="py-2 text-right">
                    {(invite.status === 'pending' || invite.status === 'expired') && (
                      <button
                        type="button"
                        disabled={resendingId === invite.id}
                        onClick={() => handleResend(invite.id)}
                        className="rounded border border-[rgba(255,255,255,0.14)] px-2 py-1 text-xs text-[#9aa0ad] hover:border-[#4f8cff]/60 hover:text-[#8fb4ff] disabled:opacity-60"
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
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#a3a7b2]">People</h2>
        {!users ? (
          <p className="text-sm text-[#9aa0ad]">Loading…</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-[#9aa0ad]">No accounts yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-[#6f7684]">
              <tr>
                <th className="pb-2">Name</th>
                <th className="pb-2">Email</th>
                <th className="pb-2">Role</th>
                <th className="pb-2">Status</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-[rgba(255,255,255,0.06)]">
                  <td className="py-2">{u.name}</td>
                  <td className="py-2">{u.email}</td>
                  <td className="py-2">{u.role.replace('_', ' ')}</td>
                  <td className="py-2">{u.status}</td>
                  <td className="py-2 text-right">
                    {u.status === 'active' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleDisable(u.id)}
                        className="rounded border border-[rgba(255,255,255,0.14)] px-2 py-1 text-xs text-[#9aa0ad] hover:border-[#f0857d]/60 hover:text-[#f0857d]"
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
