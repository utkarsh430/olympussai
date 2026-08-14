'use client';

import { useState } from 'react';
import { ScheduleLookupForm } from '@/components/ops/ScheduleLookupForm';
import { BreakdownReportsPanel } from '@/components/ops/BreakdownReportsPanel';
import { BreakdownReportPanel } from './BreakdownReportPanel';

const DRIVER_REG_STORAGE_KEY = 'ops.driver.vehicleReg';

/**
 * Driver dashboard content (AC1/AC5): deliberately narrower than the
 * dispatcher/control-room/planner fleet-wide views — a driver sees only
 * their own vehicle's schedule and a breakdown-reporting panel. No fleet
 * table, no dispatcher/control-room action forms.
 *
 * ops_users now has a real admin-assigned `vehicle_id`
 * (db/migrations/20260806180000__ops_users_vehicle_assignment.sql), added
 * to close the A01 gap on the pilot-driver command console
 * (src/app/api/ops/pilot-driver/commands/[id]/ack/route.ts), which reads
 * from that column instead of trusting client input.
 *
 * Vehicle scoping: `assignedVehicleId` is that same admin-set assignment,
 * read server-side from the caller's own ops_users row (same data GET
 * /api/ops/auth/session exposes as `vehicleId`; see
 * src/app/(ops)/ops/driver/page.tsx). When present it is the sole source of
 * truth for both children below and the client-self-report convenience
 * (remembering a typed registration in localStorage) is disabled, so a
 * driver can no longer mis-scope their own schedule view or misattribute a
 * breakdown report just by having previously typed someone else's
 * registration on this device.
 *
 * When absent (an admin has not assigned a vehicle to this account yet)
 * this falls back to the pre-existing self-reported-registration-
 * remembered-in-localStorage convention, so an unmigrated driver is never
 * blocked. A wrong self-report here only mis-scopes a read-only schedule
 * view or misattributes a breakdown report a driver chose to file (no
 * other driver's commands or approvals are exposed), which is why this
 * fallback is acceptable here even though it isn't for the command-ack path.
 */
export function DriverDashboard({
  assignedVehicleId = null,
}: {
  assignedVehicleId?: string | null;
}) {
  // Bumped on every successful submit and used as BreakdownReportsPanel's
  // `key`, so a remount re-runs its load effect and the driver's own
  // history never shows stale data after filing a new report.
  const [reportsRefreshKey, setReportsRefreshKey] = useState(0);

  return (
    <div className="space-y-8">
      <section>
        <ScheduleLookupForm
          title="My schedule"
          defaultRegNum={assignedVehicleId ?? undefined}
          rememberKey={assignedVehicleId ? undefined : DRIVER_REG_STORAGE_KEY}
        />
      </section>

      <section>
        <BreakdownReportPanel
          defaultVehicleReg={assignedVehicleId ?? undefined}
          onSubmitted={() => setReportsRefreshKey((key) => key + 1)}
        />
      </section>

      <section>
        <h2 className="ops-label mb-3">
          My breakdown reports
        </h2>
        <BreakdownReportsPanel key={reportsRefreshKey} scope="mine" />
      </section>
    </div>
  );
}
