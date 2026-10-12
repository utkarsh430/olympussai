import { Info } from 'lucide-react';
import { DEPOT_MEANING_TONE, DEPOT_TONE_CLASS, meaningTextClass, type DepotMeaning } from '@/lib/depot/palette';

export interface KpiCardProps {
  readonly label: string;
  /** Already formatted. */
  readonly value: string;
  readonly subtitle: string;
  /** How the figure is calculated; shown on hover and read with the card. */
  readonly help: string;
  readonly tone: DepotMeaning;
  /** A small contextual line under the subtitle ("Peak 42 buses short at 08:00"). */
  readonly indicator?: string;
  readonly indicatorTone?: DepotMeaning;
}

/**
 * One network figure as a panel: mono label with an info mark, the value as the hero
 * numeral in its meaning's tone (the hero wash colours it), a short subtitle and a
 * contextual line. The help sentence is the card's title and is read by assistive technology.
 */
export function KpiCard({ label, value, subtitle, help, tone, indicator, indicatorTone }: KpiCardProps) {
  const toneClass = DEPOT_TONE_CLASS[DEPOT_MEANING_TONE[tone]];
  const indicatorClass = indicatorTone ? meaningTextClass(indicatorTone) : 'text-depot-muted';
  return (
    <li
      className={`depot-panel depot-figure-hero ${toneClass} flex min-w-0 flex-col px-4 pb-3 pt-3 transition-colors duration-500`}
      title={help}
      data-testid="kpi-card"
    >
      <div className="depot-tag-row justify-between gap-2">
        <span className="depot-label truncate">{label}</span>
        <Info aria-hidden className="h-3 w-3 shrink-0 text-depot-faint" />
      </div>
      <div className="depot-hero-numeral mt-2 break-words text-[28px] transition-all duration-500">{value}</div>
      <p className="depot-caption mt-1.5">{subtitle}</p>
      {indicator ? (
        <p className={`depot-note mt-auto pt-2 font-mono text-[11px] uppercase tracking-[0.08em] ${indicatorClass}`}>{indicator}</p>
      ) : null}
      <p className="sr-only">{help}</p>
    </li>
  );
}
