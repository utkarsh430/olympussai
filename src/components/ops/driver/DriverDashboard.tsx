import { ScheduleLookupForm } from '@/components/ops/ScheduleLookupForm';
import { BreakdownReportPanel } from './BreakdownReportPanel';

const DRIVER_REG_STORAGE_KEY = 'ops.driver.vehicleReg';

/**
 * Driver dashboard content (AC1/AC5): deliberately narrower than the
 * dispatcher/control-room/planner fleet-wide views — a driver sees only
 * their own vehicle's schedule (looked up by registration, remembered
 * locally) and a breakdown-reporting panel. No fleet table, no
 * dispatcher/control-room action forms.
 *
 * ops_users now has a real admin-assigned `vehicle_id`
 * (db/migrations/20260806180000__ops_users_vehicle_assignment.sql), added
 * to close the A01 gap on the pilot-driver command console
 * (src/app/api/ops/pilot-driver/commands/[id]/ack/route.ts), which reads
 * from that column instead of trusting client input. This dashboard's
 * schedule lookup and BreakdownReportPanel still use the self-reported
 * registration: a wrong self-report here only mis-scopes a read-only
 * schedule view or misattributes a breakdown report a driver chose to file
 * (no other driver's commands or approvals are exposed), which is lower
 * severity than the command-ack path and is tracked as separate follow-up
 * work rather than folded into this fix.
 */
export function DriverDashboard() {
  return (
    <div className="space-y-8">
      <section>
        <ScheduleLookupForm
          title="My schedule"
          rememberKey={DRIVER_REG_STORAGE_KEY}
        />
      </section>

      <section>
        <BreakdownReportPanel />
      </section>
    </div>
  );
}
