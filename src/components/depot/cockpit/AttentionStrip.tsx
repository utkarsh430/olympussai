import Link from 'next/link';
import type { Attention } from '@/lib/depot/cockpit/attention';
import { StatePanel } from '@/components/depot/shell/StatePanel';
import { formatCount } from '@/lib/depot/format';

const ONE_ROW_LINES = 5;

/** Classes that turn a line into a stacked cell of the one-row strip, from 1280 px. */
const ROW = {
  list: 'xl:grid-cols-5',
  item: 'xl:border-t-0 xl:border-l xl:pl-4 xl:first:border-l-0 xl:first:pl-0',
  link: 'xl:h-full xl:flex-col xl:items-start xl:gap-1',
  count: 'xl:w-auto xl:text-left',
  words: 'xl:overflow-visible xl:whitespace-normal',
  filler: 'xl:hidden',
} as const;

/**
 * The cockpit's hero: what needs attention now, most pressing first, each line a
 * link to the list that holds those buses, ending in where it lands; two columns from
 * 1024 px (an odd strip's empty last cell keeps its rule, so six sit as two columns of
 * three). Five lines sit on one row from 1280 px, each a stacked cell (count, words,
 * destination) whose words wrap, so no line is left alone on a row. Under 640 px a line
 * wraps to a second line rather than cutting its words. One compact nil line when nothing
 * needs attention.
 */
export function AttentionStrip({ attention }: { readonly attention: Attention }) {
  const oneRow = attention.lines.length === ONE_ROW_LINES;
  const at = (key: keyof typeof ROW): string => (oneRow ? ROW[key] : '');
  return (
    <section aria-labelledby="depot-attention" data-testid="depot-attention" className="min-w-0">
      <h2 id="depot-attention" className="sr-only">
        Needs attention
      </h2>
      {attention.calm !== null ? (
        <StatePanel kind="empty" compact tone="ok" sentence={attention.calm} />
      ) : (
        <ul className={`grid min-w-0 border-y border-depot-line lg:grid-cols-2 lg:gap-x-8 ${at('list')}`}>
          {attention.lines.map((line) => (
            <li
              key={line.key}
              className={`min-w-0 border-t border-depot-line first:border-t-0 lg:[&:nth-child(2)]:border-t-0 ${at('item')}`}
            >
              <Link
                href={line.href}
                data-testid={`depot-attention-${line.key}`}
                className={`group flex min-w-0 items-baseline gap-4 py-2 hover:bg-depot-surface focus-visible:bg-depot-surface ${at('link')}`}
              >
                <span className={`w-14 shrink-0 text-right font-display text-[24px] tabular-nums leading-none text-depot-ink ${at('count')}`}>
                  {formatCount(line.count)}
                </span>
                <span
                  className={`min-w-0 flex-1 font-sans text-sm text-depot-ink group-hover:underline sm:truncate ${at('words')}`}
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
          {attention.lines.length % 2 === 1 ? (
            // The empty last cell of an odd strip keeps its bottom rule, so 3+2 ends on one line.
            <li
              aria-hidden
              data-testid="depot-attention-filler"
              className={`hidden border-t border-depot-line lg:block ${at('filler')}`}
            />
          ) : null}
        </ul>
      )}
    </section>
  );
}
