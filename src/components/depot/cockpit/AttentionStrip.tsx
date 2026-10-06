import Link from 'next/link';
import type { Attention } from '@/lib/depot/cockpit/attention';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { attentionLayoutClasses } from '@/lib/depot/cockpit/attentionLayout';
import { DEPOT_FIGURE_MEANING } from '@/lib/depot/figureTones';
import { formatCount } from '@/lib/depot/format';
import { meaningToneClass } from '@/lib/depot/palette';

/**
 * The cockpit's hero: what needs attention now, most pressing first, each line a link to
 * the list that holds those buses, ending in where it lands. How the lines sit at each
 * width is `attentionLayout`'s: a single-column list on a phone, where a line wraps rather
 * than cutting its words; five 3 + 2 from 640 px and on one row from 1280; six three
 * across in two rows; never one line alone on a row of several columns. One compact nil
 * line when nothing needs attention.
 */
export function AttentionStrip({ attention }: { readonly attention: Attention }) {
  const layout = attentionLayoutClasses(attention.lines.length);
  return (
    <section aria-labelledby="depot-attention" data-testid="depot-attention" className="min-w-0">
      <h2 id="depot-attention" className="sr-only">
        Needs attention
      </h2>
      {attention.calm !== null ? (
        <StatePanel kind="empty" compact tone="ok" sentence={attention.calm} />
      ) : (
        <ul className={`grid min-w-0 border-y border-depot-line ${layout.list}`}>
          {attention.lines.map((line) => (
            <li
              key={line.key}
              className={`min-w-0 border-t border-depot-line first:border-t-0 ${layout.item}`}
            >
              <Link
                href={line.href}
                data-testid={`depot-attention-${line.key}`}
                className={`group flex min-w-0 items-baseline gap-4 py-2 hover:bg-depot-surface focus-visible:bg-depot-surface ${layout.link}`}
              >
                <span
                  className={`depot-figure-value w-14 shrink-0 text-right font-display text-[24px] tabular-nums leading-none ${meaningToneClass(DEPOT_FIGURE_MEANING[line.key] ?? 'count')} ${layout.count}`}
                >
                  {formatCount(line.count)}
                </span>
                <span
                  className={`min-w-0 flex-1 font-sans text-sm text-depot-ink group-hover:underline ${layout.words}`}
                  title={line.text}
                >
                  {line.text.replace(/^[\d,]+ /, '')}
                </span>
                <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.12em] text-depot-muted">
                  {line.destination}
                  <span aria-hidden> ›</span>
                </span>
              </Link>
            </li>
          ))}
          {layout.filler !== null ? (
            // The empty last cell of a 3 + 2 strip carries the rule between its rows.
            <li aria-hidden data-testid="depot-attention-filler" className={layout.filler} />
          ) : null}
        </ul>
      )}
    </section>
  );
}
