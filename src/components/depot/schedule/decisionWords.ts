import { VERB } from '@/lib/depot/rebalance/decisionEvents';
import type { TransferDecisionKind } from '@/lib/depot/rebalance/rebalanceModel';

export { DECISION_REFUSED, TRAIL_CLEARED, TRAIL_CLEAR_REFUSED, UNDO_REFUSED, recordStatus } from '@/lib/depot/rebalance/decisionWording';

export const VERB_SENTENCE: Readonly<Record<TransferDecisionKind, string>> = VERB;
