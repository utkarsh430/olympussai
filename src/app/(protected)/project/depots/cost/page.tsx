import { requireProjectSession } from '@/lib/auth/server';
import { COST_PATH } from '@/lib/depot/os/workspaces';
import { CostOptimisation } from '@/components/depot/os/finance/CostOptimisation';

/** Cost optimisation across Headquarters (or the chosen region). */
export default async function CostOptimisationPage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(COST_PATH);
  return <CostOptimisation />;
}
