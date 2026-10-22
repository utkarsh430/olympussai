'use client';

import { RationalePanel, RationaleToggle, useScheduleRationale } from '@/components/depot/copilot/RationaleButton';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';

/** "Why this plan?": the AI Engine's explanation of the plan, written on request. */
export function ScheduleRationale({ depotId, planKey }: { readonly depotId: string; readonly planKey: string }) {
  const rationale = useScheduleRationale(depotId, planKey);
  return (
    <section aria-label="Why this plan" className="min-w-0">
      <SectionLabel label="Why this plan?" />
      <div className="flex flex-col gap-2">
        <div>
          <RationaleToggle expanded={rationale.expanded} onToggle={rationale.toggle} panelId={rationale.panelId} label="this schedule plan" status={rationale.status} />
        </div>
        <RationalePanel id={rationale.panelId} expanded={rationale.expanded} state={rationale.state} onRetry={rationale.retry} headingLevel={3} />
      </div>
    </section>
  );
}
