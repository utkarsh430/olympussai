import { describeMix, statusSegments } from '@/components/depot/network/StatusMixBar';
import { REPORTING_WINDOW_MIN } from '@/lib/depot/infer/thresholds';
import { YARD_RULE_SENTENCE } from '@/lib/depot/infer/yardRuleText';
import type { StatusMix } from '@/lib/depot/types';
import { HowProduced } from '@/components/depot/shell/HowProduced';

/** The closing disclosure's anchor: the no-yard line's "How a yard is found ›" opens it. */
export const COCKPIT_HOW_ID = 'how-produced';

export interface CockpitMethodProps {
  readonly fleet: number;
  readonly yardSentence: string;
  readonly yardEstablished: boolean;
  /** The feed's own `vehicle_status` counts, as it reports them. */
  readonly status: StatusMix;
}

/** "How these figures are produced": closed by default, at the end of the page. */
export function CockpitMethod({ fleet, yardSentence, yardEstablished, status }: CockpitMethodProps) {
  // With no yard, `yardSentence` already carries the rule.
  const yard = yardEstablished
    ? `${yardSentence} The yard is inferred from where buses park, not surveyed. ${YARD_RULE_SENTENCE}`
    : yardSentence;
  return (
    <HowProduced testId="depot-cockpit-method" id={COCKPIT_HOW_ID}>
      <p className="depot-prose">
        Each bus is in exactly one of five states, inferred from its last report; the five add up
        to the fleet of {fleet.toLocaleString('en-IN')}. A bus heard more than {REPORTING_WINDOW_MIN} minutes ago keeps
        the state it last reported and is marked as not heard.
      </p>
      <p className="depot-prose">{yard}</p>
      <p className="depot-prose">
        &ldquo;In the yard&rdquo; counts every bus of this depot inside the yard, whatever its
        state, as the yard page does; &ldquo;standing in the yard&rdquo; counts only the standing
        ones.
      </p>
      <p className="depot-prose">
        &ldquo;Main power off&rdquo; on the attention line counts every bus whose main power reads
        off, as the roster filter does. The power-off cluster and the power-off group leave out
        buses off the road, whose power is expected to be off; the group lists only buses with no
        more severe flag.
      </p>
      <p className="depot-prose">The feed&apos;s own status, as it reports it (LIVE): {describeMix(statusSegments(status))}</p>
      <p className="depot-prose">
        The efficiency index and the depot exceptions that compare this depot with its peers are
        summed over a rolling window of snapshots; a depot exception&apos;s bus count is as of the
        latest snapshot.
      </p>
      <p className="depot-prose">
        The briefing is a short written summary of the latest figures. It is advisory: it
        describes and recommends, it does not instruct.
      </p>
    </HowProduced>
  );
}
