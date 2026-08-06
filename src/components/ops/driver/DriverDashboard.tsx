import { ScheduleLookupForm } from '@/components/ops/ScheduleLookupForm';
import { BreakdownReportPanel } from './BreakdownReportPanel';

const DRIVER_REG_STORAGE_KEY = 'ops.driver.vehicleReg';

/**
 * Driver dashboard content (AC1/AC5): deliberately narrower than the
 * dispatcher/control-room/planner fleet-wide views — a driver sees only
 * their own vehicle's schedule (looked up by registration, remembered
 * locally since the RBAC schema has no driver-to-vehicle assignment) and a
 * breakdown-reporting panel. No fleet table, no dispatcher/control-room
 * action forms.
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
