'use client';

import { LogOut } from 'lucide-react';
import { useProjectSignOut } from '@/hooks/useProjectSignOut';

/**
 * Sign-out for the depot top bar. Depot pages run without CSS zoom and with an
 * 11px type floor, so this is its own control rather than the command centre's
 * smaller `ProjectSignOut`; both share `useProjectSignOut`.
 */
export function DepotSignOut() {
  const { signOut, pending } = useProjectSignOut();

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      data-testid="depot-sign-out"
      className="hud-button whitespace-nowrap"
    >
      <LogOut className="h-3.5 w-3.5" aria-hidden />
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
