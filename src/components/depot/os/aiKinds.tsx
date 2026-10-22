'use client';

import { FlaskConical, Lightbulb, ScanEye, ScanSearch, TrendingUp, Zap, type LucideIcon } from 'lucide-react';
import type { AiKind } from '@/lib/depot/os/workspaces';

/**
 * The visual identity of the AI's six kinds of work. Intelligence (watching, projecting,
 * flagging, ranking, recomputing) is cyan; optimisation, which proposes a better plan, is
 * teal. A conventional view carries no glyph at all, so the glyph itself is the signal.
 */
export interface AiKindMeta {
  readonly label: string;
  /** Short form for chips: `AI · PREDICT`. */
  readonly short: string;
  readonly icon: LucideIcon;
  /** Text colour class of the glyph and chip. */
  readonly tone: string;
  /** One line on what the kind of work is. */
  readonly does: string;
}

export const AI_KIND: Readonly<Record<AiKind, AiKindMeta>> = {
  monitor: { label: 'AI Monitoring', short: 'Monitor', icon: ScanEye, tone: 'text-holo-glow', does: 'Watches the feed and the records and classifies what it sees.' },
  predict: { label: 'AI Prediction', short: 'Predict', icon: TrendingUp, tone: 'text-holo-glow', does: 'Projects demand, readiness and wear forward, with a range.' },
  optimize: { label: 'AI Optimization', short: 'Optimize', icon: Zap, tone: 'text-holo-teal', does: 'Computes a better plan under constraints and compares it with today’s.' },
  anomaly: { label: 'AI Anomaly Detection', short: 'Detect', icon: ScanSearch, tone: 'text-holo-glow', does: 'Flags what departs from its own history or its peers, to verify.' },
  recommend: { label: 'AI Recommendation', short: 'Recommend', icon: Lightbulb, tone: 'text-holo-glow', does: 'Ranks actions with their evidence for a person to decide.' },
  simulate: { label: 'Scenario Simulation', short: 'Simulate', icon: FlaskConical, tone: 'text-holo-glow', does: 'Recomputes the network under a changed demand, fleet or plan.' },
};

/** The kind's glyph alone, for the sidebar and dense rows. */
export function AiGlyph({ kind, className = 'h-3 w-3' }: { readonly kind: AiKind; readonly className?: string }) {
  const meta = AI_KIND[kind];
  const Icon = meta.icon;
  return <Icon className={`${className} shrink-0 ${meta.tone}`} aria-label={meta.label} role="img" />;
}

/** `AI · OPTIMIZE` with its glyph: the capability label on a panel or a ribbon. */
export function AiKindChip({ kind }: { readonly kind: AiKind }) {
  const meta = AI_KIND[kind];
  const Icon = meta.icon;
  const optimise = kind === 'optimize';
  return (
    <span
      className={`os-chip ${optimise ? 'border-holo-teal/40 bg-holo-teal/[0.07]' : 'border-holo-glow/35 bg-holo-glow/[0.06]'} ${meta.tone}`}
      title={`${meta.label}: ${meta.does}`}
    >
      <Icon className="h-2.5 w-2.5" aria-hidden />
      AI · {meta.short}
    </span>
  );
}
