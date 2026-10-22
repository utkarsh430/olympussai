import { requireProjectSession } from '@/lib/auth/server';
import { REVENUE_INTEL_PATH } from '@/lib/depot/os/workspaces';
import { RevenueIntelligence } from '@/components/depot/os/finance/RevenueIntelligence';

/** Revenue intelligence across Headquarters (or the chosen region). */
export default async function RevenueIntelligencePage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(REVENUE_INTEL_PATH);
  return <RevenueIntelligence />;
}
