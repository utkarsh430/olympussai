import { describeMix, statusSegments } from '@/components/depot/network/StatusMixBar';
import { YARD_RULE_SENTENCE } from '@/lib/depot/infer/yardRuleText';
import type { StatusMix } from '@/lib/depot/types';
import { HowProduced } from '@/components/depot/shell/HowProduced';

export interface CockpitMethodProps {
  readonly fleet: number;
  readonly yardSentence: string;
  readonly yardEstablished: boolean;
  /** The feed's own `vehicle_status` counts, as it reports them. */
  readonly status: StatusMix;
}

/** "How these figures are produced": closed by default, at the end of the page. */
export function CockpitMethod({ fleet, yardSentence, yardEstablished, status }: CockpitMethodProps) {
  return (
    <HowProduced testId="depot-cockpit-method">
        <p>
          Each bus is in exactly one of five states, inferred from its last report; the five add up
          to the fleet of {fleet.toLocaleString('en-IN')}. A bus heard more than 30 minutes ago keeps
          the state it last reported and is marked as not heard.
        </p>
        {/* With no yard, the availability section already states the rule. */}
        {yardEstablished ? (
          <p>{`${yardSentence} The yard is inferred from where buses park, not surveyed. ${YARD_RULE_SENTENCE}`}</p>
        ) : null}
        <p>The feed&apos;s own status, as it reports it (LIVE): {describeMix(statusSegments(status))}</p>
        <p>
          The efficiency index and the depot exceptions that compare this depot with its peers are
          summed over a rolling window of snapshots; a depot exception&apos;s bus count is as of the
          latest snapshot.
        </p>
        <p>
          The briefing is a short written summary of the latest figures. It is advisory: it
          describes and recommends, it does not instruct.
        </p>
    </HowProduced>
  );
}
