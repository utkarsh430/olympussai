import { LATE_AFTER_MIN } from '../routes/delayConfig';
import { bandLabel } from './bands';
import { NOT_RUN_AFTER_MIN } from './proposalConfig';
import type { HourBand, ProposalSource } from './types';

/*
 * One fixed sentence per proposal kind, the figures filled in. Plain words
 * about buses, journeys and hours only: no person, no cause, no blame, no
 * alarm (the copilot's judgement list), and every modelled figure says so.
 */

export type ReasonInput =
  | {
      readonly kind: 'add_buses';
      readonly band: HourBand;
      readonly deployed: number;
      readonly needed: number;
      readonly change: number;
      readonly source: ProposalSource | null;
    }
  | {
      readonly kind: 'hold_buses';
      readonly band: HourBand;
      readonly deployed: number;
      readonly needed: number;
      readonly change: number;
      readonly keep: number;
      readonly source: ProposalSource | null;
    }
  | { readonly kind: 'trips_not_run'; readonly band: HourBand; readonly journeys: number }
  | {
      readonly kind: 'service_span_gap';
      readonly band: HourBand;
      readonly demand: number;
      readonly edge: 'before_first' | 'after_last';
      /** `HH:MM` of the first scheduled start or the last scheduled end. */
      readonly at: string;
    }
  | {
      readonly kind: 'headway_gap';
      readonly band: HourBand;
      readonly from: string;
      readonly to: string;
      readonly minutes: number;
      readonly demand: number;
    }
  | {
      readonly kind: 'revise_running_time';
      readonly band: HourBand;
      readonly medianMin: number;
      readonly journeys: number;
    };

const figure = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const buses = (n: number): string => `${figure(n)} ${n === 1 ? 'bus' : 'buses'}`;

function sourceClause(source: ProposalSource | null): string {
  if (source === null) return ' (no source depot is known)';
  if (source.basis === 'observed' && source.standingInYard !== null) {
    return ` from ${source.depotName}, which had ${source.standingInYard} standing in its yard the hour before`;
  }
  const idle = source.idleInDayPlan;
  if (idle !== undefined && idle !== null) {
    return ` from ${source.depotName}, which has ${idle} idle in the modelled day plan`;
  }
  return ` from ${source.depotName}`;
}

function holdPlace(source: ProposalSource | null): string {
  return source === null ? '' : ` at ${source.depotName}`;
}

/** The proposal's reason: one sentence, figures filled in. */
export function proposalReason(input: ReasonInput): string {
  const band = bandLabel(input.band);
  switch (input.kind) {
    case 'add_buses':
      return (
        `${band}: modelled demand needs about ${buses(input.needed)} against ${figure(input.deployed)} ` +
        `deployed; add ${buses(input.change)}${sourceClause(input.source)}.`
      );
    case 'hold_buses':
      return (
        `${band}: ${buses(input.deployed)} deployed against about ${figure(input.needed)} needed for ` +
        `modelled demand; ${buses(Math.abs(input.change))} could be held${holdPlace(input.source)}, ` +
        `keeping at least ${figure(input.keep)} on the route.`
      );
    case 'trips_not_run':
      return (
        `${band}: ${input.journeys} scheduled ${input.journeys === 1 ? 'journey shows' : 'journeys show'} ` +
        `no actual start more than ${NOT_RUN_AFTER_MIN} minutes after the scheduled time.`
      );
    case 'service_span_gap':
      return (
        `${band}: modelled demand is ${input.demand} boardings with no scheduled journey known ` +
        `${input.edge === 'before_first' ? 'before the first start at' : 'after the last end at'} ${input.at}.`
      );
    case 'headway_gap':
      return (
        `${band}: no journey is scheduled to start between ${input.from} and ${input.to}, a gap of ` +
        `${input.minutes} minutes, while modelled demand is ${input.demand} boardings.`
      );
    case 'revise_running_time':
      return (
        `${band}: the median delay was ${figure(input.medianMin)} minutes or more in each hour, beyond ` +
        `the ${LATE_AFTER_MIN}-minute late mark, over ${input.journeys} journeys; the scheduled ` +
        `running time may be too short.`
      );
  }
}
