import { Suspense } from 'react';
import { requireProjectSession } from '@/lib/auth/server';
import { SchedulerRollupPage } from '@/components/depot/schedule/SchedulerRollupPage';
import { LoadingBlock } from '@/components/depot/shell/DataStates';
import { PageHeader } from '@/components/depot/shell/PageHeader';
import { SCHEDULER_PATH } from '@/lib/depot/nav';
import { PAGE_TITLE, ROLLUP_DESCRIPTION } from '@/lib/depot/schedule/scheduleWording';

/** Headquarters' AI Scheduler: every depot's plan for the day, rolled up. */
export default async function SchedulerRoutePage() {
  // Layouts do not re-run on client navigation, so the page gates itself too.
  await requireProjectSession(SCHEDULER_PATH);
  return (
    <Suspense
      fallback={
        <>
          <PageHeader title={PAGE_TITLE} description={ROLLUP_DESCRIPTION} />
          <LoadingBlock rows={10} label="Loading the schedules" />
        </>
      }
    >
      <SchedulerRollupPage />
    </Suspense>
  );
}
