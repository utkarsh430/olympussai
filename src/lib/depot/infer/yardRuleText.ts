import {
  YARD_DOMINANCE_RATIO,
  YARD_LINK_M,
  YARD_MAX_SPAN_M,
  YARD_MIN_CLUSTER,
  YARD_MIN_SHARE,
} from './yard';

const PERCENT = 100;
const METRES_PER_KM = 1000;

/**
 * The yard rule in words, for every screen that has to explain why a yard is or
 * is not established. Built from the inference's own constants so the sentence
 * cannot drift from the rule.
 */
export const YARD_RULE_SENTENCE =
  `A yard is claimed only when at least ${YARD_MIN_CLUSTER} parked buses stand together, each ` +
  `within ${YARD_LINK_M} m of the next, in one place that holds at least ` +
  `${YARD_MIN_SHARE * PERCENT}% of the depot's parked buses, ${YARD_DOMINANCE_RATIO} times ` +
  `as many as any other place, and is no more than ${YARD_MAX_SPAN_M / METRES_PER_KM} km across.`;
