import { SAME_PLACE_KM } from '@/lib/depot/rebalance/pageLayout';
import { Disclosure } from './Disclosure';

const PERCENT = 100;

/** The page's closing disclosure: how the requirement and the plan are produced. */
export function RebalanceMethod({ spareRatio }: { readonly spareRatio: number }) {
  const spare = Math.round(spareRatio * PERCENT * 10) / 10;
  return (
    <Disclosure label="How these figures are produced" testId="rebalance-method">
      <div className="depot-prose flex max-w-3xl flex-col gap-2 text-[13px]">
        <p>
          Live: each depot&apos;s fleet, buses off road and buses available come from the latest
          feed snapshot. Modelled: the feed carries no network timetable, so each depot&apos;s
          requirement is modelled by a stated rule (a depot whose buses are more on the road
          than its peers&apos; is assumed stretched, one with many standing buses to have slack)
          plus a spare margin of {spare}% of peak need. The requirement stays modelled until a
          timetable is supplied, so every transfer is a modelled recommendation.
        </p>
        <p>
          Road distances are estimates between inferred depot positions. Two depots inferred
          less than {SAME_PLACE_KM} km apart are said to stand at the same place; a transfer
          between them costs almost no empty running.
        </p>
        <p>
          Approve, Reject and Defer add to a record kept in this browser and to an audit event;
          no transfer order is issued. Hired, electric and enforcement units are listed but take
          no part in the plan.
        </p>
      </div>
    </Disclosure>
  );
}
