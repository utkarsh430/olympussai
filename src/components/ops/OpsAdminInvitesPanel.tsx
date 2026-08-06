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

const INVITABLE_ROLES: OpsRole[] = [...OPERATIONAL_ROLES, 'admin'];

/**
 * Admin invite/user-management panel. Client-side only; every action goes
 * through the guarded /api/ops/admin/* routes, which are the actual
 * enforcement point — this component trusts nothing it doesn't get back from
 * those responses.
 */
export function OpsAdminInvitesPanel() {
  const [users, setUsers] = useState<OpsUserSummary[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OpsRole>('driver');
  const [acceptUrl, setAcceptUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadUsers() {
    const response = await fetch('/api/ops/admin/users', { cache: 'no-store' });
    if (response.ok) {
      const data = (await response.json()) as { users: OpsUserSummary[] };
      setUsers(data.users);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setAcceptUrl(null);
    try {
      const response = await fetch('/api/ops/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      });
      const data = (await response.json().catch(() => null)) as {
        acceptUrl?: string;
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        setError(data?.error?.message ?? 'Could not create invite.');
        return;
      }
      setAcceptUrl(data?.acceptUrl ?? null);
      setEmail('');
      await loadUsers();
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
        {error && (
          <p role="alert" className="text-sm text-[#f0857d]">
            {error}
          </p>
        )}
        {acceptUrl && (
          <p className="break-all text-sm text-[#9aa0ad]">
            Share this link with the invitee (shown once, not emailed automatically):{' '}
            <span className="text-[#8fb4ff]">{acceptUrl}</span>
          </p>
        )}
      </form>

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
