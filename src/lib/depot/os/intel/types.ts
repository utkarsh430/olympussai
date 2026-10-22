import type { DataStatus } from '../dataStatus';

/**
 * Shapes shared by the OS's intelligence engines: the decision queue, the fuel audit,
 * readiness, reliability and the scenario studio. Every engine is pure and seeded, so the
 * same snapshot and date always give the same decisions, and the copilot, the queue and
 * the workspaces quote the same figures.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export type DecisionCategory =
  | 'shortage'
  | 'redistribution'
  | 'maintenance'
  | 'incident'
  | 'fuel'
  | 'crew'
  | 'telemetry'
  | 'efficiency'
  | 'schedule';

export interface EvidenceItem {
  readonly label: string;
  readonly value: string;
  readonly status: DataStatus;
}

export interface DecisionOption {
  readonly title: string;
  readonly detail: string;
  /** What following it changes, in one phrase with its figure. */
  readonly impact: string;
  readonly tradeOff: string;
}

/** A link from a decision to where its records are. */
export interface DecisionLink {
  readonly label: string;
  readonly href: string;
}

/**
 * One AI decision, always in the same seven parts: what was detected, why it matters,
 * the evidence, what can be done, the alternatives, the expected impact, and what a
 * person must approve.
 */
export interface Decision {
  readonly id: string;
  readonly category: DecisionCategory;
  readonly severity: Severity;
  /** Ranking score inside a severity: larger is more urgent. */
  readonly weight: number;
  readonly title: string;
  readonly entity: { readonly kind: 'depot' | 'vehicle' | 'route' | 'network'; readonly id: string; readonly label: string };
  readonly depotId: string | null;
  /** When it bites, e.g. "Morning peak 06:00–10:00" or "Now". */
  readonly timing: string;
  readonly detected: string;
  readonly whyItMatters: string;
  readonly evidence: readonly EvidenceItem[];
  readonly recommendation: DecisionOption;
  readonly alternatives: readonly DecisionOption[];
  readonly impact: string;
  readonly approval: string;
  readonly links: readonly DecisionLink[];
  /** The kind of figure the conclusion rests on. */
  readonly basis: DataStatus;
}
