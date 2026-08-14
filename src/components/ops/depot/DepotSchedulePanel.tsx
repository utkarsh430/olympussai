import { OpsAlert, OpsSection, OpsStack } from '@/components/ops/ui';
import { ScheduleLookupForm } from '@/components/ops/ScheduleLookupForm';

/**
 * The per-vehicle stop list, with the one thing an operator has to know before
 * reading it.
 *
 * ─── ONE PUBLISHED TIME PER STOP ─────────────────────────────────────────
 *
 * The upstream publishes a single time for each stop. This app's normalizer
 * writes that one value into BOTH `scheduledArrival` and `scheduledDeparture`
 * (src/lib/upsrtc/normalizer.ts — the two fields are assigned from the same
 * `scheduled` local, on adjacent lines). They are not two measurements that
 * happen to agree; they are one measurement stored twice.
 *
 * So the stop list shows one time column and says why. Showing "arrival" and
 * "departure" side by side would render the same number twice and invite an
 * operator to reason about a dwell that is structurally always zero — a
 * fabricated distinction that no upstream field supports.
 *
 * And it is a TIMETABLE time, not a prediction. Nothing on this panel is an
 * estimated arrival: predicted arrivals are a separate subsystem with its own
 * honesty about when it declines to answer, and conflating a published
 * schedule with a prediction is how an operator ends up trusting a number
 * nobody computed.
 */
export function DepotSchedulePanel() {
  return (
    <OpsStack gap="tight">
      <OpsAlert tone="info" title="One published time per stop.">
        The timetable gives a single time for each stop, and this system stores that one time as
        both the arrival and the departure — they are the same number, not two separate predictions,
        so only one is shown. It is a published timetable time, not an estimate of when the bus will
        actually get there.
      </OpsAlert>

      <OpsSection
        title="Timetable for one bus"
        description="Look up any bus by its number plate to see the stops for the journey it is running today."
      >
        <ScheduleLookupForm title="Look up a bus's stops" />
      </OpsSection>
    </OpsStack>
  );
}
