import { PageHeader } from '@/components/depot/shell/PageHeader';
import { PAGE_DESCRIPTION, PAGE_TITLE } from '@/lib/depot/schedule/scheduleWording';

/** The scheduler page's header in every state: the title and the one description. No provenance line. */
export function ScheduleHeader() {
  return <PageHeader title={PAGE_TITLE} description={PAGE_DESCRIPTION} />;
}
