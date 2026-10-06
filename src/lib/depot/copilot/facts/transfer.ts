import type { DepotDistributionResponse } from '@/lib/depot/api';
import {
  buildRequest,
  busCount,
  cleanName,
  km1,
  makeFact,
  ph,
} from '@/lib/depot/copilot/facts/format';
import type { CopilotFact, CopilotRequest } from '@/lib/depot/copilot/types';
import type { DepotBalance, Transfer } from '@/lib/depot/optimise/types';

const GUIDANCE =
  'Explain in plain language why this one recommended transfer makes sense: the surplus at the ' +
  'giving depot, the deficit at the receiving depot, the distance, and that the requirement is ' +
  'modelled until a network timetable is supplied. Use only the supplied facts, describe and ' +
  'recommend, and never instruct.';

function balanceFacts(
  prefix: 'from' | 'to',
  balance: DepotBalance | undefined,
  buses: number,
): CopilotFact[] {
  if (!balance) return [];
  if (prefix === 'from' && balance.balance > 0) {
    return [
      makeFact(
        'transfer.from_surplus',
        'Surplus at the giving depot',
        busCount(balance.balance),
        'modelled',
      ),
      makeFact(
        'transfer.from_after',
        'Surplus left after the transfer',
        busCount(Math.max(0, balance.balance - buses)),
        'modelled',
      ),
    ];
  }
  if (prefix === 'to' && balance.balance < 0) {
    return [
      makeFact(
        'transfer.to_deficit',
        'Deficit at the receiving depot',
        busCount(-balance.balance),
        'modelled',
      ),
      makeFact(
        'transfer.to_after',
        'Deficit left after the transfer',
        busCount(Math.max(0, -balance.balance - buses)),
        'modelled',
      ),
    ];
  }
  return [];
}

const MODELLED_CAVEAT =
  'The requirement is modelled until a network timetable is supplied, so these figures are a planning estimate rather than a measured need.';

/** The closing view follows the balances: it supports the move only when they do. */
function verdict(
  giving: DepotBalance | undefined,
  receiving: DepotBalance | undefined,
  buses: number,
): string {
  const supported = giving && receiving && giving.balance >= buses && receiving.balance < 0;
  return supported
    ? `${MODELLED_CAVEAT} On the modelled figures the surplus at ${ph('transfer.from_name')} covers the move and ${ph('transfer.to_name')} has a deficit it would ease; the network team may wish to confirm it.`
    : `${MODELLED_CAVEAT} The move cannot be assessed from the available modelled balances, so the network team may wish to review it before relying on it.`;
}

function givingSentence(balance: DepotBalance | undefined): string {
  const from = ph('transfer.from_name');
  if (!balance) return `The modelled balance for ${from} is not available`;
  if (balance.balance > 0) {
    return `On the modelled requirement, ${from} is in surplus by ${ph('transfer.from_surplus')}`;
  }
  return `The modelled balance does not show a surplus at ${from}`;
}

function receivingSentence(balance: DepotBalance | undefined): string {
  const to = ph('transfer.to_name');
  if (!balance) return `the balance for ${to} is not available.`;
  if (balance.balance < 0) return `${to} is in deficit by ${ph('transfer.to_deficit')}.`;
  return `${to} does not show a deficit.`;
}

function afterSentence(
  giving: DepotBalance | undefined,
  receiving: DepotBalance | undefined,
  buses: number,
): string {
  const giverLeft = giving && giving.balance > 0 ? giving.balance - buses : null;
  const receiverLeft = receiving && receiving.balance < 0 ? -receiving.balance - buses : null;
  if (giverLeft === null || receiverLeft === null) return '';
  const giver =
    giverLeft > 0
      ? `${ph('transfer.from_name')} would keep a surplus of ${ph('transfer.from_after')}`
      : `${ph('transfer.from_name')} would have no surplus left`;
  const receiver =
    receiverLeft > 0
      ? `${ph('transfer.to_name')} would still be short by ${ph('transfer.to_after')}`
      : `${ph('transfer.to_name')} would have its deficit closed`;
  return ` Afterwards ${giver}, and ${receiver}.`;
}

export function buildTransferRationale(
  transfer: Transfer,
  distribution: DepotDistributionResponse,
): CopilotRequest {
  const giving = distribution.balances.find((b) => b.depotId === transfer.fromDepotId);
  const receiving = distribution.balances.find((b) => b.depotId === transfer.toDepotId);
  const facts: CopilotFact[] = [
    makeFact(
      'transfer.from_name',
      'Giving depot',
      cleanName(giving?.depotName ?? transfer.fromDepotId),
      'live',
    ),
    makeFact(
      'transfer.to_name',
      'Receiving depot',
      cleanName(receiving?.depotName ?? transfer.toDepotId),
      'live',
    ),
    makeFact('transfer.buses', 'Buses moved', busCount(transfer.buses), 'modelled'),
    makeFact(
      'transfer.distance_km',
      'Estimated road distance',
      km1(transfer.distanceKm),
      'derived',
    ),
    makeFact(
      'transfer.max_km',
      "Planner's maximum distance",
      km1(distribution.rebalanceParams.maxTransferKm),
      'reference',
    ),
    ...balanceFacts('from', giving, transfer.buses),
    ...balanceFacts('to', receiving, transfer.buses),
  ];
  const paragraphs = [
    `${givingSentence(giving)}, and ${receivingSentence(receiving)}`,
    `Moving ${ph('transfer.buses')} would run over about ${ph('transfer.distance_km')} of estimated road distance, ${
      transfer.distanceKm <= distribution.rebalanceParams.maxTransferKm
        ? "within the planner's configured maximum of"
        : "beyond the planner's configured maximum of"
    } ${ph('transfer.max_km')}.${afterSentence(giving, receiving, transfer.buses)}`,
    verdict(giving, receiving, transfer.buses),
  ];
  return buildRequest({
    task: 'rationale',
    scopeLabel: `transfer from ${cleanName(giving?.depotName ?? transfer.fromDepotId)} to ${cleanName(receiving?.depotName ?? transfer.toDepotId)}`,
    facts,
    guidance: GUIDANCE,
    scriptedDraft: {
      headline: `Transfer: ${ph('transfer.buses')} from ${ph('transfer.from_name')} to ${ph('transfer.to_name')}`,
      paragraphs,
    },
  });
}
