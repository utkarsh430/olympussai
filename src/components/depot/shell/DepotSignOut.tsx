'use client';

import { LogOut } from 'lucide-react';
import { SIGN_OUT_FAILED, useProjectSignOut } from '@/hooks/useProjectSignOut';

export { SIGN_OUT_FAILED };

/**
 * Sign-out for the depot top bar. Depot pages run without CSS zoom and with an
 * 11px type floor, so this is its own control rather than the command centre's
 * smaller `ProjectSignOut`; both share `useProjectSignOut`. `quiet` is the bar's
 * in-row form from 1280px; inside the Menu panel it keeps its outline.
 */
export function DepotSignOut({ quiet = false }: { readonly quiet?: boolean }) {
  const { signOut, pending, failed } = useProjectSignOut();

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      data-testid="depot-sign-out"
      title={failed ? SIGN_OUT_FAILED : undefined}
      className={
        quiet
          ? 'depot-bar-button depot-bar-button-gold depot-bar-button-quiet'
          : 'depot-bar-button depot-bar-button-gold'
      }
    >
      <LogOut className="h-3.5 w-3.5" aria-hidden />
      {pending ? 'Signing out…' : failed ? 'Sign-out failed: retry' : 'Sign out'}
      <span role="status" className="sr-only">
        {failed ? SIGN_OUT_FAILED : ''}
      </span>
    </button>
  );
}
