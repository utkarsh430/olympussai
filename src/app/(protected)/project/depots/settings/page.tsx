import { Suspense } from 'react';
import { requireProjectSession } from '@/lib/auth/server';
import { SETTINGS_PATH } from '@/lib/depot/os/workspaces';
import { SettingsView } from '@/components/depot/os/system/SettingsView';

/** Preferences of Depot Intelligence OS kept in this browser. */
export default async function OsSettingsPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(SETTINGS_PATH);
  return (
    <Suspense fallback={null}>
      <SettingsView />
    </Suspense>
  );
}
